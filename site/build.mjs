#!/usr/bin/env node
// Builds the documentation site into site/dist/: static HTML (real text in the source), one stylesheet, a small
// deferred page script, lazily loaded chart scripts (the package's own built files), a search index, sitemap.xml and
// robots.txt. No framework and no runtime dependency.
//
//   npm run build && npm run site          (the site needs dist/ of the package: it serves the real library)
//
// Needs `esbuild`, a development tool of this package. Settings (base URL and so on) are in site.config.json.
// Live examples in the guides are fences marked `live` (see markdown.mjs): their code is compiled here, without its
// import lines, into one small script per page, and runs as shown with `bars` set to demo data. No eval, no inline
// script, so the pages work under `script-src 'self'`.
import { build, transform } from 'esbuild';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { codeBlock, esc, parseFrontMatter, renderMarkdown } from './markdown.mjs';
import { makeBars } from './src/demo-data.js';
import { EXAMPLES } from './src/examples.js';
import { features } from './src/gallery.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..');
const out = path.join(here, 'dist');
const config = JSON.parse(readFileSync(path.join(here, 'site.config.json'), 'utf8'));
const pkgJson = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8'));
// SITE_BASE_URL and SITE_REPO_URL override the config, so a CI job (GitHub Pages and the like) can publish with the
// right canonical links, Open Graph URLs, JSON-LD and sitemap without editing site.config.json.
const BASE_RAW = (process.env.SITE_BASE_URL || config.baseUrl).trim();
const baseUrl = BASE_RAW.endsWith('/') ? BASE_RAW : `${BASE_RAW}/`;
const REPO = (process.env.SITE_REPO_URL ?? config.repoUrl ?? '').trim().replace(/\/$/, '');
const NAME = config.name;
const VERSION = pkgJson.version;
const warnings = [];

const posix = (p) => p.split(path.sep).join('/');
const read = (rel) => readFileSync(path.join(pkg, rel), 'utf8');

/** A relative URL from the page `from` to the file `to` (both paths inside dist, with forward slashes). */
function rel(from, to) {
  const r = path.posix.relative(path.posix.dirname(from), to);
  return r === '' ? path.posix.basename(to) : r;
}
const rootOf = (p) => { const d = path.posix.dirname(p); return d === '.' ? '' : d.split('/').map(() => '..').join('/') + '/'; };

function jpegSize(file) {
  const b = readFileSync(file);
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xC0 && m <= 0xC3) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return { width: 1280, height: 640 };
}
function pngSize(file) {
  const b = readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// ---------- facts read from the package now ----------
const indexSrc = read('src/index.ts');
const SERIES_COUNT = (indexSrc.match(/^export \{ \w+Series \} from/gm) || []).length;
const indicatorSrc = read('src/indicators/index.ts');
const INDICATOR_NAMES = Array.from(indicatorSrc.matchAll(/^export \{ (\w+) \} from/gm)).map((m) => m[1])
  .filter((n) => !['heikinAshi', 'aggregate', 'createIndicator'].includes(n));
const RUNTIME_DEPS = Object.keys(pkgJson.dependencies || {}).length;

// Performance figures from `npm run bench` (docs/performance.json, written by scripts/bench.cjs). When the file is
// missing or its shape is not understood, the site hides the figures rather than guess.
const SCENARIO_LABELS = { crosshair: 'Crosshair', pan: 'Pan', zoom: 'Wheel zoom', tick: 'Live tick', fit: 'Live tick, whole series in view', drag: 'Drag a drawing', trades: 'Live trades, 20 a frame' };
function readPerf() {
  const f = path.join(pkg, 'docs', 'performance.json');
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const rows = (Array.isArray(j.results) ? j.results : []).filter((r) => r.scenario && num(r.median) !== null && num(r.p95) !== null)
      .map((r) => ({ chart: String(r.chart || ''), scenario: String(r.scenario), bars: num(r.bars), dpr: num(r.dpr) ?? 1, median: r.median, p95: r.p95 }));
    if (!rows.length) { warnings.push('docs/performance.json has no rows the site understands; the speed figures are hidden'); return null; }
    const m = j.machine || {};
    const machine = typeof m === 'string' ? m : [m.cpu, m.cores ? `${m.cores} cores` : '', m.chromium ? `Chromium ${m.chromium}${m.headless ? ', headless' : ''}` : ''].filter(Boolean).join(', ');
    const budget = num(j.budgets && j.budgets.hz120) ?? 8.33;
    const worst = Math.max(...rows.map((r) => r.p95));
    const over = rows.filter((r) => r.p95 > budget).length;
    const barsList = [...new Set(rows.map((r) => r.bars))].filter((x) => x !== null).sort((x, y) => x - y);
    const scenarios = [...new Set(rows.map((r) => r.scenario))];
    const grid = scenarios.map((sc) => ({ label: SCENARIO_LABELS[sc] || sc, cells: barsList.map((bn) => { const c = rows.filter((r) => r.scenario === sc && r.bars === bn); return c.length ? Math.max(...c.map((r) => r.p95)) : null; }) }));
    const panRows = rows.filter((r) => r.scenario === 'pan' && r.bars === Math.max(...barsList));
    const pan = panRows.length ? Math.max(...panRows.map((r) => r.median)) : null;
    const date = typeof m === 'object' && m.date ? String(m.date).slice(0, 10) : '';
    return { rows, machine, budget, worst, over, scenarios: rows.length, barsList, grid, pan, panBars: Math.max(...barsList), date, what: String(j.what || '') };
  } catch (e) { warnings.push(`docs/performance.json could not be read (${e.message}); the speed figures are hidden`); return null; }
}
const PERF = readPerf();
const PERF_PAGE = existsSync(path.join(pkg, 'docs', 'PERFORMANCE.md')) ? 'performance.html' : 'readme.html';
// Drawing tools: the `drawings` entry. Its home chapter, examples card and script load appear when it is built.
const DRAWINGS = existsSync(path.join(pkg, 'src', 'drawings', 'index.ts')) && existsSync(path.join(pkg, 'dist', 'chartist-lite-drawings.iife.min.js'));
// Live data: the `live` entry and the element-live build. Its hero toggle, home chapter, examples card and guide demos
// appear when both are built. Every live demo is click-to-connect: nothing reaches an exchange until the reader asks.
const LIVE = existsSync(path.join(pkg, 'src', 'live', 'index.ts')) && existsSync(path.join(pkg, 'dist', 'chartist-lite-live.iife.min.js'))
  && existsSync(path.join(pkg, 'dist', 'chartist-lite.element-live.iife.min.js'));
