// Content-Security-Policy of the container, built from what the compiled site actually needs.
// Used by scripts/update-csp.mjs (writes docker/security-headers.conf) and by test/unit/csp.test.js (checks it).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Directives that do not depend on the build. Each allowance is explained in the README and in the tests. */
export const STATIC_DIRECTIVES = {
  'default-src': ["'none'"],
  // Pagefind (search) instantiates WebAssembly in the page and in its worker: 'wasm-unsafe-eval' is the narrowest
  // allowance for that. It does not allow eval() or new Function().
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  // CSS is always an external file (build.inlineStylesheets: 'never').
  'style-src': ["'self'"],
  // Starlight and Expressive Code write style="--sl-icon-size: 1em" and per-token colour variables as attributes.
  // The values depend on the code samples, so they cannot be listed as hashes. Only attributes are affected:
  // <style> elements and style sheets are still limited to 'self'.
  'style-src-attr': ["'unsafe-inline'"],
  // Icons are data: SVGs inside the CSS files.
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  // Pagefind downloads its index and wasm files from the same origin.
  'connect-src': ["'self'"],
  // Pagefind runs its search in a Web Worker served from the same origin.
  'worker-src': ["'self'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Every inline <script> in the built HTML, keyed by its CSP hash source, with the files that contain it. */
export function inlineScripts(distDir) {
  const found = new Map();
  for (const file of walk(distDir).filter((name) => name.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const hash = `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`;
      found.set(hash, { body: match[1], files: [...(found.get(hash)?.files ?? []), file] });
    }
  }
  return found;
}

/** Sorted CSP hash sources of every inline script. */
export function inlineScriptHashes(distDir) {
  return [...inlineScripts(distDir).keys()].sort();
}

export function buildCsp(hashes) {
  const directives = { ...STATIC_DIRECTIVES, 'script-src': [...STATIC_DIRECTIVES['script-src'], ...hashes] };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/** The value of the Content-Security-Policy line in docker/security-headers.conf. */
export function readCspFromConf(text) {
  const match = /add_header Content-Security-Policy "([^"]*)" always;/.exec(text);
  if (!match) throw new Error('docker/security-headers.conf has no Content-Security-Policy line');
  return match[1];
}

export function writeCspToConf(text, csp) {
  readCspFromConf(text);
  return text.replace(/add_header Content-Security-Policy "[^"]*" always;/, () => `add_header Content-Security-Policy "${csp}" always;`);
}
