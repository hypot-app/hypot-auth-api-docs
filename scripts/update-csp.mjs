// Recomputes the hashes of the inline scripts in dist/ and rewrites the CSP in docker/security-headers.conf.
// Run it after `npm run build` whenever test/unit/site-build.test.js reports that the hashes changed
// (for example after upgrading Starlight), and review the diff.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCsp, inlineScriptHashes, writeCspToConf } from '../config/csp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const confPath = join(root, 'docker', 'security-headers.conf');
const hashes = inlineScriptHashes(join(root, 'dist'));
writeFileSync(confPath, writeCspToConf(readFileSync(confPath, 'utf8'), buildCsp(hashes)));
console.log(`Content-Security-Policy updated with ${hashes.length} inline script hashes.`);