// Facts read from the source at build time, never typed in: the indicator catalog, the chart types and every drawing
// tool. The modules are bundled with esbuild and imported here (they touch no DOM on import).
async function loadFacts() {
  const parts = [
    ['src/indicators/catalog.ts', "export { INDICATORS } from './src/indicators/catalog.ts';"],
    ['src/transforms/chart-types.ts', "export { CHART_TYPES } from './src/transforms/chart-types.ts';"],
    ['src/drawings/index.ts', "export { TOOLS, BASIC_TOOLS } from './src/drawings/index.ts';"],
    ['src/drawings/contract.ts', "export { GROUP_ORDER } from './src/drawings/contract.ts';"],
  ].filter(([f]) => existsSync(path.join(pkg, f)));
  const res = await build({ absWorkingDir: pkg, stdin: { contents: parts.map((x) => x[1]).join('\n'), resolveDir: pkg, loader: 'ts' }, bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(res.outputFiles[0].text).toString('base64')}`);
}
const FACTS = await loadFacts();
const CATALOG = (FACTS.INDICATORS || []).map((x) => ({ id: x.id, name: x.name, shortName: x.shortName, category: x.category, overlay: x.overlay, inputs: x.inputs, outputs: x.outputs, guides: x.guides || [] }));
const CHART_TYPES = (FACTS.CHART_TYPES || []).map((t) => ({ id: t.id, name: t.name, kind: t.kind, irregularTime: t.irregularTime, inputs: t.inputs }));
const DRAWING_TOOLS = DRAWINGS && FACTS.TOOLS ? FACTS.TOOLS.map((t) => ({ id: t.id, label: t.label, group: t.group, key: t.key || '', points: t.points })) : [];
const DRAWING_GROUPS = (FACTS.GROUP_ORDER || []).map((g) => ({ id: g.id, label: g.label, tools: DRAWING_TOOLS.filter((t) => t.group === g.id) })).filter((g) => g.tools.length);
const BASIC_TOOL_COUNT = FACTS.BASIC_TOOLS ? FACTS.BASIC_TOOLS.length : DRAWING_TOOLS.length;
const WIDGET = existsSync(path.join(pkg, 'src', 'widget', 'index.ts')) && existsSync(path.join(pkg, 'dist', 'chartist-lite.terminal.iife.min.js'));
const EXTRAS = existsSync(path.join(pkg, 'dist', 'chartist-lite-extras.iife.min.js'));
const TRANSFORMS = existsSync(path.join(pkg, 'dist', 'chartist-lite-transforms.iife.min.js'));

function benchHtml() {
  if (!PERF) return `<h3 id="bench-h">Measured, not claimed</h3><p>The package has a frame benchmark (<code>npm run bench</code>). Its recorded figures appear here when they are published with the package; until then, the meter beside this card is the honest number, on your device.</p>`;
  return `<h3 id="bench-h">Recorded frame cost</h3><p>The highest p95 frame cost of any gesture in ${PERF.scenarios} scenarios, against the ${PERF.budget.toFixed(2)} ms of a 120 Hz frame:</p><span class="big">${PERF.worst.toFixed(2)}<small>ms p95</small></span>
<div class="table-wrap" role="region" tabindex="0" aria-label="Table: worst p95 frame cost by gesture"><table><thead><tr><th scope="col">Worst p95, ms</th>${PERF.barsList.map((b) => `<th scope="col" class="num">${b / 1000}k bars</th>`).join('')}</tr></thead><tbody>${PERF.grid.map((g) => `<tr><td>${esc(g.label)}</td>${g.cells.map((c) => `<td class="num">${c === null ? 'n/a' : c.toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
<p class="note">Cost of our code per frame (input handlers, the chart's frame callbacks, layout of the legend), ${PERF.over} of ${PERF.scenarios} over budget. ${esc(PERF.machine)}${PERF.date ? `, ${esc(PERF.date)}` : ''}. Not a frame rate on a real 120 Hz panel: headless Chromium has no GPU, and canvas rasterisation and compositing are not included. <a href="PERF_HREF">Every scenario and the machine</a>.</p>`;
}

// Glyphs: one soft line family on a 24 grid, drawn in the ink of their host.
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const GLYPH = {
  pen: svg('<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m14 7 3 3"/>'),
  candles: svg('<path d="M7 4v3M7 17v3M17 3v4M17 15v5"/><rect x="5" y="7" width="4" height="10" rx="1"/><rect x="15" y="7" width="4" height="8" rx="1"/>'),
  wave: svg('<path d="M3 15c3 0 3-7 6-7s3 9 6 9 3-6 6-6"/>'),
  panes: svg('<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 14h17M7 11l3-3 3 2 4-4"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  code: svg('<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13"/>'),
  keys: svg('<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/>'),
  shield: svg('<path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6l-7-2.5Z"/><path d="m9 12 2 2 4-4"/>'),
  minus: svg('<path d="M5 12h14"/><circle cx="12" cy="12" r="8.5"/>'),
  gauge: svg('<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="m12 13 4-5"/>'),
  book: svg('<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5v-15Z"/><path d="M5 20.5A2.5 2.5 0 0 1 7.5 18H19v3H7.5"/>'),
  play: svg('<circle cx="12" cy="12" r="8.5"/><path d="m10 8.5 5 3.5-5 3.5v-7Z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'),
  pin: svg('<path d="M4 12h16"/><path d="M8 8h.01M12 16l3-3 3 3"/>'),
  swap: svg('<path d="M7 7h12l-3-3M17 17H5l3 3"/>'),
  box: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  atom: svg('<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-60 12 12)"/>'),
  frame: svg('<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 8.5h18"/>'),
  pulse: svg('<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>'),
  bricks: svg('<rect x="3.5" y="14" width="5" height="5" rx="1"/><rect x="9.5" y="9" width="5" height="5" rx="1"/><rect x="15.5" y="4" width="5" height="5" rx="1"/>'),
  tip: svg('<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-6l-4 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5Z"/><path d="M8 9.5h8M8 12.5h5"/>'),
  list: svg('<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>'),
  scale: svg('<path d="M12 4v16M6 20h12"/><path d="M5 8h14"/><path d="m5 8-2.5 6a2.8 2.8 0 0 0 5 0L5 8ZM19 8l-2.5 6a2.8 2.8 0 0 0 5 0L19 8Z"/>'),
};

/**
 * Every entry, measured now: bundled and minified with esbuild as a bundler would, then gzip (level 9) and brotli
 * (quality 11) with Node's zlib. Rows: [label, min KB, gzip KB, id, brotli KB, line]. `typical` adds what three typical
 * pages load. The script-tag files are read from dist/ as built.
 */
async function measureSizes() {
  const gz = (buf) => gzipSync(buf, { level: 9 }).length;
  const br = (buf) => brotliCompressSync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length;
  const kb = (n) => (n / 1024).toFixed(1);
  const rows = [];
  const bundle = async (entryOrCode) => {
    const opts = { absWorkingDir: pkg, bundle: true, format: 'esm', minify: true, target: 'es2020', write: false, legalComments: 'none', logLevel: 'silent' };
    const res = await build(entryOrCode.endsWith('.ts') ? { ...opts, entryPoints: [entryOrCode] } : { ...opts, stdin: { contents: entryOrCode, resolveDir: pkg, loader: 'ts' } });
    return Buffer.from(res.outputFiles[0].contents);
  };
  const ENTRIES = [
    ['Core (ES module, createChart and the six series)', 'src/index.ts', 'core', 'lite-charts', 'createChart, the six series, price lines, markers, themes, legend, keyboard'],
    ['Indicators entry', 'src/indicators/index.ts', 'indicators', 'lite-charts/indicators', `${CATALOG.length || 'The'} indicators and the catalogue; import one function to keep only it`],
    ...(existsSync(path.join(pkg, 'src', 'drawings', 'index.ts')) ? [['Drawings entry', 'src/drawings/index.ts', 'drawings', 'lite-charts/drawings', `${DRAWING_TOOLS.length} drawing tools, the toolbar, undo and JSON`]] : []),
    ...(LIVE ? [['Live entry', 'src/live/index.ts', 'live', 'lite-charts/live', 'connectLive and the Coinbase, Binance and Kraken providers']] : []),
    ...(existsSync(path.join(pkg, 'src', 'transforms', 'index.ts')) ? [['Transforms entry', 'src/transforms/index.ts', 'transforms', 'lite-charts/transforms', `${CHART_TYPES.length} chart types: Renko, Kagi, point and figure, line break, range bars and more`]] : []),
    ...(existsSync(path.join(pkg, 'src', 'plugins', 'extras', 'index.ts')) ? [['Extras entry', 'src/plugins/extras/index.ts', 'extras', 'lite-charts/extras', 'Tooltips, watermark, alerts, compare, replay, bands, custom series']] : []),
    ...(existsSync(path.join(pkg, 'src', 'widget', 'index.ts')) ? [['Widget entry (includes the chart)', 'src/widget/index.ts', 'widget', 'lite-charts/widget', 'The ready-made chart: toolbar, indicators dialog, ranges; drawings and live load on demand']] : []),
    ['Element entry (includes the chart)', 'src/element/index.ts', 'element', 'lite-charts/element', 'The <chartist-chart> tag'],
    ['React entry (includes the chart)', 'src/react/index.ts', 'react', 'lite-charts/react', 'A component and a hook'],
  ];
  for (const [label, entry, id, name, line] of ENTRIES) {
    const code = await bundle(entry);
    rows.push({ label, id, name, line, min: kb(code.length), gzip: kb(gz(code)), brotli: kb(br(code)) });
  }
  // The drawing tools as a page imports them: the default fifteen, or every tool.
  if (DRAWINGS && FACTS.BASIC_TOOLS) {
    const d = rows.findIndex((r) => r.id === 'drawings');
    const basic = await bundle("export { createDrawingTools, BASIC_TOOLS } from './src/drawings/index.ts';");
    const all = await bundle("export { createDrawingTools, ALL_TOOLS } from './src/drawings/index.ts';");
    rows.splice(d, 1,
      { label: 'Drawings, the default tools', id: 'drawings', name: 'lite-charts/drawings', line: `createDrawingTools with the default ${BASIC_TOOL_COUNT} tools (BASIC_TOOLS), toolbar, undo, JSON`, min: kb(basic.length), gzip: kb(gz(basic)), brotli: kb(br(basic)) },
      { label: 'Drawings, every tool', id: 'drawings-all', name: 'lite-charts/drawings + ALL_TOOLS', line: `All ${DRAWING_TOOLS.length} tools in ${DRAWING_GROUPS.length} groups`, min: kb(all.length), gzip: kb(gz(all)), brotli: kb(br(all)) });
  }
  const FILES = [
    ['Script tag: chartist-lite.iife.min.js', 'dist/chartist-lite.iife.min.js', 'iife-core'],
    ['Script tag: chartist-lite-indicators.iife.min.js', 'dist/chartist-lite-indicators.iife.min.js', 'iife-indicators'],
    ['Script tag: chartist-lite.element.iife.min.js', 'dist/chartist-lite.element.iife.min.js', 'iife-element'],
    ...(LIVE ? [['Script tag: chartist-lite.element-live.iife.min.js', 'dist/chartist-lite.element-live.iife.min.js', 'iife-element-live']] : []),
    ...(WIDGET ? [['Script tag: chartist-lite.terminal.iife.min.js', 'dist/chartist-lite.terminal.iife.min.js', 'terminal']] : []),
  ];
  for (const [label, file, id] of FILES) {
    const buf = readFileSync(path.join(pkg, file));
    rows.push({ label, id, name: path.basename(file), line: '', min: kb(buf.length), gzip: kb(gz(buf)), brotli: kb(br(buf)) });
  }
  // What typical pages load, bundled as a page would import them.
  const typical = [];
  const page = async (label, code, line) => { const b = await bundle(code); typical.push({ label, line, gzip: kb(gz(b)), brotli: kb(br(b)) }); };
  await page('Core only', "export { createChart, CandlestickSeries } from './src/index.ts';", 'createChart and candlesticks');
  await page('Core and three indicators', "export { createChart, CandlestickSeries, LineSeries } from './src/index.ts'; export { sma, ema, rsi } from './src/indicators/index.ts';", 'Candles, two averages and RSI');
  const term = rows.find((r) => r.id === 'terminal');
  if (term) typical.push({ label: 'The full terminal', line: 'One script tag: widget, chart types, live data and drawing tools', gzip: term.gzip, brotli: term.brotli });
  rows.typical = typical;
  return rows;
}
const sizeOf = (rows, id) => rows.find((r) => r.id === id) || null;

// Sizes and posters, measured once, used by the home page, the guides (tokens) and the comparison page.
const SIZES = await measureSizes();
const POSTERS = {};
for (const theme of ['dark', 'light']) {
  const own = path.join(here, 'assets', 'img', `hero-poster-${theme}.jpg`);
  if (existsSync(own)) { POSTERS[theme] = { path: `assets/img/hero-poster-${theme}.jpg`, size: jpegSize(own), src: own }; }
}

// ---------- guides ----------
const GROUPS = [
  { id: 'start', title: 'Start here', blurb: 'Get a chart on the page, then choose how it gets there.' },
  { id: 'build', title: 'Build the chart', blurb: 'Series, chart types, indicators, panes, time, drawing and live data.' },
  { id: 'customise', title: 'Make it yours', blurb: 'Colours, tooltips and alerts, your own marks, and readers who use a keyboard.' },
  { id: 'reference', title: 'Reference', blurb: 'Every export, the indicator catalogue, and how it compares.' },
];
const guideDir = path.join(pkg, 'docs', 'guide');
const guides = readdirSync(guideDir).filter((f) => f.endsWith('.md')).map((f) => {
  const slug = f.replace(/\.md$/, '');
  const { meta, body } = parseFrontMatter(readFileSync(path.join(guideDir, f), 'utf8'));
  if (!meta.title || !meta.description) throw new Error(`docs/guide/${f} needs a title and a description in its front matter`);
  if (!GROUPS.some((g) => g.id === meta.group)) throw new Error(`docs/guide/${f} needs a group: one of ${GROUPS.map((g) => g.id).join(', ')}`);
  return {
    slug, src: `docs/guide/${f}`, out: `guide/${slug}.html`, title: meta.title, description: fillTokens(meta.description, f),
    order: Number(meta.order || 99), group: meta.group, task: fillTokens(meta.task || '', f), summary: fillTokens(meta.summary || meta.description, f),
    layout: meta.layout || 'guide', related: (meta.related || '').split(',').map((s) => s.trim()).filter(Boolean), body,
  };
}).sort((a, b) => a.order - b.order);
const guideBySlug = (s) => guides.find((g) => g.slug === s);

const mdMap = new Map([['README.md', 'readme.html'], ['docs/README.md', 'guide/index.html'], ['docs/PERFORMANCE.md', 'performance.html'], ...guides.map((g) => [g.src, g.out])]);
const assets = new Map(); // dist path -> source file

function renderOptions(page, srcFile, extra = {}) {
  const srcDir = path.posix.dirname(srcFile);
  return {
    ...extra,
    resolveLink(href) {
      if (href.startsWith('#') || /^(https?:|mailto:)/i.test(href)) return { href };
      const [file, hash] = href.split('#');
      const target = path.posix.normalize(path.posix.join(srcDir, file));
      const dest = mdMap.get(target);
      if (dest) return { href: rel(page, dest) + (hash ? `#${hash}` : '') };
      if (REPO) return { href: `${REPO}/blob/HEAD/${target}` };
      warnings.push(`${srcFile}: link to ${target} is not a site page; shown as plain text (set repoUrl in site.config.json to link it)`);
      return { text: true };
    },
    resolveAsset(src) {
      const target = path.posix.normalize(path.posix.join(srcDir, src));
      if (!existsSync(path.join(pkg, target))) { warnings.push(`${srcFile}: image ${target} not found`); return src; }
      const dest = `assets/img/${path.posix.basename(target)}`;
      assets.set(dest, path.join(pkg, target));
      return rel(page, dest);
    },
    imageSize(src) {
      const f = path.join(pkg, path.posix.normalize(path.posix.join(srcDir, src)));
      return existsSync(f) ? pngSize(f) : null;
    },
  };
}

// ---------- live examples ----------
// Names a live example may use, by the script that brings them; a page loads that script when its examples use one.
const EXTRA_NAMES = ['createTooltip', 'createWatermark', 'createImageWatermark', 'createGoToRealtimeButton', 'createRangeSwitcher', 'RANGE_KEYS', 'createPriceAlerts',
  'createCompare', 'createReplay', 'createBands', 'createPartialPriceLine', 'createSessionBreaks', 'createVerticalLine', 'StackedAreaSeries', 'HeatmapSeries',
  'RoundedCandlesSeries', 'WhiskerBoxSeries'];
const TRANSFORM_NAMES = ['CHART_TYPES', 'applyChartType', 'renko', 'lineBreak', 'kagi', 'pointFigure', 'rangeBars', 'HollowCandlestickSeries', 'StepLineSeries',
  'HlcAreaSeries', 'ColumnSeries', 'HighLowSeries', 'KagiSeries', 'PointFigureSeries'];
const WIDGET_NAMES = ['createWidget', 'demoBars', 'CRYPTO_SYMBOLS'];
const usesAny = (fns, names) => fns.some((f) => names.some((n) => new RegExp(`\\b${n}\\b`).test(f.replace(/^[^{]*\{[^}]*\}\s*=\s*api;/, ''))));
const LIVE_NAMES = ['createChart', 'CandlestickSeries', 'BarSeries', 'LineSeries', 'AreaSeries', 'HistogramSeries', 'BaselineSeries',
  'createPriceLine', 'createSeriesMarkers', 'lightTheme', 'darkTheme', 'formatPrice', 'formatPercent', 'MINUS_SIGN',
  'sma', 'ema', 'wma', 'rsi', 'atr', 'obv', 'vwap', 'bollinger', 'donchian', 'macd', 'stochastic', 'supertrend', 'heikinAshi',
  'aggregate', 'createIndicator', 'bars', 'intradayBars', 'benchmark', 'createDrawingTools', 'TOOLS', 'drawingsToJSON', 'output',
  'connectLive', 'coinbase', 'binance', 'kraken', 'PROVIDERS', 'INTERVAL_SECONDS',
  // the extras, the transforms, the widget and the catalogue
  ...EXTRA_NAMES, ...TRANSFORM_NAMES, ...WIDGET_NAMES, 'INDICATORS', 'getIndicator', 'legendLabel', 'longBars', 'compareRows', 'every', 'ALL_TOOLS', 'BASIC_TOOLS'];
const HEIGHTS = new Set(['220', '260', '280', '320', '360', '420', '480', '560']);
const ZONES = [['Asia/Kolkata', 'Kolkata'], ['America/New_York', 'New York'], ['UTC', 'UTC']];

/** The control strip of a live chart. Buttons act on the chart(s) in the same `[data-stage]`. */
function controlsHtml(kind) {
  if (kind === 'zone') return `<div class="seg" role="group" aria-label="Axis time zone">${ZONES.map(([z, l], i) => `<button type="button" data-zone="${z}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>`;
  if (kind === 'theme') return `<div class="seg" role="group" aria-label="Chart theme"><button type="button" data-chart-theme="light" aria-pressed="false">Light</button><button type="button" data-chart-theme="dark" aria-pressed="false">Dark</button></div>`;
  if (kind === 'draw') return `<span class="draw-actions"><button class="btn btn--sm" type="button" data-draw="undo">Undo</button><button class="btn btn--sm" type="button" data-draw="redo">Redo</button><button class="btn btn--sm" type="button" data-draw="clear">Clear</button><button class="btn btn--sm" type="button" data-draw="export">Export JSON</button><button class="btn btn--sm" type="button" data-draw="import">Import it back</button></span>`;
  if (kind === 'market') return `<div class="seg" role="group" aria-label="Interval">${['1m', '5m', '15m', '1h', '1d'].map((v, i) => `<button type="button" data-live-interval="${v}" aria-pressed="${i === 0}">${v}</button>`).join('')}</div><div class="seg" role="group" aria-label="Market">${['BTC-USD', 'ETH-USD', 'SOL-USD'].map((v, i) => `<button type="button" data-live-symbol="${v}" aria-pressed="${i === 0}">${v}</button>`).join('')}</div>`;
  if (kind === 'scale') return `<div class="seg" role="group" aria-label="Price scale mode"><button type="button" data-scale="linear" aria-pressed="true">Linear</button><button type="button" data-scale="log" aria-pressed="false">Log</button><button type="button" data-scale="percent" aria-pressed="false">Percent</button></div>`;
  return '';
}

/**
 * A click-to-connect live demo. Nothing reaches an exchange until the reader presses the button: the stage holds a
 * card that says what will happen, and site.js swaps it for the chart on click. `markup` (element mode) is the
 * `<chartist-chart live>` tag, kept in a <template> until then; `liveId` (code mode) names a compiled example.
 * Returns the stage and the bar under it (status, controls, Disconnect).
 */
function connectStage({ markup, liveId, height = '360', label, controls = '', title = 'Live Bitcoin is off' }) {
  const card = `<div class="connect-card"><span class="connect-ico" aria-hidden="true">${GLYPH.pulse}</span><p class="connect-title">${esc(title)}</p><p class="connect-text">Press Connect and your browser asks Coinbase's public feed for prices directly. Nothing passes through this site, no key is used and nothing is stored.</p><p class="connect-msg" hidden></p><button class="btn btn--primary btn--sm js-only" type="button" data-connect-go>Connect to Coinbase</button></div>`;
  const stage = markup
    ? `<div class="connect h-${height}" data-connect="element" data-label="${esc(label)}">${card}<template data-connect-tpl>${markup}</template></div>`
    : `<div class="connect chart h-${height}" data-connect="code" data-connect-live="${liveId}" data-label="${esc(label)}">${card}</div>`;
  const bar = `<div class="demo-bar connect-bar"><span class="live-state" data-s="off" role="status"><span class="dot" aria-hidden="true"></span><span class="live-word">Off</span></span>${controls ? `<span class="connect-ctl" hidden>${controls}</span>` : ''}<button class="btn btn--sm" type="button" data-connect-stop hidden>Disconnect</button></div>`;
  return { stage, bar };
}

function makeLive(slug, fns) {
  let n = 0;
  return ({ lang, code, attrs, heading }) => {
    n++;
    const id = `${slug}-${n}`;
    const h = HEIGHTS.has(String(attrs.height)) ? attrs.height : '320';
    const label = `Live example: ${heading || 'chart'}`;
    if (attrs.connect) {
      // Click-to-connect: the code (or the markup) runs only after the reader presses Connect.
      let cs;
      if (lang === 'html') {
        const markup = code.split('\n').filter((l) => !/<script\s+src=/.test(l)).join('\n').trim();
        cs = connectStage({ markup, height: h, label });
      } else {
        const runnable = code.replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '').trim();
        fns.push(`${JSON.stringify(id)}: function (api) { const { ${LIVE_NAMES.join(', ')} } = api; {\n${runnable}\n} }`);
        cs = connectStage({ liveId: id, height: h, label, controls: attrs.controls ? controlsHtml(attrs.controls) : '' });
      }
      const cnote = lang === 'html'
        ? 'This markup runs on this page as written once you press Connect, with the element-live script already loaded. Until then nothing is requested.'
        : 'This code runs on this page as written once you press Connect. Until then nothing is requested. The import lines are left to your bundler.';
      return `<figure class="live window" data-stage>${cs.stage}${cs.bar}${codeBlock(code, lang, 'code--live')}<figcaption class="live-note">${cnote}</figcaption></figure>`;
    }
    const controls = `<div class="demo-bar"><span class="live-badge">Live</span>${attrs.controls ? `<span class="js-only">${controlsHtml(attrs.controls)}</span>` : ''}</div>`;
    let stage;
    if (lang === 'html') {
      // The HTML runs as markup: the element script is loaded by the page, so the script tag line is dropped.
      const markup = code.split('\n').filter((l) => !/<script\s+src=/.test(l)).join('\n').trim();
      stage = markup;
    } else {
      const runnable = code.replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '').trim();
      fns.push(`${JSON.stringify(id)}: function (api) { const { ${LIVE_NAMES.join(', ')} } = api; {\n${runnable}\n} }`);
      stage = `<div class="chart h-${h}" data-demo="live" data-live="${id}" data-label="${esc(label)}"><p class="chart-fallback">The live chart appears here when JavaScript runs. The code below draws it.</p></div>`;
      if (attrs.output || attrs.controls === 'draw') stage += `<pre class="out js-only" data-out tabindex="0" aria-live="polite" aria-label="Output of this example">Output appears here.</pre>`;
    }
    const note = attrs.output ? 'This code runs on this page as written, with <code>bars</code> set to invented demo data; <code>output(text)</code> is a helper of this site that writes to the panel above.' : lang === 'html'
      ? 'This markup runs on this page as written, with the element script already loaded.'
      : 'This code runs on this page as written, with <code>bars</code> set to invented demo data. The import lines are left to your bundler.';
    return `<figure class="live window" data-stage>${controls}${stage}${codeBlock(code, lang, 'code--live')}<figcaption class="live-note">${note}</figcaption></figure>`;
  };
}

/** The one-tag live chart, as the site uses it (the theme is set by the page). */
function liveTag(height, label) {
  return `<chartist-chart live symbol="BTC-USD" interval="1m" provider="coinbase" volume height="${height}" aria-label="${esc(label)}"><p class="live-loading">Loading Bitcoin from the exchange.</p></chartist-chart>`;
}

// ---------- page chrome ----------
const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
  sun: '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>',
  moon: '<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  github: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.7c-2.6.6-3.2-1.2-3.2-1.2-.4-1.1-1-1.4-1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.1-.2-4.3-1-4.3-4.7 0-1 .4-1.9 1-2.6-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.6 1a9 9 0 0 1 4.8 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.5.6.7 1 1.6 1 2.6 0 3.7-2.2 4.5-4.3 4.7.3.3.6.8.6 1.6v2.4c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.5Z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};
const MARK = '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9"/><path d="M10 9v14M16 12v11M22 7v12" fill="none" stroke-width="3" stroke-linecap="round"/></svg>';
const FAVICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#1D1D1F"/><path d="M10 9v14M16 12v11M22 7v12" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>')}`;
const NAV = [
  { label: 'Guide', path: 'guide/index.html', match: (p) => p.startsWith('guide/') && p !== 'guide/api-reference.html' },
  { label: 'Examples', path: 'examples.html', match: (p) => p === 'examples.html' },
  { label: 'API', path: 'guide/api-reference.html', match: (p) => p === 'guide/api-reference.html' },
  { label: 'README', path: 'readme.html', match: (p) => p === 'readme.html' },
];

function ld(obj) { return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`; }
function author() { return { '@type': config.author.type, name: config.author.name, url: config.author.url }; }
function crumbList(crumbs) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: baseUrl + (c.path === 'index.html' ? '' : c.path) })),
  };
}
const ogImage = { path: 'assets/og-image.png', size: pngSize(path.join(pkg, config.ogImageSource)) };
const OG_ALT = 'A daily candlestick chart with a 20-bar moving average, drawn by Chartist Lite from demo data.';

// One glyph per guide page, drawn in the ink of its row.
const TASK_ICONS = {
  'getting-started': 'play', embedding: 'code', 'series-types': 'candles', indicators: 'wave', 'panes-and-scales': 'panes',
  'time-and-time-zones': 'clock', 'drawing-tools': 'pen', theming: 'sun', plugins: 'pin', accessibility: 'keys',
  'api-reference': 'book', 'coming-from-lightweight-charts': 'swap', 'live-data': 'pulse',
  widget: 'frame', 'chart-types': 'bricks', extras: 'tip', 'indicator-catalogue': 'list', 'how-it-compares': 'scale',
};

/** The guide navigation panel: groups of icon rows, the current page with its one-line task, and a foot with
 *  "n of N" and previous / next. Used beside the page on wide screens and inside the drawer elsewhere. */
function guideGroupsHtml(current, where = 'side') {
  const idx = guides.findIndex((g) => g.out === current);
  const groups = GROUPS.map((grp) => {
    const items = guides.filter((g) => g.group === grp.id);
    return `<div class="nav-group"><p class="nav-group-title">${esc(grp.title)}</p><ul class="nav-list">${items.map((g) => `<li><a href="${rel(current, g.out)}"${g.out === current ? ' aria-current="page"' : ''}><span class="nav-ico">${GLYPH[TASK_ICONS[g.slug]] || GLYPH.book}</span><span class="nav-text"><span class="nav-label">${esc(g.title)}</span><span class="nav-desc">${esc(g.task)}</span></span></a></li>`).join('')}</ul></div>`;
  }).join('');
  const prev = idx > 0 ? guides[idx - 1] : null;
  const next = idx >= 0 && idx < guides.length - 1 ? guides[idx + 1] : null;
  const step = (g, dir) => (g ? `<a class="nav-step" href="${rel(current, g.out)}" aria-label="${dir === 'prev' ? 'Previous' : 'Next'}: ${esc(g.title)}">${dir === 'prev' ? ICON.back : ICON.arrow}</a>` : `<span class="nav-step" aria-hidden="true"></span>`);
  const foot = idx >= 0
    ? `<div class="nav-foot"><span class="nav-pos">${idx + 1} of ${guides.length}</span><span class="nav-bar" aria-hidden="true">${guides.map((_, k) => `<i${k <= idx ? ' class="on"' : ''}></i>`).join('')}</span>${step(prev, 'prev')}${step(next, 'next')}</div>`
    : `<div class="nav-foot"><span class="nav-pos">${guides.length} pages</span></div>`;
  return `<div class="nav-panel nav-panel--${where}"><div class="nav-scroll" data-nav-scroll tabindex="-1">${groups}</div>${foot}</div>`;
}

function layout(page) {
  const p = page.path;
  const url = baseUrl + (p === 'index.html' ? '' : p);
  const nav = NAV.map((n) => `<a href="${rel(p, n.path)}"${n.match(p) ? ' aria-current="page"' : ''}>${n.label}</a>`).join('');
  const drawerMain = `<ul class="nav-list main-links">${[{ label: 'Home', path: 'index.html', match: (x) => x === 'index.html' }, ...NAV].map((n) => `<li><a href="${rel(p, n.path)}"${n.match(p) ? ' aria-current="page"' : ''}>${n.label}</a></li>`).join('')}</ul>`;
  const ldBlocks = [...(page.ld || []), ...(page.crumbs && page.crumbs.length > 1 ? [crumbList(page.crumbs)] : [])].map(ld).join('\n');
  const img = baseUrl + ogImage.path;
  const root = rootOf(p);
  const g = (s) => rel(p, guideBySlug(s).out);
  const dataAttrs = [`data-assets="${root}assets/"`, `data-root="${root}"`, page.live ? `data-live="${page.live}"` : '', page.demos ? 'data-demos' : '', page.drawings ? 'data-drawings' : '', page.liveLib ? 'data-live-lib' : '', page.liveElement ? 'data-element-live' : '', page.libs && page.libs.length ? `data-libs="${page.libs.join(' ')}"` : ''].filter(Boolean).join(' ');
  return `<!doctype html>
<html lang="${config.locale}" ${dataAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">${page.noindex ? '\n<meta name="robots" content="noindex">' : ''}
<link rel="canonical" href="${esc(url)}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#000000">
<meta property="og:type" content="${page.ogType || 'website'}">
<meta property="og:site_name" content="${esc(NAME)}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="en_GB">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="${ogImage.size.width}">
<meta property="og:image:height" content="${ogImage.size.height}">
<meta property="og:image:alt" content="${esc(OG_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${esc(img)}">
<meta name="twitter:image:alt" content="${esc(OG_ALT)}">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="${root}assets/site.css">
<script src="${root}assets/boot.js"></script>
<script src="${root}assets/site.js" defer></script>
${ldBlocks}
</head>
<body class="${page.bodyClass || ''}">
<a class="skip" href="#main">Skip to the content</a>
<header class="site-header">
  <div class="header-row">
    <a class="brand" href="${rel(p, 'index.html')}">${MARK}<span>${esc(NAME)}</span><span class="ver">${esc(VERSION)}</span></a>
    <nav class="main-nav" aria-label="Main">${nav}</nav>
    <div class="header-tools">
      ${REPO ? `<a class="icon-btn gh-link" href="${esc(REPO)}" rel="noopener" aria-label="Source on GitHub">${ICON.github}</a>` : ''}
      <a class="btn btn--primary btn--sm header-cta" href="${rel(p, 'guide/getting-started.html')}">Get started</a>
      <div class="tool-group js-only"><button class="search-btn" type="button" id="search-open" aria-label="Search the documentation" aria-keyshortcuts="/">${ICON.search}<span class="label">Search</span><kbd>/</kbd></button><button class="icon-btn" id="theme-toggle" type="button" aria-pressed="true" aria-label="Dark theme">${ICON.moon}${ICON.sun}</button></div>
      <button class="icon-btn menu-btn js-only" id="menu-open" type="button" aria-label="Open the menu" aria-haspopup="dialog" aria-controls="drawer">${ICON.menu}</button>
    </div>
  </div>
</header>
<dialog class="drawer" id="drawer" aria-label="Menu">
  <div class="drawer-head"><a class="brand" href="${rel(p, 'index.html')}">${MARK}<span>${esc(NAME)}</span></a><button class="icon-btn" type="button" data-close aria-label="Close the menu">${ICON.close}</button></div>
  <nav class="drawer-body" aria-label="Menu">${drawerMain}${guideGroupsHtml(p, 'drawer')}</nav>
</dialog>
<dialog class="search-dialog" id="search" aria-label="Search the documentation">
  <div class="search-field">${ICON.search}<input id="search-input" type="search" placeholder="Search guides, options and API" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="search-results" aria-autocomplete="list" aria-label="Search"><button class="icon-btn" type="button" data-close aria-label="Close search">${ICON.close}</button></div>
  <ul class="search-results" id="search-results" role="listbox" aria-label="Results"></ul>
  <p class="search-empty" id="search-status" role="status">Type to search every page and heading.</p>
  <div class="search-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></div>
</dialog>
<main id="main" tabindex="-1">
${page.body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand"><a class="brand" href="${rel(p, 'index.html')}">${MARK}<span>${esc(NAME)}</span></a><p>${esc(config.tagline)} Version ${esc(VERSION)}, not yet published to npm.</p></div>
      <div class="footer-col"><h2 id="f-docs">Docs</h2><ul class="footer-nav" aria-labelledby="f-docs"><li><a href="${rel(p, 'guide/index.html')}">Guide</a></li><li><a href="${g('getting-started')}">Getting started</a></li><li><a href="${rel(p, 'examples.html')}">Examples</a></li><li><a href="${g('api-reference')}">API reference</a></li></ul></div>
      <div class="footer-col"><h2 id="f-guides">Topics</h2><ul class="footer-nav" aria-labelledby="f-guides"><li><a href="${g('series-types')}">Series types</a></li><li><a href="${g('indicators')}">Indicators</a></li><li><a href="${g('time-and-time-zones')}">Time zones</a></li><li><a href="${g('accessibility')}">Accessibility</a></li></ul></div>
      <div class="footer-col"><h2 id="f-project">Project</h2><ul class="footer-nav" aria-labelledby="f-project"><li><a href="${rel(p, 'readme.html')}">README</a></li><li><a href="${g('coming-from-lightweight-charts')}">Coming from Lightweight Charts</a></li><li><a href="${esc(config.author.url)}" rel="noopener">${esc(config.author.name)}</a></li></ul></div>
    </div>
    <div class="footer-legal">
      <p>${esc(NAME)} ${esc(VERSION)} is an independent open-source project, written from scratch. It is not affiliated with, endorsed by or derived from TradingView or any other charting product. Licence: ${esc(config.license.name)}.</p>
      <p>The home page's hero chart shows real prices by default, and the other live demos show them once you press Connect: they come straight from the exchange's public feed (Coinbase first) to your browser, with nothing in between, and are indicative only. Every other chart is drawn from invented demo data. Nothing here is investment advice. Type: Chartist Sans Flex (from Google Sans Flex by Google), Chartist Sans (from Plus Jakarta Sans by Tokotype) and Chartist Serif (from Instrument Serif by Instrument), under the SIL Open Font License 1.1.</p>
    </div>
  </div>
</footer>
</body>
</html>
`;
}

const CAT_NAMES = { trend: 'Trend', momentum: 'Momentum', volatility: 'Volatility', volume: 'Volume', other: 'Other' };
/** The indicator catalogue as a table, from the catalog itself: filter, category switch, and a live preview. */
function catalogueHtml() {
  if (!CATALOG.length) return '<p>The catalogue is not built in this version.</p>';
  const cats = Object.keys(CAT_NAMES).filter((c) => CATALOG.some((x) => x.category === c));
  const fmt = (v) => (typeof v === 'number' ? String(v).replace('-', '\u2212') : String(v));
  const inputText = (i) => {
    const range = i.min !== undefined && i.max !== undefined ? ` (${fmt(i.min)} to ${fmt(i.max)})` : '';
    const opts = i.type === 'select' ? ` (${i.options.join(', ')})` : '';
    return `<span class="in"><code>${esc(i.key)}</code> ${esc(fmt(i.default))}${esc(range || opts)}</span>`;
  };
  const rows = CATALOG.map((x) => `<tr data-cat="${x.category}" data-text="${esc(`${x.id} ${x.name} ${x.shortName} ${x.category}`.toLowerCase())}"><td><button class="cat-name" type="button" data-preview="${esc(x.id)}" aria-label="Preview ${esc(x.name)}">${esc(x.name)}</button></td><td><code>${esc(x.id)}</code></td><td>${CAT_NAMES[x.category] || esc(x.category)}</td><td>${x.overlay ? 'On price' : 'Own pane'}</td><td class="inputs">${x.inputs.length ? x.inputs.map(inputText).join('') : '<span class="muted">none</span>'}</td><td>${esc(x.outputs.map((o) => o.label).join(', '))}</td></tr>`).join('');
  return `<div class="catalogue" data-catalogue>
<div class="cat-preview window" data-stage><div class="window-bar"><span class="window-title" data-preview-title>Preview</span><span class="muted cat-hint">Pick a name in the table</span></div><div class="chart h-320" data-catalogue-chart data-label="Live preview of the chosen indicator on demo data"><p class="chart-fallback">The preview appears here when JavaScript runs.</p></div></div>
<div class="cat-tools js-only"><label class="cat-filter">${ICON.search}<span class="visually-hidden">Filter the catalogue</span><input id="cat-filter" type="search" placeholder="Filter: rsi, average, volume..." autocomplete="off" spellcheck="false"></label><div class="seg" role="group" aria-label="Category"><button type="button" data-cat-filter="all" aria-pressed="true">All ${CATALOG.length}</button>${cats.map((c) => `<button type="button" data-cat-filter="${c}" aria-pressed="false">${CAT_NAMES[c]} ${CATALOG.filter((x) => x.category === c).length}</button>`).join('')}</div><p class="api-count" id="cat-count" role="status"></p></div>
<div class="table-wrap" role="region" tabindex="0" aria-label="Table: the indicator catalogue"><table class="cat-table"><thead><tr><th scope="col">Indicator</th><th scope="col">Id</th><th scope="col">Category</th><th scope="col">Drawn</th><th scope="col">Inputs and defaults</th><th scope="col">Outputs</th></tr></thead><tbody>${rows}</tbody></table></div>
</div>`;
}

/** Every drawing tool by toolbar group, read from the source: id, name, key, points, and whether it is a default tool. */
function drawingToolsHtml() {
  if (!DRAWING_GROUPS.length) return '<p>The drawing tools are not built in this version.</p>';
  const basic = new Set((FACTS.BASIC_TOOLS || []).map((t) => t.id));
  return `<div class="table-wrap" role="region" tabindex="0" aria-label="Table: every drawing tool by group"><table><thead><tr><th scope="col">Group</th><th scope="col">Tool</th><th scope="col">Id</th><th scope="col">Key</th><th scope="col" class="num">Points</th><th scope="col">Default</th></tr></thead><tbody>${DRAWING_GROUPS.map((g) => g.tools.map((t, i) => `<tr><td>${i === 0 ? esc(g.label) : ''}</td><td>${esc(t.label)}</td><td><code>${esc(t.id)}</code></td><td>${t.key ? `<kbd>${esc(t.key)}</kbd>` : ''}</td><td class="num">${t.points === 0 ? 'freehand' : t.points}</td><td>${basic.has(t.id) ? 'yes' : ''}</td></tr>`).join('')).join('')}</tbody></table></div>`;
}

/** The "what you load" tables: every entry with gzip and brotli, then three typical pages. */
function sizeTables(sizes, p) {
  const entries = sizes.filter((r) => r.line && !r.id.startsWith('iife') && r.id !== 'terminal');
  const term = sizeOf(sizes, 'terminal');
  const rows = [...entries, ...(term ? [{ ...term, name: 'chartist-lite.terminal.iife.min.js', line: 'One script tag: the widget with chart types, live data and drawing tools, and the tags' }] : [])];
  const t1 = `<div class="table-wrap" role="region" tabindex="0" aria-label="Table: size of every entry"><table class="sizes"><caption class="visually-hidden">Size of every entry</caption><thead><tr><th scope="col">Entry</th><th scope="col">What it brings</th><th scope="col" class="num">gzip</th><th scope="col" class="num">brotli</th></tr></thead><tbody>${rows.map((r) => `<tr><td><code>${esc(r.name)}</code></td><td>${esc(r.line)}</td><td class="num">${r.gzip} KB</td><td class="num">${r.brotli} KB</td></tr>`).join('')}</tbody></table></div>`;
  const t2 = `<div class="typical">${sizes.typical.map((r) => `<div class="card typical-card"><p class="k">${esc(r.label)}</p><p class="v"><span class="num">${r.gzip}</span> KB gzip</p><p class="sub"><span class="num">${r.brotli}</span> KB brotli · ${esc(r.line)}</p></div>`).join('')}</div>`;
  return `${t2}${t1}<p class="note-line">Measured when this site was built: each entry bundled and minified with esbuild as a bundler would, then compressed with Node's zlib (gzip level 9, brotli quality 11). The script tag files are the ones in <code>dist/</code>. Run <code>npm run size</code> for the gzip figures.</p>`;
}

// ---------- pages ----------
const pages = [];
const liveBundles = new Map(); // page path -> [fn source]
const liveSources = {};         // live example id -> the code it runs (the gallery's "Get this code" shows the same)
const searchDocs = [];


const pad2 = (n) => String(n).padStart(2, '0');
/** The chapter capsule: numbered coloured discs; the current one opens to show its title (scroll-spy in site.js). */
function chaptersNav(items, label) {
  return `<nav class="chapters" aria-label="${esc(label)}">${items.map((c, i) => `<a class="d-${(i % 5) + 1}" href="#${c.id}" aria-label="${pad2(i + 1)}: ${esc(c.text)}"${i === 0 ? ' aria-current="true"' : ''}><span class="disc" aria-hidden="true">${pad2(i + 1)}</span><span class="ct" aria-hidden="true">${esc(c.text)}</span></a>`).join('')}</nav>`;
}
/** The label that opens a chapter: "02 | Title", a thin rule, and "02 / 09" with ticks at the right. */
function chapterLabel(i, total, title) {
  const ticks = Array.from({ length: total }, (_, k) => `<i${k === i ? ' class="on"' : ''}></i>`).join('');
  return `<div class="chapter-label"><span class="chapter-tag"><span class="n">${pad2(i + 1)}</span><span class="sep" aria-hidden="true"></span><span class="t">${esc(title)}</span></span><span class="chapter-rule" aria-hidden="true"></span><span class="chapter-progress"><span class="ticks" aria-hidden="true">${ticks}</span>${pad2(i + 1)} / ${pad2(total)}</span></div>`;
}

/** Numbers a guide may name as {{token}}: read from the source and from measurements at build time, never typed. */
function tokens() {
  const t = {
    indicators: CATALOG.length, chartTypes: CHART_TYPES.length, drawingTools: DRAWING_TOOLS.length, basicTools: BASIC_TOOL_COUNT,
    drawingGroups: DRAWING_GROUPS.length, seriesTypes: SERIES_COUNT,
    'perf.worst': PERF ? PERF.worst.toFixed(2) : 'n/a', 'perf.scenarios': PERF ? PERF.scenarios : 'n/a', 'perf.budget': PERF ? PERF.budget.toFixed(2) : '8.33',
  };
  for (const r of SIZES) { t[`size.${r.id}.gzip`] = r.gzip; t[`size.${r.id}.brotli`] = r.brotli; }
  for (const [i, r] of SIZES.typical.entries()) { t[`typical.${i}.gzip`] = r.gzip; t[`typical.${i}.brotli`] = r.brotli; }
  return t;
}
function fillTokens(text, srcFile) {
  const t = tokens();
  return text.replace(/\{\{([\w.-]+)\}\}/g, (m, k) => { if (k in t) return String(t[k]); warnings.push(`${srcFile}: unknown token ${m}`); return m; });
}

function docPage({ path: p, src, title, description, body: rawBody, group, prevNext, related, crumbs, ld: ldExtra, live, entries, html: allowHtml }) {
  const body = fillTokens(rawBody, src);
  const fns = [];
  const md = renderMarkdown(body, renderOptions(p, src, { live: live ? makeLive(live, fns) : null, entries, html: !!allowHtml }));
  if (fns.length) liveBundles.set(p, fns);
  const usesDrawings = fns.some((f) => f.includes('createDrawingTools'));
  const usesLive = LIVE && fns.some((f) => f.includes('connectLive'));
  const libs = [usesAny(fns, EXTRA_NAMES) && EXTRAS ? 'extras' : '', usesAny(fns, TRANSFORM_NAMES) && TRANSFORMS ? 'transforms' : '', usesAny(fns, WIDGET_NAMES) && WIDGET ? 'widget' : ''].filter(Boolean);
  const usesLiveElement = LIVE && md.html.includes('data-connect="element"');
  const h1Match = /<h1 id="[^"]*">([\s\S]*?)<\/h1>/.exec(md.html);
  md.html = md.html.replace('<p>@@CATALOGUE@@</p>', catalogueHtml);
  md.html = md.html.replace('<p>@@DRAWING_TOOLS@@</p>', drawingToolsHtml);
  let html = md.html.replace(/<h1 id="[^"]*">[\s\S]*?<\/h1>\n?/, '');
  let lead = '';
  const firstP = /^<p>([\s\S]*?)<\/p>\n?/.exec(html);
  if (firstP) { lead = firstP[1]; html = html.slice(firstP[0].length); }
  const h2s = md.headings.filter((h) => h.level === 2);
  h2s.forEach((h, i) => { html = html.replace(`<h2 id="${h.id}">`, `${chapterLabel(i, h2s.length, title)}<h2 id="${h.id}">`); });
  const filter = entries ? `<div class="api-filter js-only"><label>${ICON.search}<span class="visually-hidden">Filter the reference</span><input id="api-filter" type="search" placeholder="Filter: setData, priceScale, legend..." autocomplete="off" spellcheck="false"></label><p class="api-count" id="api-count" role="status"></p></div>` : '';
  const pager = prevNext ? `<nav class="pager" aria-label="Previous and next guide">${prevNext.prev ? `<a class="prev" href="${rel(p, prevNext.prev.out)}" rel="prev"><small>Previous</small>${esc(prevNext.prev.title)}</a>` : ''}${prevNext.next ? `<a class="next" href="${rel(p, prevNext.next.out)}" rel="next"><small>Next</small>${esc(prevNext.next.title)}</a>` : ''}</nav>` : '';
  const onward = prevNext && prevNext.next
    ? `<p class="onward">Next, read <a href="${rel(p, prevNext.next.out)}">${esc(prevNext.next.title)}</a>: ${esc(lowerFirst(prevNext.next.summary))}</p>`
    : `<p class="onward">That is the whole guide. Try the <a href="${rel(p, 'examples.html')}">examples</a>, or go back to <a href="${rel(p, 'guide/index.html')}">the guide index</a>.</p>`;
  const relatedHtml = related && related.length ? `<nav class="related" aria-label="Related guides"><span class="k">Related</span>${related.map((r) => `<a href="${rel(p, r.out)}">${esc(r.title)}</a>`).join('')}</nav>` : '';
  const crumb = crumbs && crumbs.length > 1 ? `<nav class="crumb" aria-label="Breadcrumb">${crumbs.slice(1, -1).map((c) => `<a href="${rel(p, c.path)}">${esc(c.name)}</a><span class="sep" aria-hidden="true">›</span>`).join('')}<span aria-current="page">${esc(crumbs[crumbs.length - 1].name)}</span></nav>` : '';
  const article = `<article class="doc prose">
<button class="guide-menu js-only" type="button" data-open-drawer aria-haspopup="dialog" aria-controls="drawer"><span class="nav-ico">${GLYPH[TASK_ICONS[(guides.find((g) => g.out === p) || {}).slug]] || GLYPH.book}</span><span class="nav-text"><span class="nav-desc">Guide menu</span><span class="nav-label">${esc(title)}</span></span>${ICON.menu}</button>
<header class="doc-head">${crumb}${group ? `<p class="eyebrow">${esc(group)}</p>` : ''}<h1 id="top">${h1Match ? h1Match[1] : esc(title)}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</header>
${h2s.length >= 2 ? chaptersNav(h2s, 'Chapters on this page') : ''}
${filter}
${html}
${relatedHtml}
${pager}
${onward}
</article>`;
  pages.push({
    path: p, title: `${title} | ${NAME}`, description, crumbs, ogType: 'article', drawings: usesDrawings, liveLib: usesLive, liveElement: usesLiveElement, libs, live: fns.length ? `live/${p.replace(/\.html$/, '').replace(/\//g, '-')}.js` : null,
    bodyClass: 'docs-page', ld: ldExtra,
    body: `<div class="docs"><nav class="docs-nav" aria-label="Guide">${guideGroupsHtml(p)}</nav>${article}${h2s.length >= 2 ? `<aside class="docs-toc"><nav class="page-toc" aria-label="On this page"><p class="toc-title">On this page</p><ul>${h2s.map((h, i) => `<li><a href="#${h.id}"${i === 0 ? ' aria-current="true"' : ''}>${esc(h.text)}</a></li>`).join('')}</ul></nav></aside>` : ''}</div>`,
  });
  searchDocs.push({ t: title, u: p, d: description, s: md.headings.filter((h) => h.level <= 3).map((h) => [h.text, h.id, firstSentence(h.lead)]) });
}
function lowerFirst(s) { return s ? s[0].toLowerCase() + s.slice(1) : s; }
function firstSentence(t) { if (!t) return ''; const m = /^(.{20,220}?[.:])\s/.exec(t + ' '); return (m ? m[1] : t.slice(0, 200)).trim(); }

guides.forEach((g, i) => {
  const grp = GROUPS.find((x) => x.id === g.group);
  docPage({
    path: g.out, src: g.src, title: g.title, description: g.description, body: g.body, group: grp.title,
    prevNext: { prev: guides[i - 1], next: guides[i + 1] }, related: g.related.map(guideBySlug).filter(Boolean),
    crumbs: [{ name: 'Home', path: 'index.html' }, { name: 'Guide', path: 'guide/index.html' }, { name: g.title, path: g.out }],
    ld: [{ '@context': 'https://schema.org', '@type': 'TechArticle', headline: g.title, description: g.description, inLanguage: config.locale, url: baseUrl + g.out, author: author(), isPartOf: { '@type': 'WebSite', name: NAME, url: baseUrl }, about: { '@type': 'SoftwareSourceCode', name: NAME } }],
    live: g.slug, entries: g.layout === 'api',
  });
});

// README, in the docs frame.
docPage({
  path: 'readme.html', src: 'README.md', html: true, title: 'README', description: `The ${NAME} README: what it is, how to install and use it, the feature list with measured sizes, what it is not, and how it differs in approach.`,
  body: read('README.md'), group: 'Project',
  crumbs: [{ name: 'Home', path: 'index.html' }, { name: 'README', path: 'readme.html' }],
  ld: [{ '@context': 'https://schema.org', '@type': 'TechArticle', headline: `${NAME} README`, inLanguage: config.locale, url: baseUrl + 'readme.html', author: author(), isPartOf: { '@type': 'WebSite', name: NAME, url: baseUrl } }],
});
{ const r = pages.find((x) => x.path === 'readme.html'); r.title = `README: ${NAME} overview, install and features`; }

// The frame budget report written by `npm run bench`, as a page.
if (existsSync(path.join(pkg, 'docs', 'PERFORMANCE.md'))) {
  docPage({
    path: 'performance.html', src: 'docs/PERFORMANCE.md', title: 'Performance',
    description: `${NAME} frame cost against the 8.33 ms of a 120 Hz frame and the 6.94 ms of 144 Hz: every measured scenario, the machine, and what was not measured.`,
    body: read('docs/PERFORMANCE.md'), group: 'Project',
    crumbs: [{ name: 'Home', path: 'index.html' }, { name: 'Performance', path: 'performance.html' }],
    ld: [{ '@context': 'https://schema.org', '@type': 'TechArticle', headline: `${NAME} performance`, inLanguage: config.locale, url: baseUrl + 'performance.html', author: author(), isPartOf: { '@type': 'WebSite', name: NAME, url: baseUrl } }],
  });
  pages.find((x) => x.path === 'performance.html').title = `Performance: frame cost against 120 Hz | ${NAME}`;
}

// Guide index: cards by task.
{
  const p = 'guide/index.html';
  let k = 0;
  const body = `<section class="index-panel"><div class="wrap"><nav class="crumb" aria-label="Breadcrumb"><a href="${rel(p, 'index.html')}">${esc(NAME)}</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">Guide</span></nav>
<h1 id="top">Learn it one task <span class="serif-frame">at a time.</span></h1><p class="lead">${['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'][guides.length] || guides.length} short pages, each about one job. Start with Getting started; every page after it has live charts you can touch and code you can copy.</p></div></section>
<div class="wrap">
${GROUPS.map((grp) => `<section class="task-group" aria-labelledby="g-${grp.id}"><div class="task-group-head"><h2 id="g-${grp.id}">${esc(grp.title)}</h2><p>${esc(grp.blurb)}</p></div><ul class="task-grid">${guides.filter((x) => x.group === grp.id).map((x) => { k++; return `<li><a class="card task-card" href="${rel(p, x.out)}"><span class="tile tile--${((k - 1) % 5) + 1}">${GLYPH[TASK_ICONS[x.slug]] || GLYPH.book}</span><p class="task">${esc(x.task)}</p><h3>${esc(x.title)}</h3><p>${esc(x.summary)}</p><span class="go">Read the guide ${ICON.arrow}</span></a></li>`; }).join('')}</ul></section>`).join('\n')}
</div>`;
  pages.push({
    path: p, title: `Guide: how to use ${NAME}`, crumbs: [{ name: 'Home', path: 'index.html' }, { name: 'Guide', path: p }],
    description: `Guides for ${NAME}, grouped by task: getting started, embedding, series types, indicators, panes, time zones, live data, theming, plugins, accessibility and the API.`,
    body,
  });
  searchDocs.push({ t: 'Guide', u: p, d: 'All guides, grouped by task.', s: [] });
}

// Examples gallery.
{
  const p = 'examples.html';
  const g = (s) => rel(p, guideBySlug(s).out);
  const KINDS = [['all', 'All'], ['series', 'Series'], ['indicators', 'Indicators'], ['panes', 'Panes and scales'], ['time', 'Time'], ...(DRAWINGS ? [['drawings', 'Drawings']] : []), ['element', 'Element'], ...(LIVE ? [['live', 'Live']] : [])];
  const demo = makeBars(60, 19, 120);
  const hi = Math.max(...demo.map((b) => b.high));
  const lo = Math.min(...demo.map((b) => b.low));
  const first = demo[0]; const last = demo[demo.length - 1];
  const fb = (cap) => `<table><caption>${cap}</caption><tr><th>Fact</th><th>Value</th></tr><tr><td>First bar</td><td>${first.time}, close ${first.close.toFixed(2)}</td></tr><tr><td>Last bar</td><td>${last.time}, close ${last.close.toFixed(2)}</td></tr><tr><td>Highest high</td><td>${hi.toFixed(2)}</td></tr><tr><td>Lowest low</td><td>${lo.toFixed(2)}</td></tr><tr><td>Bars</td><td>${demo.length}</td></tr></table>`;
  const ohlc = JSON.stringify(demo.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume })));
  const vals = JSON.stringify(demo.map((b) => ({ time: b.time, value: b.close })));
  const ELEMENTS = {
    'element-candles': `<chartist-chart type="candlestick" volume height="240" aria-label="Demo candlestick chart with volume, from the custom element"><script type="application/json">${ohlc}</script>${fb('Demo bars for the candlestick element')}</chartist-chart>`,
    'element-area': `<chartist-chart type="area" height="240" aria-label="Demo area chart, from the custom element"><script type="application/json">${vals}</script>${fb('Demo closing values for the area element')}</chartist-chart>`,
  };
  // The feature gallery: every tab's code compiled into this page's live script, run as shown.
  const FX = features(CHART_TYPES).filter((f) => (TRANSFORMS || f.id !== 'types') && (EXTRAS || !['ranges', 'compare', 'latest', 'tooltips', 'alerts', 'replay', 'bands', 'custom'].includes(f.id)) && (DRAWINGS || f.id !== 'drawings') && (WIDGET || f.id !== 'tags'));
  const fxFns = [];
  const fxCards = FX.map((f) => {
    const ids = f.tabs.map((t, k) => `fx-${f.id}-${k}`);
    f.tabs.forEach((t, k) => {
      if (t.lang === 'html') { liveSources[ids[k]] = t.code.split('\n').filter((l) => !/<script\s+src=/.test(l)).join('\n').trim(); return; }
      const runnable = t.code.replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '').trim();
      liveSources[ids[k]] = runnable;
      fxFns.push(`${JSON.stringify(ids[k])}: function (api) { const { ${LIVE_NAMES.join(', ')} } = api; {\n${runnable}\n} }`);
    });
    const label = `${f.title}: live example`;
    return `<article class="card fx-card" id="fx-${f.id}" aria-labelledby="fx-${f.id}-h">
<div class="fx-head"><h2 id="fx-${f.id}-h">${esc(f.title)}</h2><div class="seg fx-tabs js-only" role="group" aria-label="${esc(f.title)}: variant">${f.tabs.map((t, k) => `<button type="button" data-fx-tab="${k}" aria-pressed="${k === 0}">${esc(t.label)}</button>`).join('')}</div></div>
<div class="fx-stage" data-stage><div class="chart h-320" data-fx="${f.id}" data-fx-live="${ids[0]}" data-label="${esc(label)}"${f.themeFree ? ' data-theme-free' : ''}><p class="chart-fallback">${esc(f.title)}. The live chart appears here when JavaScript runs.</p></div></div>
<div class="fx-foot"><p>${f.text}</p><div class="fx-actions"><button class="btn btn--sm js-only" type="button" data-fx-code aria-haspopup="dialog">Get this code</button><a href="${g(f.guide[0])}">${esc(f.guide[1])}</a></div></div>
${f.tabs.map((t, k) => `<template data-fx-src="${k}" data-fx-id="${ids[k]}" data-fx-lang="${t.lang || 'js'}">${codeBlock(t.code, t.lang || 'js')}</template>`).join('')}
</article>`;
  }).join('\n');
  if (fxFns.length) liveBundles.set(p, fxFns);
  const cards = EXAMPLES.filter((ex) => (DRAWINGS || ex.kind !== 'drawings') && (LIVE || ex.kind !== 'live')).filter((ex) => !['line', 'area', 'bar', 'histogram', 'baseline'].includes(ex.id) || !TRANSFORMS).map((ex) => {
    let stage; let controls; let tpl;
    if (ex.connect) {
      // Click-to-connect, in the card and in its large view alike.
      const tag = (h) => liveTag(h, ex.label);
      const small = connectStage({ markup: tag(240), height: '240', label: ex.label });
      const large = connectStage({ markup: tag(540), height: '540', label: ex.label });
      stage = small.stage; controls = small.bar; tpl = `<template data-large>${large.stage}${large.bar}</template>`;
    } else {
      stage = ex.element ? ELEMENTS[ex.id] : `<div class="chart h-240" data-demo="${ex.id}" data-label="${esc(ex.label)}"><p class="chart-fallback">${esc(ex.label)}. The chart appears when JavaScript runs.</p></div>`;
      controls = ex.controls ? `<div class="demo-bar js-only">${controlsHtml(ex.controls)}</div>` : '';
      tpl = ex.element ? `<template data-large>${ELEMENTS[ex.id].replace('height="240"', 'height="540"')}</template>` : '';
    }
    return `<article class="card ex-card" id="${ex.id}" data-kind="${ex.kind}"${ex.big ? ` data-big="${ex.big}"` : ''} aria-labelledby="${ex.id}-h">
<div data-stage>${stage}${controls}</div>
<div class="ex-body"><h2 id="${ex.id}-h">${esc(ex.title)}</h2><p>${ex.text}</p><div class="ex-tags">${ex.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>
<div class="ex-actions"><button class="btn btn--sm js-only" type="button" data-open="${ex.id}" aria-haspopup="dialog">Open with code</button><a href="${g(ex.guide[0])}">${esc(ex.guide[1])}</a></div>
<div class="ex-source" hidden>${codeBlock(ex.code, ex.lang || 'js')}${tpl}</div>
</article>`;
  }).join('\n');
  const body = `<section class="index-panel"><div class="wrap"><nav class="crumb" aria-label="Breadcrumb"><a href="${rel(p, 'index.html')}">${esc(NAME)}</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">Examples</span></nav>
<h1 id="top">Charts you can <span class="serif-frame">touch.</span></h1><p class="lead">Every chart here is drawn by ${esc(NAME)} in your browser, from invented demo data${LIVE ? ', except the Live card, which shows exchange prices once you press Connect' : ''}. Switch a tab and the chart redraws; "Get this code" hands you exactly the code that runs.</p></div></section>
<div class="wrap">
<section class="fx-section" aria-labelledby="fx-h"><div class="task-group-head"><h2 id="fx-h">Feature gallery</h2><p>${FX.length} features, each with its variants. Drag to pan, scroll or pinch to zoom, tab in and press Enter to step through bars.</p></div>
<div class="fx-grid" id="fx-gallery">
${fxCards}
</div></section>
<section class="more-section" aria-labelledby="more-h"><div class="task-group-head"><h2 id="more-h">More examples</h2><p>Panes, time zones, the drawing playground and the element. Open any card for a large chart and its code.</p></div>
<div class="filters js-only"><div class="seg" role="group" aria-label="Filter examples">${KINDS.map(([k, l], i) => `<button type="button" data-filter="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div></div>
<div class="gallery" id="ex-gallery">
${cards}
</div></section>
</div>
<dialog class="code-dialog" id="code-dialog" aria-labelledby="code-dialog-title">
  <div class="ex-dialog-head"><h2 id="code-dialog-title">Code</h2><a class="btn btn--sm" id="code-dialog-guide" href="${g('getting-started')}">Guide</a><button class="icon-btn" type="button" data-close aria-label="Close the code">${ICON.close}</button></div>
  <div class="code-dialog-body"><div id="code-dialog-code"></div><p class="live-note" id="code-dialog-note">This is the code running in the card, as written. <code>bars</code>, <code>longBars</code>, <code>intradayBars</code> and <code>compareRows</code> are invented demo data and <code>every(ms, fn)</code> is a timer that stops when the tab changes: put your own rows and <code>setInterval</code> in their place. The import lines are left to your bundler.</p></div>
</dialog>
<dialog class="ex-dialog" id="ex-dialog" aria-labelledby="ex-dialog-title">
  <div class="ex-dialog-head"><h2 id="ex-dialog-title">Example</h2><a class="btn btn--sm" id="ex-dialog-guide" href="${g('getting-started')}">Guide</a><button class="icon-btn" type="button" data-close aria-label="Close the example">${ICON.close}</button></div>
  <div class="ex-dialog-body"><div class="ex-dialog-stage" data-stage id="ex-dialog-stage"></div><div class="ex-dialog-side"><p id="ex-dialog-text"></p><div id="ex-dialog-code"></div></div></div>
</dialog>`;
  pages.push({
    path: p, title: `Gallery: chart types, tooltips, alerts, drawing and more | ${NAME}`, demos: true, drawings: DRAWINGS, liveElement: LIVE,
    live: fxFns.length ? `live/examples.js` : null, liveLib: LIVE && usesAny(fxFns, ['connectLive']),
    libs: [usesAny(fxFns, EXTRA_NAMES) && EXTRAS ? 'extras' : '', usesAny(fxFns, TRANSFORM_NAMES) && TRANSFORMS ? 'transforms' : ''].filter(Boolean),
    description: `Live ${NAME} charts with tabs and their code: ${CHART_TYPES.length} chart types, themes, tooltips, compare, alerts, replay, custom series and drawing tools.`,
    crumbs: [{ name: 'Home', path: 'index.html' }, { name: 'Examples', path: p }],
    body,
  });
  searchDocs.push({ t: 'Gallery', u: p, d: 'Live charts with tabs and their code.', s: [...FX.map((f) => [f.title, `fx-${f.id}`, f.text.replace(/<[^>]+>/g, '')]), ...EXAMPLES.map((ex) => [ex.title, ex.id, ex.text.replace(/<[^>]+>/g, '')])] });
}

// Home: the product story in chapters.
{
  const sizes = SIZES;
  const coreGzip = sizeOf(sizes, 'core').gzip;
  const indGzip = sizeOf(sizes, 'indicators').gzip;
  const liveGzip = sizeOf(sizes, 'live')?.gzip ?? '';
  const p = 'index.html';
  const g = (s) => rel(p, guideBySlug(s).out);
  const homeBars = makeBars(60, 19, 120);
  const ohlc = JSON.stringify(homeBars.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume })));
  const install = [
    ['script', 'Script tag', 'html', `<script src="chartist-lite.element.iife.min.js"></script>

<chartist-chart type="candlestick" src="/data/prices.json" height="360"
  time-zone="Asia/Kolkata" aria-label="Daily price"></chartist-chart>`, 'No build step. The tag reads JSON or CSV from <code>src</code>, an inline script or a <code>.data</code> property.'],
    ['module', 'ES module', 'js', `import { createChart, CandlestickSeries } from 'lite-charts';

const chart = createChart('chart', { theme: 'dark', ariaLabel: 'Daily price' });
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);`, 'The container needs a height in CSS; the chart fills it and follows its size.'],
    ['react', 'React', 'jsx', `import * as React from 'react';
import { createChartistReact } from 'lite-charts/react';

export const { ChartistChart } = createChartistReact(React);

<ChartistChart height={420} options={{ theme: 'auto' }}
  series={[{ id: 'price', type: 'candlestick', data: candles }]} />`, 'React is an optional peer dependency; the wrapper takes your React once, at module level.'],
  ];
  const tabs = `<div class="tabs" data-tabs>
<div class="tablist"><div class="seg" role="tablist" aria-label="Ways to install">${install.map(([id, label], i) => `<button type="button" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${label}</button>`).join('')}</div></div>
${install.map(([id, , lang, code, note], i) => `<div class="tabpanel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" tabindex="0"${i ? ' hidden' : ''}>${codeBlock(code, lang)}<p>${note}</p></div>`).join('')}
</div>`;
  const CH = [
    ['what', 'What it is'], ['move', 'See it move'], ['series', 'Series'], ['panes', 'Indicators and panes'],
    ...(DRAWINGS ? [['drawings', 'Drawing tools']] : []), ['embed', 'Embed anywhere'], ...(LIVE ? [['live', 'Live data']] : []), ['load', 'What you load'], ['speed', 'Speed'], ['start', 'Get started'],
  ];
  const chapter = (key, h2, lead, content) => {
    const i = CH.findIndex((c) => c[0] === key);
    return `<section class="chapter" aria-labelledby="ch-${key}">${chapterLabel(i, CH.length, CH[i][1])}<div class="chapter-head"><h2 id="ch-${key}">${h2}</h2>${lead ? `<p>${lead}</p>` : ''}</div>${content}</section>`;
  };
  const win = (title, inner, extra = '') => `<div class="window" data-stage><div class="window-bar"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="window-title">${title}</span>${extra}</div>${inner}</div>`;
  const STANDOUT = [
    ...(WIDGET ? [[1, 'frame', '<b>A ready-made chart in one call:</b> toolbar, indicators dialog, ranges, drawing rail', g('widget')]] : []),
    [2, 'candles', `<b>${CHART_TYPES.length || SERIES_COUNT} chart types,</b> Renko, Kagi and point and figure included`, g('chart-types')],
    [3, 'wave', `<b>${CATALOG.length} indicators</b> in a searchable catalogue`, g('indicator-catalogue')],
    ...(DRAWINGS ? [[4, 'pen', `<b>${DRAWING_TOOLS.length} drawing tools,</b> undo and JSON export`, g('drawing-tools')]] : []),
    ...(PERF ? [[5, 'gauge', `<b>120 Hz frame budget, measured:</b> worst p95 ${PERF.worst.toFixed(1)} ms of ${PERF.budget.toFixed(2)}`, rel(p, PERF_PAGE)]] : []),
    [1, 'keys', '<b>Keyboard and screen reader</b> inspect mode', g('accessibility')],
  ].slice(0, 6);
  const apart = [
    [1, 'gauge', 'Built for 120 Hz', PERF ? `The costliest frame (p95) of ${PERF.scenarios} measured gestures takes ${PERF.worst.toFixed(2)} ms of the ${PERF.budget.toFixed(2)} ms a 120 Hz screen allows, in headless Chromium. Measure your own device.` : 'Each frame paints only what changed, and dense history folds into one column per pixel. Measure your own device.', '#ch-speed', 'See the meter'],
    [2, 'wave', 'Indicators built in', `${CATALOG.length} indicators as plain functions, with a catalogue a UI can be built on, in a ${indGzip} KB entry.`, g('indicators'), 'Indicators guide'],
    [3, 'panes', 'Stacked panes', 'RSI or MACD in its own pane, sharing the time axis and the crosshair, with a divider you can drag or move by keyboard.', g('panes-and-scales'), 'Panes guide'],
    [4, 'clock', 'Exchange time, no gaps', 'One slot per bar, so nights and weekends take no space; labels in any IANA zone, daylight saving included.', g('time-and-time-zones'), 'Time guide'],
    [5, 'code', 'A tag, no code', 'Write <code>&lt;chartist-chart&gt;</code> with a data source. The fallback table inside it is what crawlers read.', g('embedding'), 'Embedding guide'],
    [1, 'keys', 'Keyboard and screen reader', 'Focus the chart, press Enter, and step through bars; each one is announced through a live region.', g('accessibility'), 'Accessibility guide'],
    [2, 'shield', 'Safe on strict pages', 'Works under a <code>style-src \'self\'</code> policy; hostile page CSS and right-to-left pages do not reach it.', g('embedding') + '#strict-content-security-policy-hostile-page-css-right-to-left-pages', 'What was checked'],
    [3, 'minus', 'Numbers that read right', 'A true minus sign (<span class="num">−2.35</span>), no grouping commas (<span class="num">12345.60</span>), tabular figures on the axes.', g('time-and-time-zones') + '#numbers-on-the-axis', 'Number rules'],
  ];
  const STATS = [
    [CATALOG.length, 'Indicators', g('indicator-catalogue')],
    [DRAWING_TOOLS.length, 'Drawing tools', g('drawing-tools')],
    [CHART_TYPES.length || SERIES_COUNT, 'Chart types', g('chart-types')],
    [`${coreGzip} KB`, 'Core, gzip', '#ch-load'],
    [RUNTIME_DEPS, 'Dependencies', '#ch-what'],
    ...(PERF ? [[`${PERF.worst.toFixed(1)} ms`, `Worst p95 of ${PERF.budget.toFixed(2)}`, rel(p, PERF_PAGE)]] : []),
  ];
  const poster = (theme) => {
    const src = POSTERS[theme];
    return src ? `<img class="hero-poster hero-poster--${theme}" src="${rel(p, src.path)}" width="${src.size.width}" height="${src.size.height}" alt="The ready-made chart: a candlestick chart with its toolbar, range keys and indicators" loading="lazy" decoding="async">` : '';
  };
  const heroStage = WIDGET
    ? `<div class="hero-widget" data-hero-widget data-label="The ready-made chart, live">${poster('dark')}${poster('light')}<div class="hero-mount" data-hero-mount></div><p class="hero-loading js-only" data-hero-loading>Loading the chart</p><noscript><p class="hero-loading">The live chart needs JavaScript. The picture shows what it looks like.</p></noscript></div>
<div class="hero-bar js-only"><span class="live-state" data-s="off" role="status"><span class="dot" aria-hidden="true"></span><span class="live-word">Loading</span></span><span class="hero-source" data-hero-source>Real market data · Coinbase</span><button class="chip" type="button" data-hero-demo aria-pressed="false"><span class="dot" aria-hidden="true"></span>Use demo data</button><p class="hero-live-note" data-hero-live-note>Prices come straight from the exchange's public feed to your browser, with nothing in between and nothing stored. Indicative, not advice.</p></div>`
    : `<div class="chart" data-demo="home" data-label="Demo daily candlestick chart"></div>`;
  const body = `<section class="hero-panel" aria-labelledby="hero-h"><div class="wrap hero hero--product">
<div class="hero-text">
<div class="hero-title"><p class="pill"><span class="tile tile--5">${GLYPH.candles}</span>Open source charting, version ${esc(VERSION)}</p>
<h1 id="hero-h">Financial charts <span class="serif-frame">that stay light.</span></h1></div>
<div class="hero-copy"><p class="lead">A complete chart product in one call, or just the canvas: ${CHART_TYPES.length || SERIES_COUNT} chart types, ${CATALOG.length} indicators, ${DRAWING_TOOLS.length} drawing tools and exchange time zones. ${coreGzip} KB gzip core, no runtime dependencies, and every chart works from the keyboard.</p>
<div class="actions"><a class="btn btn--primary btn--lg" href="${g('getting-started')}">Get started ${ICON.arrow}</a><a class="btn btn--lg" href="${rel(p, 'examples.html')}">See the gallery</a></div></div>
</div>
<div class="hero-visual">
<div class="window hero-window" data-stage>${heroStage}</div>
<p class="hero-hint">This is the real widget, not a picture: pick a symbol, draw, add indicators, change the range. <a href="${g('widget')}">The ready-made chart</a></p>
</div>
<ul class="stats" aria-label="Measured facts">${STATS.map(([v, k, href]) => `<li><a class="stat" href="${href}"><span class="v">${esc(String(v))}</span><span class="k">${esc(k)}</span></a></li>`).join('')}</ul>
</div></section>

<section class="wrap standout" aria-labelledby="standout-h"><h2 id="standout-h" class="eyebrow">What stands out</h2><ul class="standout-list">${STANDOUT.map(([c, icon, text, href]) => `<li><a class="standout-item" href="${href}"><span class="tile tile--${c}">${GLYPH[icon]}</span><span>${text}</span></a></li>`).join('')}</ul></section>

<div class="wrap home-chapters">
${chaptersNav(CH.map(([k, t]) => ({ id: `ch-${k}`, text: t })), 'Chapters')}

${chapter('what', 'What it <span class="serif-frame">is.</span>', '', `<div class="intro"><div><p class="intro-statement">${esc(NAME)} is a small JavaScript library that draws price charts on one canvas, with the parts a market page needs built in.</p>
<div class="fact-cards">
<div class="fact-card"><span class="tile tile--1">${GLYPH.candles}</span><span><span class="k">Kind</span><span class="v">Canvas chart library</span></span></div>
<div class="fact-card"><span class="tile tile--2">${GLYPH.gauge}</span><span><span class="k">Size</span><span class="v">${coreGzip} KB gzip core</span></span></div>
<div class="fact-card"><span class="tile tile--4">${GLYPH.code}</span><span><span class="k">Comes as</span><span class="v">Module, React, a tag</span></span></div>
<div class="fact-card"><span class="tile tile--5">${GLYPH.book}</span><span><span class="k">Licence</span><span class="v">${esc(config.license.name)}</span></span></div>
</div></div>
<div class="intro-side"><p>${CHART_TYPES.length || SERIES_COUNT} chart types, ${CATALOG.length} indicators, ${DRAWING_TOOLS.length} drawing tools, stacked panes, exchange time zones and a legend that reads the bar under the pointer. It has no runtime dependencies, and the core never fetches data on its own${LIVE ? '; live prices come from an optional entry, only when you call it' : ''}.</p><p>It is written from scratch by ${esc(config.author.name)}. Many names will feel familiar if you know Lightweight Charts, on purpose; the code is its own, and the guide lists where behaviour differs.</p></div></div>
<div class="apart">${apart.map(([c, icon, t, text, href, link], i) => `<div class="apart-item"><span class="tile tile--${c}">${GLYPH[icon]}</span><div><h3 id="apart-${i + 1}">${t}</h3><p>${text} <a href="${href}">${link}</a></p></div></div>`).join('')}</div>`)}

${chapter('move', 'See it <span class="serif-frame">move.</span>', 'Two things a canvas usually cannot do: read exchange time, and be read aloud.', `<div class="duo">
<div>${win('Five sessions, five-minute bars', `<div class="chart h-320" data-demo="zone" data-label="Demo five-minute candlestick chart over five sessions"></div><div class="demo-bar js-only"><span class="group-label">Axis zone</span>${controlsHtml('zone')}</div>`)}<div class="duo-text"><h3 id="move-zones">Exchange time, with no gaps</h3><p>Nights and weekends take no space, ticks land on session boundaries, and labels read in the zone you choose. The data never changes.</p><a href="${g('time-and-time-zones')}">Time and time zones</a></div></div>
<div>${win('Keyboard inspect mode', `<div class="chart h-320" data-demo="keys" data-label="Demo chart for keyboard control: press Enter to inspect bars"></div><div class="demo-bar js-only"><button class="btn btn--sm" type="button" data-focus-chart>Focus the chart</button><span class="keys"><kbd>←</kbd> <kbd>→</kbd></span><span class="group-label">pan</span><span class="keys"><kbd>Enter</kbd></span><span class="group-label">inspect</span></div>`)}<div class="duo-text"><h3 id="move-keys">Readable without a mouse</h3><p>The chart takes focus and has a name. Enter starts stepping through bars; each is announced, with the legend following along.</p><a href="${g('accessibility')}">Accessibility</a></div></div>
</div>`)}

${chapter('series', 'Six ways to draw a <span class="serif-frame">price.</span>', 'Every type takes the same rows and follows the theme. Each chart below is live.', `<div class="series-grid">${[['s-candles', 'Candlestick', 'CandlestickSeries'], ['s-bar', 'OHLC bars', 'BarSeries'], ['s-line', 'Line', 'LineSeries'], ['s-area', 'Area', 'AreaSeries'], ['s-histogram', 'Histogram', 'HistogramSeries'], ['s-baseline', 'Baseline', 'BaselineSeries']].map(([id, t, def]) => `<figure class="window series-card"><div class="chart h-200" data-demo="${id}" data-label="Demo ${t.toLowerCase()} chart"></div><figcaption><span>${t}</span><code>${def}</code></figcaption></figure>`).join('')}</div>
<p class="duo-text"><a href="${g('series-types')}">Series types: rows and options</a></p>`)}

${chapter('panes', 'Indicators and <span class="serif-frame">panes.</span>', `Overlays on the price, oscillators underneath. The indicator entry is ${indGzip} KB gzip and imports nothing from the chart.`, `<div class="duo">
<div>${win('SMA 20 and Bollinger bands', `<div class="chart h-360" data-demo="indicators" data-label="Demo candlestick chart with a moving average and Bollinger bands"></div>`)}<div class="duo-text"><h3 id="panes-ind">Plain functions, aligned rows</h3><p><code>setData(sma(bars, 20))</code> just works: every indicator returns one row per bar, with empty rows while its window fills.</p><a href="${g('indicators')}">Indicators</a></div></div>
<div>${win('Volume overlay and an RSI pane', `<div class="chart h-360" data-demo="panes" data-label="Demo candlestick chart with volume and an RSI pane below"></div><div class="demo-bar js-only"><span class="group-label">Price scale</span>${controlsHtml('scale')}</div>`)}<div class="duo-text"><h3 id="panes-panes">A pane is one argument</h3><p>Pass a pane index to <code>addSeries</code>. Drag the divider, or focus it and press the arrow keys.</p><a href="${g('panes-and-scales')}">Panes and scales</a></div></div>
</div>`)}

${DRAWINGS ? chapter('drawings', 'Drawing <span class="serif-frame">tools.</span>', `${DRAWING_TOOLS.length} tools in a separate entry of ${sizeOf(sizes, 'drawings')?.gzip ?? ''} KB gzip, on the chart's own pointer and keyboard hooks. Pick a tool on the rail, or click the chart and press T, then draw.`, `<div class="playground">
${win('Playground: the real toolbar on a real chart', `<div class="chart h-480" data-demo="draw" data-label="Demo chart with drawing tools: pick a tool on the left rail and draw"></div><div class="demo-bar js-only">${controlsHtml('draw')}</div><pre class="out js-only" data-out tabindex="0" aria-live="polite" aria-label="Exported drawings">Export JSON shows the drawings here, as the text you would save.</pre>`)}
<div class="playground-side"><div class="duo-text"><h3 id="draw-tools">Every tool</h3><p>${DRAWING_TOOLS.map((t) => esc(t.label)).join(', ')}.</p><h3 id="draw-keys">Keys, with the chart focused</h3><ul class="key-list"><li><kbd>T</kbd> trend, <kbd>H</kbd> horizontal, <kbd>F</kbd> Fibonacci, <kbd>R</kbd> rectangle, <kbd>L</kbd> long, <kbd>N</kbd> note</li><li><kbd>Delete</kbd> removes the selected drawing</li><li><kbd>Esc</kbd> drops the tool or the selection</li><li><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> nudge it (<kbd>Shift</kbd> for 10)</li><li><kbd>Ctrl</kbd> <kbd>Z</kbd> undo, <kbd>Ctrl</kbd> <kbd>Y</kbd> redo</li><li><kbd>Shift</kbd> <kbd>H</kbd> adds a horizontal line</li></ul><a href="${g('drawing-tools')}">Drawing tools guide</a></div></div>
</div>`) : ''}

${chapter('embed', 'Embed it <span class="serif-frame">anywhere.</span>', 'From a CMS block that takes one script tag to a React app: the same chart and the same options.', `<div class="install">
<div>${win('&lt;chartist-chart&gt;, no code', `<chartist-chart type="candlestick" volume height="300" aria-label="Demo candlestick chart from the chartist-chart element"><script type="application/json">${ohlc}</script><table><caption>Demo bars for the element</caption><tr><th>First bar</th><td>${homeBars[0].time}</td></tr><tr><th>Last close</th><td>${homeBars[homeBars.length - 1].close.toFixed(2)}</td></tr></table></chartist-chart>`)}</div>
${tabs}
</div>
<div class="embed-grid">
<div class="card embed-card"><span class="tile tile--1">${GLYPH.code}</span><h3>Web component</h3><p>A script tag and <code>&lt;chartist-chart&gt;</code>. Attributes set the type, theme, zone and height.</p><code class="snippet">&lt;chartist-chart src="prices.json"&gt;</code><a href="${g('embedding')}#1-script-tag-and-the-web-component">Element guide</a></div>
<div class="card embed-card"><span class="tile tile--2">${GLYPH.box}</span><h3>ES module</h3><p>Import <code>createChart</code> and the series you use; a bundler keeps only those.</p><code class="snippet">createChart('chart', options)</code><a href="${g('embedding')}#2-es-module">Module guide</a></div>
<div class="card embed-card"><span class="tile tile--4">${GLYPH.atom}</span><h3>React</h3><p>A component and a hook that update only the bars that changed.</p><code class="snippet">&lt;ChartistChart series={rows} /&gt;</code><a href="${g('embedding')}#3-react">React guide</a></div>
<div class="card embed-card"><span class="tile tile--5">${GLYPH.frame}</span><h3>An iframe</h3><p>For hosts that forbid scripts: a small page you host, framed by theirs.</p><code class="snippet">&lt;iframe src="frame.html?src=..."&gt;</code><a href="${g('embedding')}#4-an-iframe-for-sites-that-forbid-scripts">Iframe guide</a></div>
</div>`)}

${LIVE ? chapter('live', 'Live prices in <span class="serif-frame">one tag.</span>', `The optional live entry loads history and streams live prices from a public exchange feed, folded into bars and painted once per frame. ${liveGzip} KB gzip as a module; the one-tag build is the element with it inside.`, `<div class="live-duo">
<div>${win('&lt;chartist-chart live&gt;, Bitcoin', (() => { const c = connectStage({ markup: liveTag(360, 'Bitcoin in US dollars, one-minute candles with volume, live from the exchange'), height: '360', label: 'Live Bitcoin chart' }); return c.stage + c.bar; })())}</div>
<div class="live-side">${codeBlock(`<script src="chartist-lite.element-live.iife.min.js"></script>

<chartist-chart live symbol="BTC-USD" interval="1m"
  provider="coinbase" volume height="420"></chartist-chart>`, 'html')}
<ul class="live-facts">
<li><b>No code, no key.</b> The tag loads 500 bars of history, then streams prices and updates the last bar once per frame.</li>
<li><b>Straight from the visitor's browser</b> to the exchange. Nothing passes through a server of yours or ours, and nothing is stored.</li>
<li><b>Coinbase first.</b> If its history does not load, Binance (quoted in USDT) and then Kraken are tried. Change <code>symbol</code> or <code>interval</code> and the stream follows.</li>
<li><b>A dot and a word</b> show the state: Connecting, Live, Reconnecting, Offline or Error. A hidden tab pauses the stream.</li>
</ul>
<p class="live-honest">Prices are indicative and not advice. Using exchange data in a commercial or redistributed product is subject to each exchange's terms, which are yours to check.</p>
<a href="${g('live-data')}">Live data guide</a></div>
</div>`) : ''}

${chapter('load', 'You load what <span class="serif-frame">you need.</span>', 'Every part is its own entry. A page that only draws candles never downloads the drawing tools, and the ready-made chart loads its drawing, live and extras code the first time someone asks for it.', sizeTables(sizes, p))}

${chapter('speed', 'Built for <span class="serif-frame">120 Hz.</span>', PERF ? `A 120 Hz screen gives each frame ${PERF.budget.toFixed(2)} ms. In ${PERF.scenarios} measured gestures, up to ${PERF.panBars} bars, the costliest frame of our code took ${PERF.worst.toFixed(2)} ms at p95, and ${PERF.over === 0 ? 'none' : PERF.over} went over. The meter times this chart on your own device.` : 'A 120 Hz screen gives each frame 8.33 ms. The meter times this chart on your own device while it pans and zooms through 5000 bars.', `<div class="speed">
${win('Frame meter, on your device', `<div class="chart h-280" data-demo="meter" data-label="Demo chart of 5000 bars used to time pan and zoom frames on this device"></div><div class="meter js-only" id="meter"><canvas id="meter-canvas" width="600" height="96" aria-hidden="true"></canvas><div class="meter-read" role="status" id="meter-read">The meter runs when the chart is on screen.</div><div class="meter-legend"><span>Each bar is one frame: the time to move the view and paint it.</span><span>The line is the 8.33 ms budget of a 120 Hz frame.</span></div></div>`, `<span class="js-only"><button class="btn btn--sm" type="button" id="meter-run">Run again</button></span>`)}
<div class="card bench">${benchHtml().replace("PERF_HREF", rel(p, PERF_PAGE))}</div>
</div>`)}

${chapter('start', 'Start in a <span class="serif-frame">minute.</span>', `Version ${esc(VERSION)} is not on npm yet, so build it once and host the file yourself.`, `<div class="install">
<div><ol class="install-steps"><li>Clone <code>github.com/MrChartist/Lite_Charts</code>, then run <code>npm ci</code> and <code>npm run build</code> in it.</li><li>Copy the file you need from <code>dist/</code> next to your page.</li><li>Paste one of the snippets above and give it your rows.</li></ol>
<div class="actions"><a class="btn btn--primary btn--lg" href="${g('getting-started')}">Read Getting started ${ICON.arrow}</a><a class="btn btn--lg" href="${rel(p, 'guide/index.html')}">All guides</a></div></div>
<div class="honest"><div class="card"><h3 id="not-h">What it is not</h3><ul class="not-list"><li>No data feed in the core. You give it rows; it never fetches prices by itself (the element can load a JSON or CSV file you point it at).${LIVE ? ' The optional live entry reads public exchange prices, only when you use it.' : ''}</li><li>No order placement and no trading features.</li><li>No pattern detection or signals. Markers show what you give them.</li>${DRAWINGS ? '' : '<li>No drawing tools in this version: no trend lines, Fibonacci tools or text notes. A primitive can draw your own marks.</li>'}</ul></div>
<div class="card"><h3 id="status-h">Status</h3><dl class="status-list"><dt>Version</dt><dd>${esc(VERSION)}, not yet on npm</dd><dt>Licence</dt><dd>${esc(config.license.name)}</dd><dt>Tested in</dt><dd>Chromium, through Playwright</dd><dt>Not yet tested</dt><dd>Firefox, Safari, screen readers</dd><dt>Made by</dt><dd><a href="${esc(config.author.url)}" rel="noopener">${esc(config.author.name)}</a></dd></dl></div></div>
</div>`)}
</div>`;
  pages.unshift({
    path: p, title: `${NAME}: a lightweight financial chart library, no dependencies`, demos: true, drawings: DRAWINGS, liveElement: LIVE, bodyClass: 'home',
    description: 'A lightweight financial chart library: candlestick and other series, indicators, panes, time zones and a chartist-chart web component. No dependencies.',
    body,
    ld: [{ '@context': 'https://schema.org', '@type': 'SoftwareSourceCode', name: NAME, description: config.tagline, programmingLanguage: 'TypeScript', license: config.license.url, version: VERSION, url: baseUrl, author: author(), ...(REPO ? { codeRepository: REPO } : {}) }],
  });
  searchDocs.unshift({ t: NAME, u: p, d: 'Home: what the library is, live demos, install.', s: CH.map(([k, t]) => [t, `ch-${k}`, '']) });
}

