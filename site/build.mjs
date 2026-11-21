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
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { codeBlock, esc, parseFrontMatter, renderMarkdown } from './markdown.mjs';
import { makeBars } from './src/demo-data.js';
import { EXAMPLES } from './src/examples.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..');
const out = path.join(here, 'dist');
const config = JSON.parse(readFileSync(path.join(here, 'site.config.json'), 'utf8'));
const pkgJson = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8'));
const baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`;
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
const SCENARIO_LABELS = { crosshair: 'Crosshair', pan: 'Pan', zoom: 'Wheel zoom', tick: 'Live tick', fit: 'Live tick, whole series in view', drag: 'Drag a drawing' };
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
const DRAWING_TOOLS = DRAWINGS ? Array.from(read('src/drawings/tools.ts').matchAll(/^\s*\{ id: '(\w+)', label: '([^']+)', points: \d+ \}/gm)).map((m) => ({ id: m[1], label: m[2] })) : [];

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
};

async function measureSizes() {
  const gz = (buf) => gzipSync(buf, { level: 9 }).length;
  const kb = (n) => (n / 1024).toFixed(1);
  const rows = [];
  const ENTRIES = [
    ['Core (ES module, createChart and the six series)', 'src/index.ts'],
    ['Indicators entry', 'src/indicators/index.ts'],
    ['Element entry (includes the chart)', 'src/element/index.ts'],
    ['React entry (includes the chart)', 'src/react/index.ts'],
    ...(existsSync(path.join(pkg, 'src', 'drawings', 'index.ts')) ? [['Drawings entry', 'src/drawings/index.ts']] : []),
  ];
  for (const [label, entry] of ENTRIES) {
    const res = await build({ absWorkingDir: pkg, entryPoints: [entry], bundle: true, format: 'esm', minify: true, target: 'es2020', write: false, legalComments: 'none', logLevel: 'silent' });
    const code = res.outputFiles[0].contents;
    rows.push([label, kb(code.length), kb(gz(code))]);
  }
  for (const [label, file] of [
    ['Script tag: chartist-lite.iife.min.js', 'dist/chartist-lite.iife.min.js'],
    ['Script tag: chartist-lite-indicators.iife.min.js', 'dist/chartist-lite-indicators.iife.min.js'],
    ['Script tag: chartist-lite.element.iife.min.js', 'dist/chartist-lite.element.iife.min.js'],
  ]) {
    const buf = readFileSync(path.join(pkg, file));
    rows.push([label, kb(buf.length), kb(gz(buf))]);
  }
  return rows;
}

// ---------- guides ----------
const GROUPS = [
  { id: 'start', title: 'Start here', blurb: 'Get a chart on the page, then choose how it gets there.' },
  { id: 'build', title: 'Build the chart', blurb: 'Series, indicators, panes and the time axis.' },
  { id: 'customise', title: 'Make it yours', blurb: 'Colours, your own marks, and readers who use a keyboard.' },
  { id: 'reference', title: 'Reference', blurb: 'Every export, and what changes if you know another library.' },
];
const guideDir = path.join(pkg, 'docs', 'guide');
const guides = readdirSync(guideDir).filter((f) => f.endsWith('.md')).map((f) => {
  const slug = f.replace(/\.md$/, '');
  const { meta, body } = parseFrontMatter(readFileSync(path.join(guideDir, f), 'utf8'));
  if (!meta.title || !meta.description) throw new Error(`docs/guide/${f} needs a title and a description in its front matter`);
  if (!GROUPS.some((g) => g.id === meta.group)) throw new Error(`docs/guide/${f} needs a group: one of ${GROUPS.map((g) => g.id).join(', ')}`);
  return {
    slug, src: `docs/guide/${f}`, out: `guide/${slug}.html`, title: meta.title, description: meta.description,
    order: Number(meta.order || 99), group: meta.group, task: meta.task || '', summary: meta.summary || meta.description,
    layout: meta.layout || 'guide', related: (meta.related || '').split(',').map((s) => s.trim()).filter(Boolean), body,
  };
}).sort((a, b) => a.order - b.order);
const guideBySlug = (s) => guides.find((g) => g.slug === s);

const mdMap = new Map([['README.md', 'readme.html'], ['docs/PERFORMANCE.md', 'performance.html'], ...guides.map((g) => [g.src, g.out])]);
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
      if (config.repoUrl) return { href: `${config.repoUrl.replace(/\/$/, '')}/${target}` };
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
const LIVE_NAMES = ['createChart', 'CandlestickSeries', 'BarSeries', 'LineSeries', 'AreaSeries', 'HistogramSeries', 'BaselineSeries',
  'createPriceLine', 'createSeriesMarkers', 'lightTheme', 'darkTheme', 'formatPrice', 'formatPercent', 'MINUS_SIGN',
  'sma', 'ema', 'wma', 'rsi', 'atr', 'obv', 'vwap', 'bollinger', 'donchian', 'macd', 'stochastic', 'supertrend', 'heikinAshi',
  'aggregate', 'createIndicator', 'bars', 'intradayBars', 'benchmark', 'createDrawingTools', 'TOOLS', 'drawingsToJSON', 'output'];
const HEIGHTS = new Set(['220', '260', '280', '320', '360', '420', '480', '560']);
const ZONES = [['Asia/Kolkata', 'Kolkata'], ['America/New_York', 'New York'], ['UTC', 'UTC']];

/** The control strip of a live chart. Buttons act on the chart(s) in the same `[data-stage]`. */
function controlsHtml(kind) {
  if (kind === 'zone') return `<div class="seg" role="group" aria-label="Axis time zone">${ZONES.map(([z, l], i) => `<button type="button" data-zone="${z}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>`;
  if (kind === 'theme') return `<div class="seg" role="group" aria-label="Chart theme"><button type="button" data-chart-theme="light" aria-pressed="false">Light</button><button type="button" data-chart-theme="dark" aria-pressed="false">Dark</button></div>`;
  if (kind === 'draw') return `<span class="draw-actions"><button class="btn btn--sm" type="button" data-draw="undo">Undo</button><button class="btn btn--sm" type="button" data-draw="redo">Redo</button><button class="btn btn--sm" type="button" data-draw="clear">Clear</button><button class="btn btn--sm" type="button" data-draw="export">Export JSON</button><button class="btn btn--sm" type="button" data-draw="import">Import it back</button></span>`;
  if (kind === 'scale') return `<div class="seg" role="group" aria-label="Price scale mode"><button type="button" data-scale="linear" aria-pressed="true">Linear</button><button type="button" data-scale="log" aria-pressed="false">Log</button><button type="button" data-scale="percent" aria-pressed="false">Percent</button></div>`;
  return '';
}

function makeLive(slug, fns) {
  let n = 0;
  return ({ lang, code, attrs, heading }) => {
    n++;
    const id = `${slug}-${n}`;
    const h = HEIGHTS.has(String(attrs.height)) ? attrs.height : '320';
    const label = `Live example: ${heading || 'chart'}`;
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

// ---------- page chrome ----------
const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
  sun: '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>',
  moon: '<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
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
  'api-reference': 'book', 'coming-from-lightweight-charts': 'swap',
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
  const dataAttrs = [`data-assets="${root}assets/"`, `data-root="${root}"`, page.live ? `data-live="${page.live}"` : '', page.demos ? 'data-demos' : '', page.drawings ? 'data-drawings' : ''].filter(Boolean).join(' ');
  return `<!doctype html>
<html lang="${config.locale}" ${dataAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
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
      <p>The charts on this site are drawn from invented demo data, not market data, and nothing here is investment advice. Type: Chartist Sans Flex (from Google Sans Flex by Google), Chartist Sans (from Plus Jakarta Sans by Tokotype) and Chartist Serif (from Instrument Serif by Instrument), under the SIL Open Font License 1.1.</p>
    </div>
  </div>
</footer>
</body>
</html>
`;
}

// ---------- pages ----------
const pages = [];
const liveBundles = new Map(); // page path -> [fn source]
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

function docPage({ path: p, src, title, description, body, group, prevNext, related, crumbs, ld: ldExtra, live, entries, html: allowHtml }) {
  const fns = [];
  const md = renderMarkdown(body, renderOptions(p, src, { live: live ? makeLive(live, fns) : null, entries, html: !!allowHtml }));
  if (fns.length) liveBundles.set(p, fns);
  const usesDrawings = fns.some((f) => f.includes('createDrawingTools'));
  const h1Match = /<h1 id="[^"]*">([\s\S]*?)<\/h1>/.exec(md.html);
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
    path: p, title: `${title} | ${NAME}`, description, crumbs, ogType: 'article', drawings: usesDrawings, live: fns.length ? `live/${p.replace(/\.html$/, '').replace(/\//g, '-')}.js` : null,
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
<h1 id="top">Learn it one task <span class="serif-frame">at a time.</span></h1><p class="lead">${['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen'][guides.length] || guides.length} short pages, each about one job. Start with Getting started; every page after it has live charts you can touch and code you can copy.</p></div></section>
<div class="wrap">
${GROUPS.map((grp) => `<section class="task-group" aria-labelledby="g-${grp.id}"><div class="task-group-head"><h2 id="g-${grp.id}">${esc(grp.title)}</h2><p>${esc(grp.blurb)}</p></div><ul class="task-grid">${guides.filter((x) => x.group === grp.id).map((x) => { k++; return `<li><a class="card task-card" href="${rel(p, x.out)}"><span class="tile tile--${((k - 1) % 5) + 1}">${GLYPH[TASK_ICONS[x.slug]] || GLYPH.book}</span><p class="task">${esc(x.task)}</p><h3>${esc(x.title)}</h3><p>${esc(x.summary)}</p><span class="go">Read the guide ${ICON.arrow}</span></a></li>`; }).join('')}</ul></section>`).join('\n')}
</div>`;
  pages.push({
    path: p, title: `Guide: how to use ${NAME}`, crumbs: [{ name: 'Home', path: 'index.html' }, { name: 'Guide', path: p }],
    description: `Guides for ${NAME}, grouped by task: getting started, embedding, series types, indicators, panes, time zones, theming, plugins, accessibility and the API reference.`,
    body,
  });
  searchDocs.push({ t: 'Guide', u: p, d: 'All guides, grouped by task.', s: [] });
}

// Examples gallery.
{
  const p = 'examples.html';
  const g = (s) => rel(p, guideBySlug(s).out);
  const KINDS = [['all', 'All'], ['series', 'Series'], ['indicators', 'Indicators'], ['panes', 'Panes and scales'], ['time', 'Time'], ...(DRAWINGS ? [['drawings', 'Drawings']] : []), ['element', 'Element']];
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
  const cards = EXAMPLES.filter((ex) => DRAWINGS || ex.kind !== 'drawings').map((ex) => {
    const stage = ex.element ? ELEMENTS[ex.id] : `<div class="chart h-240" data-demo="${ex.id}" data-label="${esc(ex.label)}"><p class="chart-fallback">${esc(ex.label)}. The chart appears when JavaScript runs.</p></div>`;
    const controls = ex.controls ? `<div class="demo-bar js-only">${controlsHtml(ex.controls)}</div>` : '';
    const tpl = ex.element ? `<template data-large>${ELEMENTS[ex.id].replace('height="240"', 'height="540"')}</template>` : '';
    return `<article class="card ex-card" id="${ex.id}" data-kind="${ex.kind}"${ex.big ? ` data-big="${ex.big}"` : ''} aria-labelledby="${ex.id}-h">
<div data-stage>${stage}${controls}</div>
<div class="ex-body"><h2 id="${ex.id}-h">${esc(ex.title)}</h2><p>${ex.text}</p><div class="ex-tags">${ex.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>
<div class="ex-actions"><button class="btn btn--sm js-only" type="button" data-open="${ex.id}" aria-haspopup="dialog">Open with code</button><a href="${g(ex.guide[0])}">${esc(ex.guide[1])}</a></div>
<div class="ex-source" hidden>${codeBlock(ex.code, ex.lang || 'js')}${tpl}</div>
</article>`;
  }).join('\n');
  const body = `<section class="index-panel"><div class="wrap"><nav class="crumb" aria-label="Breadcrumb"><a href="${rel(p, 'index.html')}">${esc(NAME)}</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">Examples</span></nav>
<h1 id="top">Charts you can <span class="serif-frame">touch.</span></h1><p class="lead">Every chart here is drawn by ${esc(NAME)} in your browser, from invented demo data. Drag to pan, scroll or pinch to zoom, tab in and press Enter to step through bars. Open any card for a large chart and its code.</p></div></section>
<div class="wrap">
<div class="filters js-only"><div class="seg" role="group" aria-label="Filter examples">${KINDS.map(([k, l], i) => `<button type="button" data-filter="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div></div>
<div class="gallery" id="ex-gallery">
${cards}
</div>
</div>
<dialog class="ex-dialog" id="ex-dialog" aria-labelledby="ex-dialog-title">
  <div class="ex-dialog-head"><h2 id="ex-dialog-title">Example</h2><a class="btn btn--sm" id="ex-dialog-guide" href="${g('getting-started')}">Guide</a><button class="icon-btn" type="button" data-close aria-label="Close the example">${ICON.close}</button></div>
  <div class="ex-dialog-body"><div class="ex-dialog-stage" data-stage id="ex-dialog-stage"></div><div class="ex-dialog-side"><p id="ex-dialog-text"></p><div id="ex-dialog-code"></div></div></div>
</dialog>`;
  pages.push({
    path: p, title: `Examples: candlestick, line, area, indicators and panes | ${NAME}`, demos: true, drawings: DRAWINGS,
    description: `Live ${NAME} charts you can touch: every series type, indicators, MACD and RSI panes, scale modes, a time zone switch and the chartist-chart web component.`,
    crumbs: [{ name: 'Home', path: 'index.html' }, { name: 'Examples', path: p }],
    body,
  });
  searchDocs.push({ t: 'Examples', u: p, d: 'Live charts with their code.', s: EXAMPLES.map((ex) => [ex.title, ex.id, ex.text.replace(/<[^>]+>/g, '')]) });
}

// Home: the product story in chapters.
{
  const sizes = await measureSizes();
  const coreGzip = sizes[0][2];
  const indGzip = sizes[1][2];
  const p = 'index.html';
  const g = (s) => rel(p, guideBySlug(s).out);
  const homeBars = makeBars(60, 19, 120);
  const ohlc = JSON.stringify(homeBars.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume })));
  const install = [
    ['script', 'Script tag', 'html', `<script src="chartist-lite.element.iife.min.js"></script>

<chartist-chart type="candlestick" src="/data/prices.json" height="360"
  time-zone="Asia/Kolkata" aria-label="Daily price"></chartist-chart>`, 'No build step. The tag reads JSON or CSV from <code>src</code>, an inline script or a <code>.data</code> property.'],
    ['module', 'ES module', 'js', `import { createChart, CandlestickSeries } from '@mrchartist/chartist-lite';

const chart = createChart('chart', { theme: 'dark', ariaLabel: 'Daily price' });
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);`, 'The container needs a height in CSS; the chart fills it and follows its size.'],
    ['react', 'React', 'jsx', `import * as React from 'react';
import { createChartistReact } from '@mrchartist/chartist-lite/react';

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
    ...(DRAWINGS ? [['drawings', 'Drawing tools']] : []), ['embed', 'Embed anywhere'], ['speed', 'Speed'], ['start', 'Get started'],
  ];
  const chapter = (key, h2, lead, content) => {
    const i = CH.findIndex((c) => c[0] === key);
    return `<section class="chapter" aria-labelledby="ch-${key}">${chapterLabel(i, CH.length, CH[i][1])}<div class="chapter-head"><h2 id="ch-${key}">${h2}</h2>${lead ? `<p>${lead}</p>` : ''}</div>${content}</section>`;
  };
  const win = (title, inner, extra = '') => `<div class="window" data-stage><div class="window-bar"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="window-title">${title}</span>${extra}</div>${inner}</div>`;
  const STANDOUT = [
    ...(PERF ? [[1, 'gauge', `<b>120 Hz frame budget, measured:</b> worst p95 ${PERF.worst.toFixed(1)} ms of ${PERF.budget.toFixed(2)}`, rel(p, PERF_PAGE)]] : []),
    ...(DRAWINGS ? [[2, 'pen', `<b>Drawing tools included:</b> ${DRAWING_TOOLS.length} tools, undo and JSON export`, '#ch-drawings']] : []),
    [3, 'wave', `<b>${INDICATOR_NAMES.length} indicators built in,</b> plus Heikin-Ashi and aggregation`, g('indicators')],
    [4, 'code', '<b>One HTML tag to embed:</b> <code>&lt;chartist-chart&gt;</code>', g('embedding')],
    [5, 'clock', '<b>Exchange time zones</b> without session gaps', g('time-and-time-zones')],
    [1, 'keys', '<b>Keyboard and screen reader</b> inspect mode', g('accessibility')],
  ].slice(0, 6);
  const apart = [
    [1, 'gauge', 'Built for 120 Hz', PERF ? `The costliest frame (p95) of ${PERF.scenarios} measured gestures takes ${PERF.worst.toFixed(2)} ms of the ${PERF.budget.toFixed(2)} ms a 120 Hz screen allows, in headless Chromium. Measure your own device.` : 'Each frame paints only what changed, and dense history folds into one column per pixel. Measure your own device.', '#ch-speed', 'See the meter'],
    [2, 'wave', 'Indicators built in', `${INDICATOR_NAMES.length} indicators as plain functions in a ${indGzip} KB entry, with live forms that cost the same per tick.`, g('indicators'), 'Indicators guide'],
    [3, 'panes', 'Stacked panes', 'RSI or MACD in its own pane, sharing the time axis and the crosshair, with a divider you can drag or move by keyboard.', g('panes-and-scales'), 'Panes guide'],
    [4, 'clock', 'Exchange time, no gaps', 'One slot per bar, so nights and weekends take no space; labels in any IANA zone, daylight saving included.', g('time-and-time-zones'), 'Time guide'],
    [5, 'code', 'A tag, no code', 'Write <code>&lt;chartist-chart&gt;</code> with a data source. The fallback table inside it is what crawlers read.', g('embedding'), 'Embedding guide'],
    [1, 'keys', 'Keyboard and screen reader', 'Focus the chart, press Enter, and step through bars; each one is announced through a live region.', g('accessibility'), 'Accessibility guide'],
    [2, 'shield', 'Safe on strict pages', 'Works under a <code>style-src \'self\'</code> policy; hostile page CSS and right-to-left pages do not reach it.', g('embedding') + '#strict-content-security-policy-hostile-page-css-right-to-left-pages', 'What was checked'],
    [3, 'minus', 'Numbers that read right', 'A true minus sign (<span class="num">−2.35</span>), no grouping commas (<span class="num">12345.60</span>), tabular figures on the axes.', g('time-and-time-zones') + '#numbers-on-the-axis', 'Number rules'],
  ];
  const body = `<section class="hero-panel" aria-labelledby="hero-h"><div class="wrap hero">
<div class="hero-text">
<p class="pill"><span class="tile tile--5">${GLYPH.candles}</span>Open source charting, version ${esc(VERSION)}</p>
<h1 id="hero-h">Financial charts <span class="serif-frame">that stay light.</span></h1>
<p class="lead">Candlesticks, indicators, ${DRAWINGS ? 'drawing tools, ' : ''}stacked panes and exchange time zones on one canvas. ${coreGzip} KB gzip, no runtime dependencies, and every chart works from the keyboard.</p>
<div class="actions"><a class="btn btn--primary btn--lg" href="${g('getting-started')}">Get started ${ICON.arrow}</a><a class="btn btn--lg" href="${rel(p, 'examples.html')}">Browse examples</a></div>
</div>
<div class="hero-visual">
${win('', `<div class="chart" data-demo="home" data-label="Demo daily candlestick chart with a 20-bar moving average"><noscript><img src="${rel(p, 'assets/img/basic-light.png')}" width="${ogImage.size.width}" height="${ogImage.size.height}" alt="${esc(OG_ALT)}"></noscript></div>
<div class="demo-bar js-only"><div class="seg" role="group" aria-label="Series type"><button type="button" data-hero-type="candles" aria-pressed="true">Candles</button><button type="button" data-hero-type="bars" aria-pressed="false">Bars</button><button type="button" data-hero-type="line" aria-pressed="false">Line</button><button type="button" data-hero-type="area" aria-pressed="false">Area</button></div><div class="hero-controls" role="group" aria-label="Indicators"><button class="chip" type="button" data-hero-ind="sma" aria-pressed="true"><span class="dot" aria-hidden="true"></span>SMA 20</button><button class="chip" type="button" data-hero-ind="bb" aria-pressed="false"><span class="dot" aria-hidden="true"></span>Bollinger</button><button class="chip" type="button" data-hero-ind="volume" aria-pressed="false"><span class="dot" aria-hidden="true"></span>Volume</button><button class="chip" type="button" data-hero-ind="rsi" aria-pressed="false"><span class="dot" aria-hidden="true"></span>RSI pane</button></div></div>`, `<span class="js-only"><span class="seg" role="group" aria-label="Theme"><button type="button" data-set-theme="dark" aria-pressed="true">Dark</button><button type="button" data-set-theme="light" aria-pressed="false">Light</button></span></span>`)}
<div class="hero-chips"><span class="fact-chip fc-1"><span class="k">Size</span><span class="v">${coreGzip} KB gzip</span></span><a class="fact-chip fc-2" href="${rel(p, PERF_PAGE)}"><span class="k">${PERF && PERF.over === 0 ? '120 Hz ready' : 'Series'}</span><span class="v">${PERF && PERF.over === 0 ? `worst p95 ${PERF.worst.toFixed(1)} ms of ${PERF.budget.toFixed(2)}` : `${SERIES_COUNT} types`}</span></a><span class="fact-chip fc-3"><span class="k">Dependencies</span><span class="v">${RUNTIME_DEPS === 0 ? 'None' : RUNTIME_DEPS}</span></span></div>
</div>
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
<div class="intro-side"><p>${SERIES_COUNT} series types, ${INDICATOR_NAMES.length} indicators, stacked panes, exchange time zones and a legend that reads the bar under the pointer. It has no runtime dependencies and never fetches data on its own.</p><p>It is written from scratch by ${esc(config.author.name)}. Many names will feel familiar if you know Lightweight Charts, on purpose; the code is its own, and the guide lists where behaviour differs.</p></div></div>
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

${DRAWINGS ? chapter('drawings', 'Drawing <span class="serif-frame">tools.</span>', `${DRAWING_TOOLS.length} tools in a separate entry of ${sizes.find((r) => /Drawings/.test(r[0]))?.[2] ?? ''} KB gzip, on the chart's own pointer and keyboard hooks. Pick a tool on the rail and draw on this chart.`, `<div class="playground">
${win('Playground: the real toolbar on a real chart', `<div class="chart h-480" data-demo="draw" data-label="Demo chart with drawing tools: pick a tool on the left rail and draw"></div><div class="demo-bar js-only">${controlsHtml('draw')}</div><pre class="out js-only" data-out tabindex="0" aria-live="polite" aria-label="Exported drawings">Export JSON shows the drawings here, as the text you would save.</pre>`)}
<div class="playground-side"><div class="duo-text"><h3 id="draw-tools">Every tool</h3><p>${DRAWING_TOOLS.map((t) => esc(t.label)).join(', ')}.</p><h3 id="draw-keys">Keys, with the chart focused</h3><ul class="key-list"><li><kbd>Delete</kbd> removes the selected drawing</li><li><kbd>Esc</kbd> drops the tool or the selection</li><li><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> nudge it (<kbd>Shift</kbd> for 10)</li><li><kbd>Ctrl</kbd> <kbd>Z</kbd> undo, <kbd>Ctrl</kbd> <kbd>Y</kbd> redo</li><li><kbd>Shift</kbd> <kbd>H</kbd> adds a horizontal line</li></ul><a href="${g('drawing-tools')}">Drawing tools guide</a></div></div>
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

${chapter('speed', 'Built for <span class="serif-frame">120 Hz.</span>', PERF ? `A 120 Hz screen gives each frame ${PERF.budget.toFixed(2)} ms. In ${PERF.scenarios} measured gestures, up to ${PERF.panBars} bars, the costliest frame of our code took ${PERF.worst.toFixed(2)} ms at p95, and ${PERF.over === 0 ? 'none' : PERF.over} went over. The meter times this chart on your own device.` : 'A 120 Hz screen gives each frame 8.33 ms. The meter times this chart on your own device while it pans and zooms through 5000 bars.', `<div class="speed">
${win('Frame meter, on your device', `<div class="chart h-280" data-demo="meter" data-label="Demo chart of 5000 bars used to time pan and zoom frames on this device"></div><div class="meter js-only" id="meter"><canvas id="meter-canvas" width="600" height="96" aria-hidden="true"></canvas><div class="meter-read" role="status" id="meter-read">The meter runs when the chart is on screen.</div><div class="meter-legend"><span>Each bar is one frame: the time to move the view and paint it.</span><span>The line is the 8.33 ms budget of a 120 Hz frame.</span></div></div>`, `<span class="js-only"><button class="btn btn--sm" type="button" id="meter-run">Run again</button></span>`)}
<div class="card bench">${benchHtml().replace("PERF_HREF", rel(p, PERF_PAGE))}</div>
</div>`)}

${chapter('start', 'Start in a <span class="serif-frame">minute.</span>', `Version ${esc(VERSION)} is not on npm yet, so build it once and host the file yourself.`, `<div class="install">
<div><ol class="install-steps"><li>Run <code>npm install</code> and <code>npm run build</code> in <code>packages/chartist-lite</code>.</li><li>Copy the file you need from <code>dist/</code> next to your page.</li><li>Paste one of the snippets above and give it your rows.</li></ol>
<div class="actions"><a class="btn btn--primary btn--lg" href="${g('getting-started')}">Read Getting started ${ICON.arrow}</a><a class="btn btn--lg" href="${rel(p, 'guide/index.html')}">All guides</a></div></div>
<div class="honest"><div class="card"><h3 id="not-h">What it is not</h3><ul class="not-list"><li>No data feed. You give it rows; it never fetches prices by itself (the element can load a JSON or CSV file you point it at).</li><li>No order placement and no trading features.</li><li>No pattern detection or signals. Markers show what you give them.</li>${DRAWINGS ? '' : '<li>No drawing tools in this version: no trend lines, Fibonacci tools or text notes. A primitive can draw your own marks.</li>'}</ul></div>
<div class="card"><h3 id="status-h">Status</h3><dl class="status-list"><dt>Version</dt><dd>${esc(VERSION)}, not yet on npm</dd><dt>Licence</dt><dd>${esc(config.license.name)}</dd><dt>Tested in</dt><dd>Chromium, through Playwright</dd><dt>Not yet tested</dt><dd>Firefox, Safari, screen readers</dd><dt>Made by</dt><dd><a href="${esc(config.author.url)}" rel="noopener">${esc(config.author.name)}</a></dd></dl></div></div>
</div>`)}
</div>`;
  pages.unshift({
    path: p, title: `${NAME}: a lightweight financial chart library, no dependencies`, demos: true, drawings: DRAWINGS, bodyClass: 'home',
    description: 'A lightweight financial chart library: candlestick and other series, indicators, panes, time zones and a chartist-chart web component. No dependencies.',
    body,
    ld: [{ '@context': 'https://schema.org', '@type': 'SoftwareSourceCode', name: NAME, description: config.tagline, programmingLanguage: 'TypeScript', license: config.license.url, version: VERSION, url: baseUrl, author: author(), ...(config.repoUrl ? { codeRepository: config.repoUrl } : {}) }],
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
  const srcCode = `window.__CL_LIVE = Object.assign(window.__CL_LIVE || {}, {\n${fns.join(',\n')}\n});`;
  let code;
  try { code = (await transform(srcCode, { minify: true, target: 'es2020', loader: 'js' })).code; }
  catch (e) { throw new Error(`a live example on ${p} does not compile: ${e.message}`); }
  writeFileSync(path.join(out, 'assets', name), code);
}
writeFileSync(path.join(out, 'assets', 'search-index.js'), `window.__CL_SEARCH=${JSON.stringify(searchDocs).replace(/</g, '\\u003c')};`);
copyFileSync(path.join(here, 'assets', 'site.css'), path.join(out, 'assets', 'site.css'));
copyFileSync(path.join(here, 'assets', 'fonts.css'), path.join(out, 'assets', 'fonts.css'));
cpSync(path.join(here, 'assets', 'fonts'), path.join(out, 'assets', 'fonts'), { recursive: true });
for (const f of ['chartist-lite.iife.min.js', 'chartist-lite-indicators.iife.min.js', 'chartist-lite.element.iife.min.js', ...(DRAWINGS ? ['chartist-lite-drawings.iife.min.js'] : [])]) {
  const src = path.join(pkg, 'dist', f);
  if (!existsSync(src)) throw new Error(`dist/${f} is missing: run "npm run build" in packages/chartist-lite first`);
  copyFileSync(src, path.join(out, 'assets', f));
}
copyFileSync(path.join(pkg, config.ogImageSource), path.join(out, ogImage.path));
copyFileSync(path.join(pkg, 'docs/screenshots/basic-light.png'), path.join(out, 'assets/img/basic-light.png'));
for (const [dest, src] of assets) { mkdirSync(path.dirname(path.join(out, dest)), { recursive: true }); copyFileSync(src, path.join(out, dest)); }

for (const page of pages) {
  const file = path.join(out, page.path);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, layout(page));
}

const loc = (p) => baseUrl + (p === 'index.html' ? '' : p);
writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${esc(loc(p.path))}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}sitemap.xml\n`);

if (baseUrl.includes('example.invalid')) warnings.push('baseUrl in site/site.config.json is the placeholder; set the real address before publishing (canonical, Open Graph, JSON-LD and sitemap use it)');
let bytes = 0;
(function walk(d) { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : (bytes += statSync(p).size); } })(out);
const sz = (f) => statSync(path.join(out, 'assets', f)).size;
const gzs = (f) => gzipSync(readFileSync(path.join(out, 'assets', f)), { level: 9 }).length;
console.log(`site: ${pages.length} pages, ${(bytes / 1024).toFixed(0)} KB, written to ${posix(path.relative(process.cwd(), out)) || '.'}`);
console.log(`  site.css ${sz('site.css')} B (gzip ${gzs('site.css')}), site.js ${sz('site.js')} B (gzip ${gzs('site.js')}), demos.js ${sz('demos.js')} B (gzip ${gzs('demos.js')}), boot.js ${sz('boot.js')} B, search-index.js ${sz('search-index.js')} B (gzip ${gzs('search-index.js')}), live scripts ${[...liveBundles.keys()].length}`);
for (const w of [...new Set(warnings)]) console.warn(`warning: ${w}`);
