// Builds the real image through compose, starts it on loopback and checks that Astro serves the built site,
// search included (Pagefind only exists in a static build, which is why the image runs `astro preview`).
// It uses the docker CLI, not Testcontainers, because compose is what users run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PROJECT = `hypot-docs-test-${process.pid}`;
const BASE = 'http://127.0.0.1:4321';
const docker = (args, options = {}) =>
  spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOCKER_BUILDKIT: '1' }, ...options });
const compose = (args) => docker(['compose', '-p', PROJECT, ...args]);
let containerId;

before(
  async () => {
    const up = compose(['up', '-d', '--build']);
    assert.equal(up.status, 0, up.stderr);
    containerId = compose(['ps', '-q', 'docs']).stdout.trim();
    assert.ok(containerId, 'the docs container was not created');
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const status = docker(['inspect', '-f', '{{.State.Health.Status}}', containerId]).stdout.trim();
      if (status === 'healthy') return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`the container did not become healthy:\n${compose(['logs', 'docs']).stdout}`);
  },
  { timeout: 900_000 },
);
after(() => {
  compose(['down', '--rmi', 'local', '--volumes', '--remove-orphans']);
});

describe('the site served by Astro', () => {
  it('serves the home page', async () => {
    const response = await fetch(`${BASE}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<html lang="es"/);
  });

  it('serves nested pages and the generated API reference', async () => {
    for (const path of ['/frontend/refresh/', '/operacion/configuracion/', '/referencia/']) {
      assert.equal((await fetch(`${BASE}${path}`)).status, 200, path);
    }
  });

  it('serves the Pagefind search assets', async () => {
    for (const path of ['/pagefind/pagefind.js', '/pagefind/pagefind-entry.json']) {
      assert.equal((await fetch(`${BASE}${path}`)).status, 200, path);
    }
  });
});

describe('the container', () => {
  it('publishes the port only on 127.0.0.1', () => {
    const bindings = JSON.parse(docker(['inspect', containerId]).stdout)[0].NetworkSettings.Ports['4321/tcp'];
    assert.deepEqual(bindings.map((binding) => binding.HostIp), ['127.0.0.1']);
    assert.deepEqual(bindings.map((binding) => binding.HostPort), ['4321']);
  });

  it('runs as the non-root node user', () => {
    assert.equal(docker(['exec', containerId, 'id', '-un']).stdout.trim(), 'node');
  });
});
