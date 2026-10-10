// The nginx configurations that the README tells the maintainer to put on the server: `nginx -t` must accept them,
// and the README must show exactly what the files contain.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GenericContainer } from 'testcontainers';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
// The same pinned nginx image that serves the site.
const image = /^FROM (nginxinc\/nginx-unprivileged:\S+)$/m.exec(read('Dockerfile'))[1];
// Code blocks inside numbered steps are indented in the README: compare without leading whitespace.
const flat = (text) => text.split(/\r?\n/).map((line) => line.trimStart()).join('\n');
const readme = flat(read('README.md'));
const FILES = ['host-nginx.conf', 'host-nginx-allowlist.conf', 'host-nginx-basic-auth.conf'];
let container;

before(
  async () => {
    container = await new GenericContainer(image)
      .withExposedPorts(8080)
      .withCopyContentToContainer([
        { content: 'pid /tmp/nginx-test.pid;\nevents {}\nhttp { include /tmp/snippet.conf; }\n', target: '/tmp/wrapper.conf' },
        ...FILES.map((name) => ({ content: read('deploy', name), target: `/tmp/${name}` })),
      ])
      .start();
  },
  { timeout: 300_000 },
);
after(async () => container?.stop({ remove: true }));

describe('host nginx configurations', () => {
  for (const name of FILES) {
    it(`${name} is valid for nginx`, async () => {
      const wrapper = `pid /tmp/nginx-test.pid;\nevents {}\nhttp { include /tmp/${name}; }\n`;
      await container.copyContentToContainer([{ content: wrapper, target: `/tmp/wrapper-${name}` }]);
      const result = await container.exec(['nginx', '-t', '-c', `/tmp/wrapper-${name}`]);
      assert.equal(result.exitCode, 0, result.output);
    });

    it(`${name} proxies to the loopback port that compose.yaml publishes`, () => {
      assert.match(read('deploy', name), /proxy_pass http:\/\/127\.0\.0\.1:8081;/);
      assert.match(read('compose.yaml'), /"127\.0\.0\.1:8081:8080"/);
    });
  }

  it('the README shows the base configuration exactly as the file has it', () => {
    assert.ok(readme.includes(flat(read('deploy', 'host-nginx.conf')).trim()));
  });

  it('the README shows the optional restriction directives that the files use', () => {
    assert.match(read('deploy', 'host-nginx-allowlist.conf'), /allow 203\.0\.113\.10;\s+deny all;/);
    assert.ok(readme.includes('allow 203.0.113.10;\ndeny all;'));
    assert.match(read('deploy', 'host-nginx-basic-auth.conf'), /auth_basic "hypot docs";\s+auth_basic_user_file \/etc\/nginx\/\.htpasswd;/);
    assert.ok(readme.includes('auth_basic "hypot docs";\nauth_basic_user_file /etc/nginx/.htpasswd;'));
  });

  it('the README documents the commands of the quick start', () => {
    for (const text of ['git clone --recurse-submodules', 'npm ci', 'npm run dev', 'npm test', 'npm run build', 'git submodule update --remote api', 'docker compose up -d --build', 'certbot']) {
      assert.ok(readme.includes(text), text);
    }
  });
});
