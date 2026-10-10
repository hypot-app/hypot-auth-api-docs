// Static checks of the local container files: the loopback-only publishing must not be lost in a later edit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

describe('compose.yaml', () => {
  const compose = read('compose.yaml');

  it('publishes only on 127.0.0.1:4321', () => {
    assert.match(compose, /^\s+- "127\.0\.0\.1:4321:4321"$/m);
    assert.doesNotMatch(compose, /^\s+- "(?!127\.0\.0\.1:)[^"]*\d+:\d+"$/m);
  });

  it('keeps the safe defaults', () => {
    assert.match(compose, /^\s+cap_drop:\n\s+- ALL$/m);
    assert.match(compose, /^\s+security_opt:\n\s+- no-new-privileges:true$/m);
    assert.match(compose, /^\s+healthcheck:/m);
    assert.match(compose, /^\s+restart: unless-stopped$/m);
  });

  it('builds the Dockerfile from the repository root', () => {
    assert.match(compose, /context: \.\n\s+dockerfile: Dockerfile/);
  });
});

describe('Dockerfile', () => {
  const dockerfile = read('Dockerfile');
  const froms = [...dockerfile.matchAll(/^FROM (\S+)(?: AS (\w+))?$/gm)];

  it('is multi-stage on Node 24 with the base image pinned by tag AND digest', () => {
    assert.ok(froms.length >= 2);
    const base = /^ARG NODE_IMAGE=(\S+)$/m.exec(dockerfile)?.[1];
    assert.match(base, /^node:24-bookworm-slim@sha256:[0-9a-f]{64}$/);
    for (const [, image] of froms) assert.equal(image, '${NODE_IMAGE}');
  });

  it('serves with astro preview on all interfaces as the node user', () => {
    assert.match(dockerfile, /^USER node$/m);
    assert.match(dockerfile, /"astro", "preview", "--host", "0\.0\.0\.0", "--port", "4321"/);
    assert.doesNotMatch(dockerfile, /nginx/i);
  });

  it('the build context ignore file lets the OpenAPI file through and nothing secret', () => {
    const ignore = read('Dockerfile.dockerignore');
    assert.match(ignore, /^\*$/m);
    assert.match(ignore, /^!api\/openapi\.json$/m);
    assert.doesNotMatch(ignore, /\.env/);
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
