#!/usr/bin/env node
// Builds the documentation site into site/dist/: static HTML (real text in the source), one small stylesheet, one page
// script, the package's own built scripts for the live charts, sitemap.xml and robots.txt. No framework, no web fonts.
//
//   npm run build && npm run site          (the site needs dist/ of the package: it serves the real library)
//
// Needs `esbuild`, a development tool of this package. Settings (base URL and so on) are in site.config.json.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { esc, parseFrontMatter, renderMarkdown } from './markdown.mjs';
import { makeBars } from './src/demo-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..');
const out = path.join(here, 'dist');
const config = JSON.parse(readFileSync(path.join(here, 'site.config.json'), 'utf8'));
const pkgJson = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8'));
const baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`;
const NAME = config.name;
const warnings = [];

const posix = (p) => p.split(path.sep).join('/');
const read = (rel) => readFileSync(path.join(pkg, rel), 'utf8');

/** A relative URL from the page `from` to the file `to` (both paths inside dist, with forward slashes). */
function rel(from, to) {
  const r = path.posix.relative(path.posix.dirname(from), to);
  return r === '' ? path.posix.basename(to) : r;
}

function pngSize(file) {
  const b = readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// ---------- sources ----------
const guideDir = path.join(pkg, 'docs', 'guide');
const guides = readdirSync(guideDir).filter((f) => f.endsWith('.md')).map((f) => {
  const slug = f.replace(/\.md$/, '');
  const { meta, body } = parseFrontMatter(readFileSync(path.join(guideDir, f), 'utf8'));
  if (!meta.title || !meta.description) throw new Error(`docs/guide/${f} needs a title and a description in its front matter`);
  return { slug, src: `docs/guide/${f}`, out: `guide/${slug}.html`, title: meta.title, description: meta.description, order: Number(meta.order || 99), related: (meta.related || '').split(',').map((s) => s.trim()).filter(Boolean), body };
}).sort((a, b) => a.order - b.order);

const mdMap = new Map([['README.md', 'readme.html'], ...guides.map((g) => [g.src, g.out])]);
const assets = new Map(); // dist path -> source file

function renderOptions(page, srcFile) {
  const srcDir = path.posix.dirname(srcFile);
  return {
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
      const target = path.posix.normalize(path.posix.join(srcDir, src));
      const f = path.join(pkg, target);
      return existsSync(f) ? pngSize(f) : null;
    },
  };
}

// ---------- sizes, measured now ----------
async function measureSizes() {
  const gz = (buf) => gzipSync(buf, { level: 9 }).length;
  const kb = (n) => (n / 1024).toFixed(1);
  const rows = [];
  const ENTRIES = [
    ['Core (ES module, createChart and the six series)', 'src/index.ts'],
    ['Indicators entry', 'src/indicators/index.ts'],
    ['Element entry (includes the chart)', 'src/element/index.ts'],
    ['React entry (includes the chart)', 'src/react/index.ts'],
  ];
  for (const [label, entry] of ENTRIES) {
    const res = await build({ absWorkingDir: pkg, entryPoints: [entry], bundle: true, format: 'esm', minify: true, target: 'es2020', write: false, legalComments: 'none', logLevel: 'silent' });
    const code = res.outputFiles[0].contents;
    rows.push([label, kb(code.length), kb(gz(code))]);
  }
  const IIFES = [
    ['Script tag: chartist-lite.iife.min.js', 'dist/chartist-lite.iife.min.js'],
    ['Script tag: chartist-lite-indicators.iife.min.js', 'dist/chartist-lite-indicators.iife.min.js'],
    ['Script tag: chartist-lite.element.iife.min.js (the web component, includes the chart)', 'dist/chartist-lite.element.iife.min.js'],
  ];
  for (const [label, file] of IIFES) {
    const buf = readFileSync(path.join(pkg, file));
    rows.push([label, kb(buf.length), kb(gz(buf))]);
  }
  return rows;
}

// ---------- page chrome ----------
const FAVICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1D1D1F"/><path d="M9 8v16M16 12v12M23 6v14" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>')}`;
const NAV = [
  { label: 'Guide', path: 'guide/index.html', match: (p) => p.startsWith('guide/') },
  { label: 'Examples', path: 'examples.html', match: (p) => p === 'examples.html' },
  { label: 'API reference', path: 'guide/api-reference.html', match: () => false },
  { label: 'README', path: 'readme.html', match: (p) => p === 'readme.html' },
];
const THEME_BOOT = `try{var t=localStorage.getItem('cl-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

function ld(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

function author() {
  return { '@type': config.author.type, name: config.author.name, url: config.author.url };
}

function crumbList(crumbs) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: baseUrl + (c.path === 'index.html' ? '' : c.path) })),
  };
}

const ogImage = { path: 'assets/og-image.png', size: pngSize(path.join(pkg, config.ogImageSource)) };
const OG_ALT = 'A daily candlestick chart with a 20-bar moving average, drawn by Chartist Lite from demo data.';

function layout(page) {
  const p = page.path;
  const url = baseUrl + (p === 'index.html' ? '' : p);
  const nav = NAV.map((n) => `<a href="${rel(p, n.path)}"${n.match(p) ? ' aria-current="page"' : ''}>${n.label}</a>`).join('');
  const scripts = (page.scripts || []).map((s) => `<script src="${rel(p, s)}" defer></script>`).join('\n');
  const crumbs = page.crumbs && page.crumbs.length > 1
    ? `<nav class="crumbs" aria-label="Breadcrumb"><ol>${page.crumbs.map((c, i) => (i === page.crumbs.length - 1 ? `<li><span aria-current="page">${esc(c.name)}</span></li>` : `<li><a href="${rel(p, c.path)}">${esc(c.name)}</a></li>`)).join('')}</ol></nav>`
    : '';
  const ldBlocks = [...(page.ld || []), ...(page.crumbs && page.crumbs.length > 1 ? [crumbList(page.crumbs)] : [])].map(ld).join('\n');
  const img = baseUrl + ogImage.path;
  return `<!doctype html>
