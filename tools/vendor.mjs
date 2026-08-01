/**
 * Copies three.js out of node_modules into `vendor/`, so the game runs from a
 * plain static server with no bundler and no node_modules at runtime.
 *
 * This exists because three's ESM build is NOT one file: `three.module.js`
 * imports `./three.core.js` beside it. Copying only the entry point produces a
 * 404 that kills the whole module graph before any of our code runs — which
 * presents as a black page with a completely empty console. It cost an hour
 * once; it will not cost one again.
 *
 * Run automatically by `npm install` (postinstall) and by `npm test`.
 */

import { copyFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SRC = 'node_modules/three/build';
const DEST = 'vendor';
const ENTRY = 'three.module.js';

/** Follow relative imports from the entry point so nothing is ever missed. */
function collect(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const full = join(SRC, file);
  if (!existsSync(full)) throw new Error(`three build file missing: ${full} — run "npm install three"`);
  const src = readFileSync(full, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) {
    collect(m[1].replace(/^\.\//, ''), seen);
  }
  return seen;
}

const files = collect(ENTRY);
mkdirSync(DEST, { recursive: true });
for (const f of files) {
  const to = join(DEST, f);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(SRC, f), to);
}

const version = JSON.parse(readFileSync('node_modules/three/package.json', 'utf8')).version;
console.log(`vendored three@${version}: ${[...files].join(', ')} → ${resolve(DEST)}`);
