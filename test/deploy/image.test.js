// Builds the real image (Dockerfile at the repository root) and runs it with the hardened settings of compose.yaml:
// read-only root, tmpfs /tmp, no capabilities, no-new-privileges, memory and process limits, loopback publishing.
// It uses the docker CLI, not Testcontainers, because BuildKit is what honours Dockerfile.dockerignore.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readCspFromConf } from '../../config/csp.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const IMAGE = 'hypot-auth-api-docs-site:test';
const NAME = `hypot-docs-site-test-${process.pid}`;
const docker = (args, options = {}) => spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DOCKER_BUILDKIT: '1' }, ...options });
const expectedCsp = readCspFromConf(readFileSync(join(ROOT, 'docker', 'security-headers.conf'), 'utf8'));
let base;

before(
  async () => {
    const build = docker(['build', '-t', IMAGE, '.'], { maxBuffer: 64 * 1024 * 1024 });
    assert.equal(build.status, 0, build.stderr);
    const run = docker([
      'run', '-d', '--name', NAME,
      '-p', '127.0.0.1::8080',
      '--read-only', '--tmpfs', '/tmp',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--memory', '128m', '--pids-limit', '64',
      IMAGE,
    ]);
    assert.equal(run.status, 0, run.stderr);
    const mapping = docker(['port', NAME, '8080/tcp']).stdout.trim().split('\n')[0];
    base = `http://127.0.0.1:${mapping.split(':').pop()}`;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        if ((await fetch(`${base}/`)).status === 200) return;
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`the container did not answer:\n${docker(['logs', NAME]).stdout}${docker(['logs', NAME]).stderr}`);
  },
  { timeout: 600_000 },
);
after(() => {
  docker(['rm', '-f', NAME]);
  docker(['rmi', IMAGE]);
});

const headersOf = (response) => Object.fromEntries([...response.headers]);

describe('the served site', () => {
  it('serves the home page with the exact CSP of docker/security-headers.conf', async () => {
    const response = await fetch(`${base}/`);
    const headers = headersOf(response);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<html lang="es"/);
    assert.equal(headers['content-security-policy'], expectedCsp);
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(headers['cache-control'], 'no-cache');
    assert.equal(headers.server, 'nginx'); // no version number
  });

  it('serves nested pages and the generated API reference', async () => {
    for (const path of ['/frontend/refresh/', '/operacion/configuracion/', '/referencia/', '/referencia/operations/apiv1authlogin/']) {
      assert.equal((await fetch(`${base}${path}`)).status, 200, path);
    }
  });

  it('caches hashed build files for a year and still sends the security headers on them', async () => {
    const home = await (await fetch(`${base}/`)).text();
    const asset = /href="(\/_astro\/[^"]+\.css)"/.exec(home)[1];
    const response = await fetch(`${base}${asset}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(response.headers.get('content-security-policy'), expectedCsp);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  it('serves the search index and its gzip-compressed WebAssembly file as opaque bytes', async () => {
    const entry = await fetch(`${base}/pagefind/pagefind-entry.json`);
    assert.equal(entry.status, 200);
    const languages = Object.keys((await entry.json()).languages);
    assert.ok(languages.length > 0);
    for (const file of ['/pagefind/pagefind.js', '/pagefind/pagefind-worker.js', '/pagefind/pagefind-ui.js']) {
      const response = await fetch(`${base}${file}`);
      assert.equal(response.status, 200, file);
      assert.match(response.headers.get('content-type'), /javascript/);
      assert.equal(response.headers.get('content-security-policy'), expectedCsp); // the worker is governed by its own response
    }
    const wasm = await fetch(`${base}/pagefind/wasm.${languages[0]}.pagefind`);
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers.get('content-type'), 'application/octet-stream');
    assert.equal(wasm.headers.get('content-encoding'), null); // already compressed: Pagefind unzips it itself
    assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer()).slice(0, 2)], [0x1f, 0x8b]); // gzip magic number
  });

  it('answers a missing page with the Spanish 404 page and the same headers', async () => {
    const response = await fetch(`${base}/no-existe/`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-security-policy'), expectedCsp);
    assert.match(await response.text(), /<html lang="es"/);
  });

  it('does not publish the OpenAPI sources, the README of the API or test files', async () => {
    for (const path of ['/api/openapi.json', '/README.md', '/package.json', '/examples/frontend/login.js', '/test/']) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, path);
    }
  });
});

describe('the container', () => {
  it('runs as a non-root user with a read-only root filesystem', () => {
    const inspect = JSON.parse(docker(['inspect', NAME]).stdout)[0];
    assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(inspect.HostConfig.CapDrop, ['ALL']);
    assert.ok(inspect.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
    assert.equal(inspect.HostConfig.Memory, 128 * 1024 * 1024);
    assert.equal(inspect.HostConfig.PidsLimit, 64);
    const user = docker(['exec', NAME, 'id', '-u']).stdout.trim();
    assert.notEqual(user, '0');
  });

  it('cannot write outside /tmp', () => {
    assert.notEqual(docker(['exec', NAME, 'touch', '/usr/share/nginx/html/x']).status, 0);
    assert.equal(docker(['exec', NAME, 'touch', '/tmp/x']).status, 0);
  });

  it('has a configuration nginx accepts', () => {
    const test = docker(['exec', NAME, 'nginx', '-t']);
    assert.equal(test.status, 0, test.stderr);
  });
});