<html lang="${config.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F8F8F8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0C0C0C" media="(prefers-color-scheme: dark)">
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
<link rel="stylesheet" href="${rel(p, 'assets/site.css')}">
<script>${THEME_BOOT}</script>
${scripts}
${ldBlocks}
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${rel(p, 'index.html')}">${esc(NAME)}</a>
    <nav class="main-nav" aria-label="Main">${nav}</nav>
    <button class="btn" id="theme-toggle" type="button" aria-pressed="false" hidden>Dark mode</button>
  </div>
</header>
<main id="main" tabindex="-1">
<div class="wrap">
${crumbs}
${page.body}
</div>
</main>
<footer class="site-footer">
  <div class="wrap">
    <nav class="footer-nav" aria-label="Footer">${nav}</nav>
    <p>${esc(NAME)} ${esc(pkgJson.version)} is an independent open-source project, written from scratch. It is not affiliated with, endorsed by or derived from TradingView or any other charting product. Licence: ${esc(config.license.name)}.</p>
    <p>Made by <a href="${esc(config.author.url)}">${esc(config.author.name)}</a>. The charts on this site are drawn from invented demo data, not market data, and nothing here is investment advice.</p>
  </div>
</footer>
</body>
</html>
`;
}

function guideNav(current) {
  const items = guides.map((g) => `<li><a href="${rel(current, g.out)}"${g.out === current ? ' aria-current="page"' : ''}>${esc(g.title)}</a></li>`).join('');
  return {
    side: `<nav class="side-nav" aria-label="Guide pages"><p class="side-title">Guide</p><ul>${items}</ul></nav>`,
    mobile: `<details class="mobile-nav"><summary>Guide pages</summary><ul>${items}</ul></details>`,
  };
}

// ---------- pages ----------
const pages = [];

function guidePage(g, i) {
  const opts = renderOptions(g.out, g.src);
  const md = renderMarkdown(g.body, opts);
  const h2 = md.headings.filter((h) => h.level === 2);
  const toc = h2.length >= 3
    ? `<nav class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ul>${h2.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ul></nav>`
    : '';
  const html = md.html.replace('</h1>', `</h1>${toc}`);
  const prev = guides[i - 1];
  const next = guides[i + 1];
  const pager = `<nav class="pager" aria-label="Previous and next guide">${prev ? `<a class="prev" href="${rel(g.out, prev.out)}" rel="prev"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${rel(g.out, next.out)}" rel="next"><small>Next</small>${esc(next.title)}</a>` : ''}</nav>`;
  const related = g.related.map((s) => guides.find((x) => x.slug === s)).filter(Boolean);
  const relatedHtml = related.length
    ? `<section class="related" aria-labelledby="related-h"><h2 id="related-h">Related guides</h2><ul>${related.map((r) => `<li><a href="${rel(g.out, r.out)}">${esc(r.title)}</a>: ${esc(r.description)}</li>`).join('')}</ul></section>`
    : '';
  const nav = guideNav(g.out);
  const crumbs = [{ name: 'Home', path: 'index.html' }, { name: 'Guide', path: 'guide/index.html' }, { name: g.title, path: g.out }];
  pages.push({
    path: g.out, title: `${g.title} | ${NAME}`, description: g.description, crumbs, ogType: 'article',
    ld: [{
      '@context': 'https://schema.org', '@type': 'TechArticle', headline: g.title, description: g.description, inLanguage: config.locale,
      url: baseUrl + g.out, author: author(), isPartOf: { '@type': 'WebSite', name: NAME, url: baseUrl },
      about: { '@type': 'SoftwareSourceCode', name: NAME },
    }],
    body: `<div class="guide">${nav.side}<article class="prose">${nav.mobile}${html}${relatedHtml}${pager}</article></div>`,
  });
}
guides.forEach(guidePage);

// Guide index
pages.push({
  path: 'guide/index.html', title: `Guide: how to use ${NAME}`, crumbs: [{ name: 'Home', path: 'index.html' }, { name: 'Guide', path: 'guide/index.html' }],
  description: `Guides for ${NAME}: getting started, embedding, series types, indicators, panes and scales, time zones, theming, plugins, accessibility and the API reference.`,
  body: `<div class="prose"><h1>Guide</h1><p class="lead">Each page covers one part of the library. Start with Getting started, then pick what you need.</p></div>
<ul class="guide-list">${guides.map((g) => `<li><a class="card" href="${rel('guide/index.html', g.out)}"><h2>${esc(g.title)}</h2><p>${esc(g.description)}</p></a></li>`).join('')}</ul>`,
});

// README
{
  const g = { out: 'readme.html', src: 'README.md' };
  const md = renderMarkdown(read('README.md'), renderOptions(g.out, g.src));
  pages.push({
    path: g.out, title: `README: ${NAME} overview, install and features`, ogType: 'article',
    description: `The ${NAME} README: what it is, how to install and use it, the feature list with measured sizes, what it is not, and how it differs in approach.`,
    crumbs: [{ name: 'Home', path: 'index.html' }, { name: 'README', path: 'readme.html' }],
    ld: [{ '@context': 'https://schema.org', '@type': 'TechArticle', headline: `${NAME} README`, inLanguage: config.locale, url: baseUrl + g.out, author: author(), isPartOf: { '@type': 'WebSite', name: NAME, url: baseUrl } }],
    body: `<article class="prose">${md.html}</article>`,
  });
}

// Examples
{
  const demo = makeBars(60, 19, 120);
  const hi = Math.max(...demo.map((b) => b.high));
  const lo = Math.min(...demo.map((b) => b.low));
  const first = demo[0];
  const last = demo[demo.length - 1];
  const rowsJson = (rows) => JSON.stringify(rows);
  const ohlc = demo.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume }));
  const vals = demo.map((b) => ({ time: b.time, value: b.close }));
  const fb = (cap) => `<table><caption>${cap}</caption><tr><th>Fact</th><th>Value</th></tr><tr><td>First bar</td><td>${first.time}, close ${first.close.toFixed(2)}</td></tr><tr><td>Last bar</td><td>${last.time}, close ${last.close.toFixed(2)}</td></tr><tr><td>Highest high</td><td>${hi.toFixed(2)}</td></tr><tr><td>Lowest low</td><td>${lo.toFixed(2)}</td></tr><tr><td>Bars</td><td>${demo.length}</td></tr></table>`;
  const ex = (id, title, text, label, cls, code, caption, extra = '') => `<section class="example" id="${id}" aria-labelledby="${id}-h">
<h2 id="${id}-h">${title}</h2>
<p>${text}</p>
<figure>${extra}<div class="chart ${cls}" data-demo="${id}" data-label="${esc(label)}"></div><figcaption>${caption}</figcaption></figure>
<pre tabindex="0"><code class="language-js">${esc(code)}</code></pre>
</section>`;
  const cap = 'Demo data: a seeded random walk, not a real instrument. Hover, scroll, drag or use the keyboard.';
  const toc = [['candles', 'Candlesticks, price lines and markers'], ['line', 'Line'], ['area', 'Area'], ['bar', 'OHLC bars'], ['histogram', 'Histogram'], ['baseline', 'Baseline'], ['indicators', 'Indicators on the price pane'], ['panes', 'Panes: volume and RSI'], ['zone', 'Time zones'], ['element', 'The chartist-chart element']];
  const body = `<div class="prose"><h1>Examples</h1>
<p class="lead">Every chart on this page is drawn by ${esc(NAME)} itself, in your browser, from invented demo data. Each one is created when it scrolls into view. The text under each chart says what it shows, so the page reads without JavaScript too.</p>
<nav class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ul>${toc.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('')}</ul></nav></div>
${ex('candles', 'Candlesticks, price lines and markers', 'A candlestick series with two price lines (resistance and support, from the highest high and lowest low of the last 30 bars) and a few buy and sell markers. Price lines and markers are small plugins built on the same primitive contract you can use for your own overlays.', 'Demo candlestick chart with price lines and markers', 'chart--tall', `const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
createPriceLine(candles, { price: 152.4, title: 'Resistance', lineStyle: 'dashed' });
createSeriesMarkers(candles, [
  { time: '2024-03-04', position: 'belowBar', shape: 'arrowUp', text: 'Buy' },
]);`, cap)}
${ex('line', 'Line', 'A line series of closing prices. Options include the colour, the width, the style (solid, dashed or dotted) and a step type that holds each value until the next bar.', 'Demo line chart of closing prices', '', `chart.addSeries(LineSeries, { title: 'Close' })
  .setData(bars.map(b => ({ time: b.time, value: b.close })));`, cap)}
${ex('area', 'Area', 'The same closing prices as an area series: a line with a fill below it that fades towards the bottom of the pane.', 'Demo area chart of closing prices', '', `chart.addSeries(AreaSeries, { title: 'Close' }).setData(rows);`, cap)}
${ex('bar', 'OHLC bars', 'The bar series draws open, high, low and close as a stem with an open tick on the left and a close tick on the right.', 'Demo OHLC bar chart', '', `chart.addSeries(BarSeries, { title: 'DEMO' }).setData(bars);`, cap)}
${ex('histogram', 'Histogram', 'Columns that grow from a base value. Each row here carries its own colour: the theme\'s up colour when the bar closed above its open, the down colour otherwise.', 'Demo volume histogram coloured by direction', '', `const volume = chart.addSeries(HistogramSeries, { title: 'Volume' });
volume.setData(bars.map(b => ({
  time: b.time, value: b.volume, color: b.close >= b.open ? lightTheme.up : lightTheme.down,
})));`, cap)}
${ex('baseline', 'Baseline', 'A line split around a base value (100 here): green with a light fill above it, red with a light fill below it.', 'Demo baseline chart around a value of 100', '', `chart.addSeries(BaselineSeries, { baseValue: 100, title: 'Close' }).setData(rows);`, cap)}
${ex('indicators', 'Indicators on the price pane', 'Candles with a 20-bar simple moving average (orange) and Bollinger bands (grey: basis dashed, upper and lower solid), computed by the <code>indicators</code> entry and drawn as line series. The indicator functions return rows aligned with your bars, with time-only rows while a window fills.', 'Demo candlestick chart with a moving average and Bollinger bands', 'chart--tall', `import { sma, bollinger } from '@mrchartist/chartist-lite/indicators';

chart.addSeries(LineSeries, { title: 'SMA 20' }).setData(sma(bars, 20));
const bb = bollinger(bars, { period: 20, mult: 2 });
chart.addSeries(LineSeries, { title: 'Bollinger upper' }).setData(bb.upper);`, cap)}
${ex('panes', 'Panes: volume and RSI', 'The price pane holds candles and, on an overlay scale at the bottom, volume columns. A second pane below holds the 14-bar RSI with dotted guides at 70 and 30. Panes share the time axis and the crosshair. Drag the line between the panes, or focus it and use the up and down arrow keys, to resize them.', 'Demo candlestick chart with volume and an RSI pane below', 'chart--panes', `const rsiLine = chart.addSeries(LineSeries, { title: 'RSI 14' }, 1);   // pane 1
rsiLine.setData(rsi(bars, 14));
createPriceLine(rsiLine, { price: 70, lineStyle: 'dotted' });`, cap)}
${ex('zone', 'Time zones', 'Five sessions of five-minute bars, stored as UNIX seconds. The time axis has no slot for the night between sessions, so nothing is drawn as a gap, and its labels are read in the zone you choose. Switch the zone to see the same bars labelled in another city. The zone changes the labels, never the data.', 'Demo five-minute candlestick chart over five sessions', 'chart--tall', `createChart('chart', { timeScale: { timeZone: 'Asia/Kolkata' } });
chart.applyOptions({ timeScale: { timeZone: 'America/New_York' } });`, 'Demo data: five invented sessions from 09:15 to 15:30 in UTC+5:30. The data does not change when you switch the zone.', `<div class="zones" data-zones role="group" aria-label="Axis time zone"><span>Axis zone:</span><button class="btn" type="button" data-zone="Asia/Kolkata" aria-pressed="true">Asia/Kolkata</button><button class="btn" type="button" data-zone="America/New_York" aria-pressed="false">America/New_York</button><button class="btn" type="button" data-zone="UTC" aria-pressed="false">UTC</button></div>`)}
<section class="example" id="element" aria-labelledby="element-h">
<h2 id="element-h">The chartist-chart element</h2>
<p>The same chart as a custom element, for pages with no build step. These two read their data from an inline <code>&lt;script type="application/json"&gt;</code> and carry a small table as fallback content: that table is what crawlers and visitors without JavaScript see, and the element hides it once the chart is drawn.</p>
<figure>
<chartist-chart type="candlestick" theme="auto" volume height="320" aria-label="Demo candlestick chart with volume, from the custom element">
<script type="application/json">${rowsJson(ohlc)}</script>
${fb('Demo bars for the candlestick element')}
</chartist-chart>
<figcaption>Attributes: <code>type="candlestick" volume height="320"</code>. ${demo.length} invented daily bars.</figcaption>
</figure>
<figure>
<chartist-chart type="area" theme="auto" height="260" aria-label="Demo area chart, from the custom element">
<script type="application/json">${rowsJson(vals)}</script>
${fb('Demo closing values for the area element')}
</chartist-chart>
<figcaption>Attributes: <code>type="area" height="260"</code>. The same bars, read as one closing value per day.</figcaption>
</figure>
<pre tabindex="0"><code class="language-html">&lt;script src="chartist-lite.element.iife.min.js"&gt;&lt;/script&gt;
&lt;chartist-chart type="candlestick" volume height="320"&gt;
  &lt;script type="application/json"&gt;[{"time":"2024-01-02","open":10,"high":12,"low":9,"close":11,"volume":900}]&lt;/script&gt;
&lt;/chartist-chart&gt;</code></pre>
</section>`;
  pages.push({
    path: 'examples.html', title: `Examples: candlestick, line, area, indicators and panes | ${NAME}`,
    description: `Live ${NAME} charts you can touch: every series type, indicators, a volume and RSI pane, a time zone switch and the chartist-chart web component.`,
    crumbs: [{ name: 'Home', path: 'index.html' }, { name: 'Examples', path: 'examples.html' }],
    scripts: ['assets/chartist-lite.iife.min.js', 'assets/chartist-lite-indicators.iife.min.js', 'assets/chartist-lite.element.iife.min.js', 'assets/site.js'],
    body,
  });
}

// Home
{
  const sizes = await measureSizes();
  const g = (slug) => guides.find((x) => x.slug === slug).out;
  const p = 'index.html';
  const card = (title, text, to) => `<div class="card"><h3>${title}</h3><p>${text}</p>${to ? `<p><a href="${rel(p, g(to[0]))}">${to[1]}</a></p>` : ''}</div>`;
  const body = `<section class="hero" aria-labelledby="hero-h">
<h1 id="hero-h">${esc(NAME)}: a small canvas chart for financial data</h1>
<p class="lead">${esc(NAME)} is a lightweight financial chart library for the web. It draws <strong>candlestick</strong>, bar, line, area, histogram and baseline series on one canvas, with built-in indicators, stacked panes and exchange time zones. Use it from JavaScript or React, or drop in the <code>&lt;chartist-chart&gt;</code> web component. It has no runtime dependencies.</p>
<div class="actions">
<a class="btn btn--primary" href="${rel(p, g('getting-started'))}">Get started</a>
<a class="btn" href="${rel(p, 'examples.html')}">See more examples</a>
</div>
<p class="status">Version ${esc(pkgJson.version)}. Not yet published to npm. Licence ${esc(config.license.name)}.</p>
</section>
<figure>
<div class="chart chart--tall" data-demo="home" data-label="Demo daily candlestick chart with a 20-bar moving average"><noscript><img src="${rel(p, 'assets/img/basic-light.png')}" width="${ogImage.size.width}" height="${ogImage.size.height}" alt="${esc(OG_ALT)}"></noscript></div>
<figcaption>A live chart from ${esc(NAME)}, drawn from demo data (a seeded random walk, not a real instrument): daily candles and a 20-bar simple moving average. Scroll to zoom, drag to pan, press Enter on the chart to step through bars with the keyboard.</figcaption>
</figure>

<section class="section" aria-labelledby="quick-h">
<h2 id="quick-h">Quick start</h2>
<p class="sub">One script tag and one element. The data can be a URL, an inline JSON script or a property. The chart is created when it scrolls near the viewport.</p>
<pre tabindex="0"><code class="language-html">&lt;script src="chartist-lite.element.iife.min.js"&gt;&lt;/script&gt;

&lt;chartist-chart type="candlestick" theme="auto" src="/data/prices.json" height="360"
  time-zone="Asia/Kolkata" aria-label="Daily price"&gt;&lt;/chartist-chart&gt;</code></pre>
<p>Prefer code? <a href="${rel(p, g('getting-started'))}">Getting started</a> shows the ES module with <code>createChart</code> and the React wrapper, and <a href="${rel(p, g('embedding'))}">Embedding the chart</a> covers the attributes, the data formats and iframes.</p>
</section>

<section class="section" aria-labelledby="features-h">
<h2 id="features-h">What it does</h2>
<p class="sub">A focused set of features for charts of prices, written down in the guides.</p>
<div class="grid">
${card('Six series types', 'Candlestick, OHLC bar, line, area, histogram and baseline, with per-series colours that follow the theme.', ['series-types', 'Series types'])}
${card('Built-in indicators', 'Twelve indicators (moving averages, Bollinger, RSI, MACD, Supertrend and more), Heikin-Ashi and bar aggregation, as plain functions with incremental forms for live data.', ['indicators', 'Indicators'])}
${card('Stacked panes', 'Put RSI or MACD in a pane under the price, with its own scale, a shared time axis and a draggable divider.', ['panes-and-scales', 'Panes and scales'])}
${card('Exchange-aware time axis', 'No gap for nights and weekends, ticks on real calendar boundaries, labels read in any IANA time zone, daylight saving included.', ['time-and-time-zones', 'Time and time zones'])}
${card('Light, dark and auto', 'Built-in palettes, colour overrides, system fonts and a switch at runtime. A true minus sign and no grouping commas by default.', ['theming', 'Theming'])}
${card('Accessible by design', 'A focusable chart with a name, keyboard control and a live region that reads the bar you inspect. Read what is and is not tested.', ['accessibility', 'Accessibility'])}
${card('Plugins', 'Price lines and series markers, built on a small primitive contract you can use for your own overlays.', ['plugins', 'Plugins and primitives'])}
${card('Four ways to embed', 'A web component, an ES module, React, or an iframe for sites that forbid scripts.', ['embedding', 'Embedding the chart'])}
</div>
</section>

<section class="section" aria-labelledby="sizes-h">
<h2 id="sizes-h">Sizes</h2>
<p class="sub">Measured when this site was built, from the package's own source: each entry bundled and minified with esbuild, then gzipped at level 9. The script files are the ones in <code>dist/</code>.</p>
<div class="table-wrap" role="region" tabindex="0" aria-label="Table: sizes"><table><thead><tr><th scope="col">Build</th><th scope="col" class="num">Minified, KB</th><th scope="col" class="num">Gzip, KB</th></tr></thead><tbody>${sizes.map((r) => `<tr><td>${esc(r[0])}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td></tr>`).join('')}</tbody></table></div>
<p class="note">The core entry has a budget of 45 KB gzip that the package's own size check enforces. Charts with 100000 one-minute bars are covered in the README, with the machine and browser they were measured on.</p>
</section>

<section class="section" aria-labelledby="not-h">
<h2 id="not-h">What it is not</h2>
<ul>
<li>It has no drawing tools (no trend lines, Fibonacci or text notes), though you can draw your own marks with a primitive.</li>
<li>It has no data feed. You give it rows; it never fetches prices on its own (the element can load a JSON or CSV file you point it at).</li>
<li>It places no orders and has no trading features.</li>
</ul>
</section>

<section class="section" aria-labelledby="indep-h">
<h2 id="indep-h">An independent project</h2>
<p>${esc(NAME)} is independent and written from scratch by <a href="${esc(config.author.url)}">${esc(config.author.name)}</a>. It is not affiliated with TradingView, and it contains no code from any other charting library. The way you create a chart and add series will feel familiar on purpose; the code is its own, and <a href="${rel(p, 'readme.html')}">the README</a> says how the approach differs.</p>
</section>`;
  pages.unshift({
    path: p, title: `${NAME}: a lightweight financial chart library, no dependencies`,
    description: 'A lightweight financial chart library: candlestick and other series, indicators, panes, time zones and a chartist-chart web component. No dependencies.',
    scripts: ['assets/chartist-lite.iife.min.js', 'assets/site.js'], body,
    ld: [{
      '@context': 'https://schema.org', '@type': 'SoftwareSourceCode', name: NAME, description: config.tagline,
      programmingLanguage: 'TypeScript', license: config.license.url, version: pkgJson.version, url: baseUrl,
      author: author(), ...(config.repoUrl ? { codeRepository: config.repoUrl } : {}),
    }],
  });
}

// ---------- write ----------
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'assets', 'img'), { recursive: true });
mkdirSync(path.join(out, 'guide'), { recursive: true });

const bundle = await build({ entryPoints: [path.join(here, 'src', 'site.js')], bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, legalComments: 'none', logLevel: 'warning' });
writeFileSync(path.join(out, 'assets', 'site.js'), bundle.outputFiles[0].text);
copyFileSync(path.join(here, 'assets', 'site.css'), path.join(out, 'assets', 'site.css'));
for (const f of ['chartist-lite.iife.min.js', 'chartist-lite-indicators.iife.min.js', 'chartist-lite.element.iife.min.js']) {
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
console.log(`site: ${pages.length} pages, ${(bytes / 1024).toFixed(0)} KB, written to ${posix(path.relative(process.cwd(), out)) || '.'}`);
for (const w of [...new Set(warnings)]) console.warn(`warning: ${w}`);
