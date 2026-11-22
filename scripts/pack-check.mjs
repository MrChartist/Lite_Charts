// `npm run pack:check`: the package as a consumer gets it. Packs the tarball (npm pack, after a build), unpacks it into
// a throwaway consumer's node_modules, then (1) imports every subpath in Node ESM, (2) type-checks a strict consumer
// against every subpath with `moduleResolution: nodenext` and `skipLibCheck: false`, (3) proves the types are real: a
// deliberately wrong member access must FAIL to compile, and (4) type-checks the same consumer with `bundler`
// resolution. Nothing is published and nothing is fetched from the network.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const name = pkg.name;
const subpaths = Object.keys(pkg.exports).filter(k => k !== './package.json' && k !== './iife').map(k => (k === '.' ? name : `${name}/${k.slice(2)}`));
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const work = mkdtempSync(join(tmpdir(), 'lite-charts-pack-'));
const failures = [];
const step = (ok, what, detail = '') => { if (!ok) failures.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  ${detail}` : ''}`); };

try {
  const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', work], { cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_ignore_scripts: 'true' } }).trim().split('\n').pop();
  const app = join(work, 'app');
  const dest = join(app, 'node_modules', name);
  mkdirSync(dest, { recursive: true });
  execFileSync('tar', ['-xzf', join(work, tgz), '-C', dest, '--strip-components=1']);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  step(true, `packed ${tgz}`);

  // (1) Node ESM import of every subpath.
  writeFileSync(join(app, 'import.mjs'), subpaths.map((s, i) => `import * as m${i} from '${s}'; if (!Object.keys(m${i}).length) throw new Error('${s} exports nothing');`).join('\n') + "\nconsole.log('imported');\n");
  try { execFileSync(process.execPath, ['import.mjs'], { cwd: app, encoding: 'utf8' }); step(true, `node imports ${subpaths.length} subpaths`); }
  catch (e) { step(false, 'node imports every subpath', String(e.stderr || e.message).split('\n').slice(0, 3).join(' ')); }

  // (2)-(4) Types.
  const good = `import { createChart, CandlestickSeries, type ChartApi } from '${name}';
import { sma } from '${name}/indicators';
import { createWidget, type Widget } from '${name}/widget';
import { connectLive } from '${name}/live';
import { createDrawingTools } from '${name}/drawings';
${subpaths.slice(1).map((s, i) => `import * as all${i} from '${s}';`).join('\n')}
export function use(el: HTMLElement): void {
  const chart: ChartApi = createChart(el);
  const s = chart.addSeries(CandlestickSeries, { upColor: '#26A148' });
  s.setData([{ time: '2024-01-02', open: 1, high: 2, low: 0.5, close: 1.5 }]);
  chart.timeScale().setVisibleSpan('1M');
  const n: number = sma([{ time: 1, close: 1 }], 2).length;
  const w: Widget = createWidget(el, { data: [] });
  void n; void w; void connectLive; void createDrawingTools;
  ${subpaths.slice(1).map((_, i) => `void all${i};`).join(' ')}
}
`;
  const bad = `import { createChart } from '${name}';
export function use(el: HTMLElement): void { createChart(el).timeScale().thisDoesNotExist(); }
`;
  const config = (resolution, file) => JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: resolution === 'nodenext' ? 'NodeNext' : 'ESNext', moduleResolution: resolution, strict: true, skipLibCheck: false, noEmit: true, types: [] }, files: [file] });
  writeFileSync(join(app, 'good.ts'), good);
  writeFileSync(join(app, 'bad.ts'), bad);
  const run = (cfg) => { try { execFileSync(process.execPath, [tsc, '-p', cfg], { cwd: app, encoding: 'utf8' }); return ''; } catch (e) { return String(e.stdout || e.message); } };
  for (const res of ['nodenext', 'bundler']) {
    writeFileSync(join(app, `tsconfig.${res}.json`), config(res, 'good.ts'));
    const out = run(`tsconfig.${res}.json`);
    step(out === '', `types: strict ${res} consumer compiles with skipLibCheck false`, out.split('\n').slice(0, 4).join(' | '));
    writeFileSync(join(app, `tsconfig.${res}-bad.json`), config(res, 'bad.ts'));
    const outBad = run(`tsconfig.${res}-bad.json`);
    step(/thisDoesNotExist/.test(outBad), `types: a wrong member access fails under ${res} (the types are real)`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (failures.length) { console.error(`\n${failures.length} pack check(s) failed`); process.exit(1); }
console.log('\npack checks passed');
