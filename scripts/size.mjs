// Size of each entry as a user's bundler would ship it: bundled, minified, gzipped. Fails over budget.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// 34 KB until 2026-11-22; +0.6 KB for the ordinal (brick) time axis in the core (ARCHITECTURE.md, "Ordinal (brick) time axis").
const BUDGET_GZIP = { index: 34.6 * 1024 };
const ENTRIES = {
  index: 'src/index.ts',
  indicators: 'src/indicators/index.ts',
  element: 'src/element/index.ts',
  react: 'src/react/index.ts',
  drawings: 'src/drawings/index.ts',
  live: 'src/live/index.ts',
  widget: 'src/widget/index.ts',
  transforms: 'src/transforms/index.ts',
  extras: 'src/plugins/extras/index.ts',
};

// The one-tag IIFE builds, as shipped (read from dist/; run `npm run build` first).
const IIFES = {
  'iife core': 'dist/chartist-lite.iife.min.js',
  'iife indic.': 'dist/chartist-lite-indicators.iife.min.js',
  'iife element': 'dist/chartist-lite.element.iife.min.js',
  'iife draw.': 'dist/chartist-lite-drawings.iife.min.js',
  'iife live': 'dist/chartist-lite-live.iife.min.js',
  'iife el+live': 'dist/chartist-lite.element-live.iife.min.js',
  'iife widget': 'dist/chartist-lite-widget.iife.min.js',
  'iife terminal': 'dist/chartist-lite.terminal.iife.min.js',
  'iife transf.': 'dist/chartist-lite-transforms.iife.min.js',
  'iife extras': 'dist/chartist-lite-extras.iife.min.js',
};
const { readFileSync, existsSync } = await import('node:fs');

let failed = false;
const rows = [];
for (const [name, entry] of Object.entries(ENTRIES)) {
  if (!existsSync(join(root, entry))) { rows.push(`${name.padEnd(12)} skipped (${entry} not found)`); continue; }
  const out = await build({
    absWorkingDir: root, entryPoints: [entry], bundle: true, format: 'esm', minify: true, target: 'es2020',
    write: false, legalComments: 'none', logLevel: 'silent',
  });
  const code = out.outputFiles[0].contents;
  const gz = gzipSync(code, { level: 9 }).length;
  const budget = BUDGET_GZIP[name];
  if (budget && gz > budget) failed = true;
  rows.push(`${name.padEnd(12)} min ${(code.length / 1024).toFixed(1).padStart(6)} KB   gzip ${(gz / 1024).toFixed(1).padStart(5)} KB${budget ? `   budget ${(budget / 1024).toFixed(1)} KB ${gz > budget ? 'OVER' : 'ok'}` : ''}`);
}
for (const [name, file] of Object.entries(IIFES)) {
  const p = join(root, file);
  if (!existsSync(p)) { rows.push(`${name.padEnd(12)} missing (${file}); run npm run build`); continue; }
  const code = readFileSync(p);
  const gz = gzipSync(code, { level: 9 }).length;
  rows.push(`${name.padEnd(12)} min ${(code.length / 1024).toFixed(1).padStart(6)} KB   gzip ${(gz / 1024).toFixed(1).padStart(5)} KB`);
}
console.log(rows.join('\n'));
if (failed) { console.error('size budget exceeded'); process.exit(1); }