// ---------- write ----------
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'assets', 'img'), { recursive: true });
mkdirSync(path.join(out, 'assets', 'live'), { recursive: true });

const bundleOpts = { bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, legalComments: 'none', logLevel: 'warning' };
for (const [src, dest] of [['site.js', 'site.js'], ['demos.js', 'demos.js']]) {
  const b = await build({ ...bundleOpts, entryPoints: [path.join(here, 'src', src)] });
  writeFileSync(path.join(out, 'assets', dest), b.outputFiles[0].text);
}
writeFileSync(path.join(out, 'assets', 'boot.js'), (await transform(readFileSync(path.join(here, 'src', 'boot.js'), 'utf8'), { minify: true, target: 'es2015' })).code);
for (const [p, fns] of liveBundles) {
  const name = `live/${p.replace(/\.html$/, '').replace(/\//g, '-')}.js`;
  const ids = fns.map((f) => JSON.parse(f.slice(0, f.indexOf(':'))));
  const srcs = Object.fromEntries(Object.entries(liveSources).filter(([k]) => ids.includes(k) || (p === 'examples.html' && k.startsWith('fx-'))));
  const srcCode = `window.__CL_LIVE = Object.assign(window.__CL_LIVE || {}, {\n${fns.join(',\n')}\n});${Object.keys(srcs).length ? `\nwindow.__CL_LIVE_SRC = ${JSON.stringify(srcs)};` : ''}`;
  let code;
  try { code = (await transform(srcCode, { minify: true, target: 'es2020', loader: 'js' })).code; }
  catch (e) { throw new Error(`a live example on ${p} does not compile: ${e.message}`); }
  writeFileSync(path.join(out, 'assets', name), code);
}
writeFileSync(path.join(out, 'assets', 'search-index.js'), `window.__CL_SEARCH=${JSON.stringify(searchDocs).replace(/</g, '\\u003c')};`);
copyFileSync(path.join(here, 'assets', 'site.css'), path.join(out, 'assets', 'site.css'));
copyFileSync(path.join(here, 'assets', 'fonts.css'), path.join(out, 'assets', 'fonts.css'));
cpSync(path.join(here, 'assets', 'fonts'), path.join(out, 'assets', 'fonts'), { recursive: true });
for (const f of ['chartist-lite.iife.min.js', 'chartist-lite-indicators.iife.min.js', 'chartist-lite.element.iife.min.js', ...(DRAWINGS ? ['chartist-lite-drawings.iife.min.js'] : []),
  ...(LIVE ? ['chartist-lite-live.iife.min.js', 'chartist-lite.element-live.iife.min.js'] : []),
  ...(WIDGET ? ['chartist-lite.terminal.iife.min.js', 'chartist-lite-widget.iife.min.js'] : []), ...(EXTRAS ? ['chartist-lite-extras.iife.min.js'] : []), ...(TRANSFORMS ? ['chartist-lite-transforms.iife.min.js'] : [])]) {
  const src = path.join(pkg, 'dist', f);
  if (!existsSync(src)) throw new Error(`dist/${f} is missing: run "npm run build" in the package folder first`);
  copyFileSync(src, path.join(out, 'assets', f));
}
copyFileSync(path.join(pkg, config.ogImageSource), path.join(out, ogImage.path));
copyFileSync(path.join(pkg, 'docs/screenshots/basic-light.png'), path.join(out, 'assets/img/basic-light.png'));
// Rows for the no-code tags of the gallery (invented demo data).
writeFileSync(path.join(out, 'assets', 'demo-bars.json'), JSON.stringify(makeBars(200, 7)));
for (const t of Object.keys(POSTERS)) copyFileSync(POSTERS[t].src, path.join(out, POSTERS[t].path));
for (const [dest, src] of assets) { mkdirSync(path.dirname(path.join(out, dest)), { recursive: true }); copyFileSync(src, path.join(out, dest)); }

