// The text of the docs and the tested code must be the same files. This test keeps that promise:
// - every `?raw` import in a page points to an existing file under examples/;
// - every file under examples/ is shown in at least one page;
// - every file under examples/ is exercised by a snippet test.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const rel = (path) => relative(ROOT, path).split('\\').join('/');

const pages = walk(join(ROOT, 'src', 'content', 'docs')).filter((file) => /\.mdx?$/.test(file));
const examples = walk(join(ROOT, 'examples')).map(rel);
const tests = walk(join(ROOT, 'test')).filter((file) => /(?:snippets|api)[\\/][^\\/]+\.test\.js$/.test(file)).map((file) => readFileSync(file, 'utf8'));

const rawImports = pages.flatMap((page) => {
  const text = readFileSync(page, 'utf8');
  return [...text.matchAll(/from\s+'([^']+)\?raw'/g)].map((match) => ({
    page: rel(page),
    target: rel(resolve(dirname(page), match[1])),
  }));
});

// Files that no test executes, and why. Keep this list short: every entry is a gap in the promise above.
const NOT_EXECUTED = {
  'examples/shell/start-local-api.sh': 'git clone and docker compose up of the API dev stack; the harness starts the same services with Testcontainers',
  'examples/shell/stop-local-api.sh': 'docker compose down of the API dev stack',
};

describe('examples', () => {
  it('every ?raw import resolves to a file under examples/', () => {
    for (const { page, target } of rawImports) {
      assert.ok(target.startsWith('examples/'), `${page} imports ${target}, which is outside examples/`);
      assert.ok(existsSync(join(ROOT, target)), `${page} imports ${target}, which does not exist`);
    }
  });

  it('every example file is shown in at least one page', () => {
    const shown = new Set(rawImports.map(({ target }) => target));
    for (const file of examples) assert.ok(shown.has(file), `${file} is not shown in any page`);
  });

  it('every example file is exercised by a test, or listed as not executed', () => {
    for (const file of examples.filter((name) => !(name in NOT_EXECUTED))) {
      const name = basename(file);
      const covered = tests.some((text) => text.includes(`/${name}`) || text.includes(`'${name}'`));
      assert.ok(covered, `${file} is not referenced by any test in test/snippets or test/api`);
    }
  });

  it('example shell scripts use LF line endings', () => {
    for (const file of examples.filter((name) => name.endsWith('.sh'))) {
      assert.ok(!readFileSync(join(ROOT, file), 'utf8').includes('\r'), `${file} has CRLF`);
    }
  });
});
