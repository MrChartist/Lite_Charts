// Builds the one-tag script for plain HTML pages: dist/chartist-lite.element.iife.min.js (global ChartistLiteElement).
// `npm run build` clears dist/, so run this after it: `node scripts/build-element-iife.mjs`.
// TODO(lead): scripts/build.mjs is not owned by the embedding worker; add the same esbuild call there (entry
// src/element/auto.ts, format iife, globalName ChartistLiteElement, minify) and drop this file.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  absWorkingDir: root,
  entryPoints: ['src/element/auto.ts'],
  outfile: 'dist/chartist-lite.element.iife.min.js',
  bundle: true,
  format: 'iife',
  globalName: 'ChartistLiteElement',
  minify: true,
  target: 'es2020',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('built dist/chartist-lite.element.iife.min.js');
