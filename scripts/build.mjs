// Build: ESM per entry (readable, tree-shakeable), a minified IIFE global `ChartistLite` for <script> tags, and
// .d.ts files from tsc. Run from the package folder: `npm run build`.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ENTRIES = {
  index: 'src/index.ts',
  indicators: 'src/indicators/index.ts',
  element: 'src/element/index.ts',
  react: 'src/react/index.ts',
  drawings: 'src/drawings/index.ts',
  live: 'src/live/index.ts',
};

rmSync(join(root, 'dist'), { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: ENTRIES,
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  target: 'es2020',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
});

await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/chartist-lite.iife.min.js',
  bundle: true,
  format: 'iife',
  globalName: 'ChartistLite',
  minify: true,
  target: 'es2020',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
});

// One-tag scripts for plain pages: the indicators (global ChartistLiteIndicators) and the custom element, which
// registers <chartist-chart> on load (global ChartistLiteElement; src/element/auto.ts).
for (const [entry, outfile, globalName] of [
  ['src/indicators/index.ts', 'dist/chartist-lite-indicators.iife.min.js', 'ChartistLiteIndicators'],
  ['src/element/auto.ts', 'dist/chartist-lite.element.iife.min.js', 'ChartistLiteElement'],
  ['src/drawings/index.ts', 'dist/chartist-lite-drawings.iife.min.js', 'ChartistLiteDrawings'],
  ['src/live/index.ts', 'dist/chartist-lite-live.iife.min.js', 'ChartistLiteLive'],
  ['src/element/auto-live.ts', 'dist/chartist-lite.element-live.iife.min.js', 'ChartistLiteElement'],
]) {
  await build({
    absWorkingDir: root, entryPoints: [entry], outfile, bundle: true, format: 'iife', globalName, minify: true,
    target: 'es2020', sourcemap: true, legalComments: 'none', logLevel: 'warning',
  });
}

execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
console.log('built dist/');
