// Builds the site once (into a temporary folder) and checks the result: the build passes with link validation,
// every sidebar page and every API operation is there, and search, language and accessibility basics hold.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sidebarSlugs } from '../../config/sidebar.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
let dist;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

before(
  () => {
    dist = mkdtempSync(join(tmpdir(), 'hypot-docs-dist-'));
    const result = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build', '--outDir', dist], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `astro build failed (this also covers broken internal links):\n${result.stdout}\n${result.stderr}`);
    // The validator throws (a non-zero exit above) on a broken link; this proves that it ran.
    assert.match(result.stdout, /validating links/);
  },
  { timeout: 280_000 },
);
after(() => dist && rmSync(dist, { recursive: true, force: true }));

describe('built site', () => {
  it('has a page for every sidebar entry', () => {
    for (const slug of sidebarSlugs()) {
      const file = slug === 'index' ? 'index.html' : join(slug, 'index.html');
      assert.ok(existsSync(join(dist, file)), `${slug} was not built`);
    }
  });

  it('has an API reference page for every operation of api/openapi.json', () => {
    const spec = JSON.parse(readFileSync(join(ROOT, 'api', 'openapi.json'), 'utf8'));
    const operations = Object.values(spec.paths).flatMap((item) => Object.keys(item).filter((key) => ['get', 'post', 'put', 'patch', 'delete'].includes(key)));
    assert.ok(operations.length >= 10, 'the spec should describe the API routes');
    const pages = walk(join(dist, 'referencia', 'operations')).filter((file) => file.endsWith('index.html'));
    // One page per operation plus one per tag.
    const tags = new Set(Object.values(spec.paths).flatMap((item) => Object.values(item).flatMap((operation) => operation?.tags ?? [])));
    assert.ok(pages.length >= operations.length + tags.size, `${pages.length} reference pages for ${operations.length} operations`);
  });

  it('is in Spanish and has search', () => {
    assert.match(readFileSync(join(dist, 'index.html'), 'utf8'), /<html lang="es"/);
    assert.ok(existsSync(join(dist, 'pagefind', 'pagefind.js')));
    assert.ok(existsSync(join(dist, 'pagefind', 'pagefind-entry.json')));
  });

  it('every image has alternative text', () => {
    for (const file of walk(dist).filter((name) => name.endsWith('.html'))) {
      const html = readFileSync(file, 'utf8');
      for (const image of html.matchAll(/<img\b[^>]*>/g)) assert.match(image[0], /\balt="[^"]+"/, `${file}: ${image[0].slice(0, 80)}`);
    }
  });

  it('headings never skip a level inside the article', () => {
    for (const file of walk(dist).filter((name) => name.endsWith('index.html') && !name.includes('referencia'))) {
      const html = readFileSync(file, 'utf8');
      const article = html.split('sl-markdown-content')[1]?.split('</main>')[0];
      if (!article) continue;
      const levels = [...article.matchAll(/<h([2-6])/g)].map((match) => Number(match[1]));
      let previous = 1;
      for (const level of levels) {
        assert.ok(level <= previous + 1, `${file}: h${previous} followed by h${level}`);
        previous = level;
      }
    }
  });
});
