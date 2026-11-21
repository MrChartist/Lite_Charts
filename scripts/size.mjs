// Size of each entry as a user's bundler would ship it: bundled, minified, gzipped. Fails over budget.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_GZIP = { index: 45 * 1024 };
const ENTRIES = {
  index: 'src/index.ts',
  indicators: 'src/indicators/index.ts',
  element: 'src/element/index.ts',
  react: 'src/react/index.ts',
};

let failed = false;
const rows = [];
for (const [name, entry] of Object.entries(ENTRIES)) {
  const out = await build({
    absWorkingDir: root, entryPoints: [entry], bundle: true, format: 'esm', minify: true, target: 'es2020',
    write: false, legalComments: 'none', logLevel: 'silent',
  });
  const code = out.outputFiles[0].contents;
  const gz = gzipSync(code, { level: 9 }).length;
  const budget = BUDGET_GZIP[name];
  if (budget && gz > budget) failed = true;
  rows.push(`${name.padEnd(12)} min ${(code.length / 1024).toFixed(1).padStart(6)} KB   gzip ${(gz / 1024).toFixed(1).padStart(5)} KB${budget ? `   budget ${(budget / 1024).toFixed(0)} KB ${gz > budget ? 'OVER' : 'ok'}` : ''}`);
}
console.log(rows.join('\n'));
if (failed) { console.error('size budget exceeded'); process.exit(1); }