for (const page of pages) {
  const file = path.join(out, page.path);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, layout(page));
}

const loc = (p) => baseUrl + (p === 'index.html' ? '' : p);
writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${esc(loc(p.path))}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}sitemap.xml\n`);
// Host-agnostic extras: GitHub Pages skips Jekyll with .nojekyll; every static host serves 404.html for a missing path.
// The 404 page may be served at any depth, so it carries a <base> at the site address and absolute-from-base links.
writeFileSync(path.join(out, '.nojekyll'), '');
{
  const notFound = layout({
    path: '404.html', title: `Page not found | ${NAME}`, noindex: true,
    description: `This page of the ${NAME} documentation does not exist. Start from the guide, the examples or the home page.`,
    body: `<section class="index-panel"><div class="wrap"><p class="eyebrow">404</p><h1 id="top">This page is <span class="serif-frame">not here.</span></h1><p class="lead">The address may be old or mistyped. These will get you back on track.</p><div class="actions"><a class="btn btn--primary btn--lg" href="guide/getting-started.html">Get started</a><a class="btn btn--lg" href="guide/index.html">The guide</a><a class="btn btn--lg" href="index.html">Home</a></div></div></section>`,
  }).replace('<head>', `<head>\n<base href="${esc(baseUrl)}">`);
  writeFileSync(path.join(out, '404.html'), notFound);
}

if (baseUrl.includes('example.invalid')) warnings.push('baseUrl in site/site.config.json is the placeholder; set the real address before publishing (canonical, Open Graph, JSON-LD and sitemap use it)');
let bytes = 0;
(function walk(d) { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : (bytes += statSync(p).size); } })(out);
const sz = (f) => statSync(path.join(out, 'assets', f)).size;
const gzs = (f) => gzipSync(readFileSync(path.join(out, 'assets', f)), { level: 9 }).length;
console.log(`site: ${pages.length} pages, ${(bytes / 1024).toFixed(0)} KB, written to ${posix(path.relative(process.cwd(), out)) || '.'}`);
console.log(`  site.css ${sz('site.css')} B (gzip ${gzs('site.css')}), site.js ${sz('site.js')} B (gzip ${gzs('site.js')}), demos.js ${sz('demos.js')} B (gzip ${gzs('demos.js')}), boot.js ${sz('boot.js')} B, search-index.js ${sz('search-index.js')} B (gzip ${gzs('search-index.js')}), live scripts ${[...liveBundles.keys()].length}`);
for (const w of [...new Set(warnings)]) console.warn(`warning: ${w}`);
