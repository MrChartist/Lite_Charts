// Rename the npm package everywhere it is written: `node scripts/rename-package.mjs <new-name> [--only a,b] [--dry]`.
// The current name is read from package.json; the old scoped name `@mrchartist/chartist-lite` is replaced too. Safe to
// run twice (a second run finds nothing). `--only` limits it to some of the areas: package, src, examples, notes
// (ARCHITECTURE, CHANGELOG, PROVENANCE, CONTRIBUTING), readme, docs, site. The product name "Chartist Lite", the
// script-tag globals (ChartistLite*) and the dist file names are not touched.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const next = args.find(a => !a.startsWith('--'));
const dry = args.includes('--dry');
const onlyArg = args.find(a => a.startsWith('--only'));
const only = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1]).split(',') : null;
if (!next || !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(next)) {
  console.error('usage: node scripts/rename-package.mjs <new-npm-name> [--only package,src,examples,notes,readme,docs,site] [--dry]');
  process.exit(2);
}
const pkgPath = join(root, 'package.json');
const current = JSON.parse(readFileSync(pkgPath, 'utf8')).name;
const olds = [...new Set([current, '@mrchartist/chartist-lite'])].filter(o => o !== next);

const AREAS = {
  package: ['package.json', 'package-lock.json'],
  src: ['src'],
  examples: ['examples'],
  notes: ['ARCHITECTURE.md', 'CHANGELOG.md', 'PROVENANCE.md', 'CONTRIBUTING.md', 'SECURITY.md'],
  readme: ['README.md'],
  docs: ['docs'],
  site: ['site'],
};
const EXT = /\.(ts|tsx|js|mjs|cjs|json|md|html|css|txt|yml|yaml)$/;
const files = [];
const walk = p => {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) { for (const n of readdirSync(p)) if (n !== 'node_modules' && n !== 'dist' && !n.startsWith('.')) walk(join(p, n)); }
  else if (EXT.test(p)) files.push(p);
};
for (const [area, list] of Object.entries(AREAS)) if (!only || only.includes(area)) for (const rel of list) walk(join(root, rel));

// A name is replaced where it stands as a package name: not inside a longer name (`lite-charts-x`, `x/lite-charts`).
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
let changed = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  let out = text;
  for (const old of olds) out = out.replace(new RegExp(`(^|[^\\w@/.-])${esc(old)}(?![\\w-])`, 'g'), (_, lead) => `${lead}${next}`);
  if (out !== text) {
    changed++;
    console.log(`${dry ? 'would change' : 'changed'} ${relative(root, f)}`);
    if (!dry) writeFileSync(f, out);
  }
}
console.log(`${changed} file(s) ${dry ? 'would change' : 'changed'}; ${olds.join(', ')} -> ${next}`);
