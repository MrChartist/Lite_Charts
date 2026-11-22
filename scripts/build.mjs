// Build: ESM per entry (readable, tree-shakeable), a minified IIFE global `ChartistLite` for <script> tags, and
// .d.ts files from tsc. Run from the package folder: `npm run build`.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// A one-line licence notice on every built file (kept by minifiers: `/*!`).
const banner = { js: `/*! Chartist Lite ${pkg.version} | Apache-2.0 | https://github.com/MrChartist/Lite_Charts */` };
export const ENTRIES = {
  index: 'src/index.ts',
  indicators: 'src/indicators/index.ts',
  element: 'src/element/index.ts',
  react: 'src/react/index.ts',
  drawings: 'src/drawings/index.ts',
  live: 'src/live/index.ts',
  // Optional entries: each is built only when its index file exists (an empty file builds an empty module), so a
  // half-landed folder never breaks the shared build.
  widget: 'src/widget/index.ts',
  transforms: 'src/transforms/index.ts',
  extras: 'src/plugins/extras/index.ts',
};
const OPTIONAL = new Set(['widget', 'transforms', 'extras']);
const present = Object.fromEntries(Object.entries(ENTRIES).filter(([name, file]) => {
  if (existsSync(join(root, file))) return true;
  if (!OPTIONAL.has(name)) throw new Error(`missing entry ${file}`);
  console.log(`skip optional entry ${name} (${file} not found)`);
  return false;
}));

rmSync(join(root, 'dist'), { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: present,
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  target: 'es2020',
  sourcemap: true,
  legalComments: 'none', banner,
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
  legalComments: 'none', banner,
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
  ['src/widget/index.ts', 'dist/chartist-lite-widget.iife.min.js', 'ChartistLiteWidget'],
  ['src/widget/auto.ts', 'dist/chartist-lite.terminal.iife.min.js', 'ChartistLiteTerminal'],
  ['src/transforms/index.ts', 'dist/chartist-lite-transforms.iife.min.js', 'ChartistLiteTransforms'],
  ['src/plugins/extras/index.ts', 'dist/chartist-lite-extras.iife.min.js', 'ChartistLiteExtras'],
]) {
  if (!existsSync(join(root, entry))) continue;
  await build({
    absWorkingDir: root, entryPoints: [entry], outfile, bundle: true, format: 'iife', globalName, minify: true,
    target: 'es2020', sourcemap: true, legalComments: 'none', banner, logLevel: 'warning',
  });
}

let tscFailed = false;
try { execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' }); }
catch { tscFailed = true; }

// The emitted declarations use the sources' extensionless relative imports, which TypeScript's node16 / nodenext
// resolution refuses (and with skipLibCheck turns into silent `any`). Give every relative specifier in dist/types its
// real file: './api' -> './api.js', './live' (a folder) -> './live/index.js'. Sources stay as they are.
function fixDeclarations(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { fixDeclarations(p); continue; }
    if (!p.endsWith('.d.ts')) continue;
    const text = readFileSync(p, 'utf8');
    const fixed = text.replace(/(from\s+|import\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/g, (all, lead, q, spec) => {
      if (/\.(js|mjs|cjs|json)$/.test(spec)) return all;
      const base = join(dirname(p), spec);
      if (existsSync(`${base}.d.ts`)) return `${lead}${q}${spec}.js${q}`;
      if (existsSync(join(base, 'index.d.ts'))) return `${lead}${q}${spec}/index.js${q}`;
      return all;
    });
    if (fixed !== text) writeFileSync(p, fixed);
  }
}
if (existsSync(join(root, 'dist', 'types'))) fixDeclarations(join(root, 'dist', 'types'));
if (tscFailed) { console.error('declarations: tsc reported errors (see above)'); process.exit(1); }
console.log('built dist/');
