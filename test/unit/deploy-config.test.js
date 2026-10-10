// Static checks of the deployment files: the hardened settings must not be lost in a later edit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

describe('compose.yaml', () => {
  const compose = read('compose.yaml');

  it('publishes only on 127.0.0.1:8081', () => {
    assert.match(compose, /^\s+- "127\.0\.0\.1:8081:8080"$/m);
    assert.doesNotMatch(compose, /^\s+- "(?:0\.0\.0\.0:)?\d+:\d+"$/m);
  });

  it('keeps the hardened settings', () => {
    assert.match(compose, /^\s+read_only: true$/m);
    assert.match(compose, /^\s+tmpfs:\n\s+- \/tmp$/m);
    assert.match(compose, /^\s+cap_drop:\n\s+- ALL$/m);
    assert.match(compose, /^\s+security_opt:\n\s+- no-new-privileges:true$/m);
    assert.match(compose, /^\s+healthcheck:/m);
    assert.match(compose, /^\s+mem_limit: 128m$/m);
    assert.match(compose, /^\s+pids_limit: 64$/m);
    assert.match(compose, /^\s+restart: unless-stopped$/m);
  });

  it('builds the multi-stage Dockerfile from the repository root', () => {
    assert.match(compose, /context: \.\n\s+dockerfile: Dockerfile/);
  });
});

describe('Dockerfile', () => {
  const dockerfile = read('Dockerfile');
  const froms = [...dockerfile.matchAll(/^FROM (\S+)(?: AS (\w+))?$/gm)];

  it('has a Node 24 build stage and an unprivileged nginx runtime stage', () => {
    assert.equal(froms.length, 2);
    assert.match(froms[0][1], /^node:24-/);
    assert.equal(froms[0][2], 'build');
    assert.match(froms[1][1], /^nginxinc\/nginx-unprivileged:/);
  });

  it('pins both base images by tag AND digest', () => {
    for (const [, image] of froms) assert.match(image, /^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/, image);
  });

  it('copies only the built site into the runtime stage', () => {
    assert.match(dockerfile, /COPY --from=build \/app\/dist \/usr\/share\/nginx\/html/);
    assert.match(dockerfile, /COPY docker\/security-headers\.conf \/etc\/nginx\/security-headers\.conf/);
    assert.doesNotMatch(dockerfile.split(/^FROM nginx/m)[1], /npm /);
  });

  it('the build context ignore file lets the OpenAPI file through and nothing secret', () => {
    const ignore = read('Dockerfile.dockerignore');
    assert.match(ignore, /^\*$/m);
    assert.match(ignore, /^!api\/openapi\.json$/m);
    assert.doesNotMatch(ignore, /\.env/);
  });
});

describe('nginx.conf', () => {
  const nginx = read('docker', 'nginx.conf');

  it('includes the security headers at server level and again in every location that adds a header', () => {
    assert.match(nginx, /^\s{4}include \/etc\/nginx\/security-headers\.conf;$/m);
    // nginx drops inherited headers in a location that adds its own, so each such location must include them again.
    for (const block of nginx.matchAll(/location [^{]+\{([^}]*)\}/g)) {
      if (/add_header/.test(block[1])) assert.match(block[1], /include \/etc\/nginx\/security-headers\.conf;/);
    }
  });

  it('does not show the nginx version', () => {
    assert.match(nginx, /server_tokens off;/);
  });

  it('listens on the unprivileged port', () => {
    assert.match(nginx, /listen 8080;/);
  });
});

describe('security headers file', () => {
  const headers = read('docker', 'security-headers.conf');

  it('sets the standard hardening headers', () => {
    for (const name of ['X-Content-Type-Options "nosniff"', 'Referrer-Policy "no-referrer"', 'X-Frame-Options "DENY"', 'Cross-Origin-Opener-Policy "same-origin"', 'Cross-Origin-Resource-Policy "same-origin"']) {
      assert.ok(headers.includes(name), name);
    }
  });

  it('has a CSP that denies by default and forbids framing, plugins and external origins', () => {
    const csp = /Content-Security-Policy "([^"]*)"/.exec(headers)[1];
    for (const directive of ["default-src 'none'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
      assert.ok(csp.includes(directive), directive);
    }
    assert.doesNotMatch(csp, /https?:\/\//, 'the CSP lists an external origin');
    assert.doesNotMatch(csp, /\*/, 'the CSP uses a wildcard');
  });
});

describe('package.json', () => {
  const pkg = JSON.parse(read('package.json'));

  it('pins every dependency exactly and requires Node 24', () => {
    for (const group of ['dependencies', 'devDependencies']) {
      for (const [name, version] of Object.entries(pkg[group] ?? {})) assert.match(version, /^\d+\.\d+\.\d+$/, `${name}@${version}`);
    }
    assert.equal(pkg.engines.node, '>=24 <25');
  });
});
