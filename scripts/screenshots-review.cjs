// Browser checks for the 2026-11-21 review findings that need a DOM: strict CSP, hostile host CSS, RTL, the
// attribution click, wheel and page scroll, pending view requests, pane options, time-kind errors, shrinking data,
// primitives on removal, moving overlay scales, touch-action, ids, minMove, the element's focus ring and `.data` over a
// slow `src`, and marker cost at 200k bars. Writes docs/screenshots/hostile-*.png. Needs Playwright importable here (not
// a dev dependency) and a build (`npm run build`). `node scripts/screenshots-review.cjs`
const { chromium } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv', '.map': 'application/json' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const rel = decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    const send = () => {
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    };
    // ?slow=ms delays the answer (a fetch still in flight).
    const slow = Number(url.searchParams.get('slow') || 0);
    if (slow > 0) setTimeout(send, slow); else send();
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const failures = [];
const check = (ok, what, detail) => { if (!ok) failures.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

(async () => {
  for (const f of ['chartist-lite.iife.min.js', 'chartist-lite.element.iife.min.js']) {
    if (!fs.existsSync(path.join(root, 'dist', f))) throw new Error(`run \`npm run build\` first (dist/${f} is missing)`);
  }
  fs.mkdirSync(out, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const watch = page => {
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  };

  // ── hostile page: CSP, host CSS, RTL ──
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await ctx.route('https://mrchartist.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>ok</p>' }));
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`${base}/examples/hostile/index.html`);
  await page.waitForFunction(() => { const el = document.getElementById('el'); return el && el.ready; }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const dom = await page.evaluate(() => {
    const box = document.getElementById('chart');
    const rootEl = box.firstElementChild;
    const canvases = [...rootEl.querySelectorAll('canvas')];
    const el = document.getElementById('el');
    const r = el.getBoundingClientRect();
    const link = rootEl.querySelector('[data-chartist-attribution]');
    const lr = link.getBoundingClientRect();
    const cs = getComputedStyle(rootEl);
    return {
      box: [box.clientWidth, box.clientHeight],
      root: [rootEl.clientWidth, rootEl.clientHeight, cs.paddingTop, cs.borderTopWidth, rootEl.getAttribute('dir')],
      canvases: canvases.map(c => { const s = getComputedStyle(c); return [c.getBoundingClientRect().width, c.getBoundingClientRect().height, s.borderTopWidth, s.marginTop]; }),
      element: [r.width, r.height, el.ready],
      link: [lr.width, lr.height],
      ids: rootEl.getAttribute('aria-describedby'),
      touch: cs.touchAction,
    };
  });
  check(dom.root[0] === dom.box[0] && dom.root[1] === dom.box[1] && dom.root[2] === '0px' && dom.root[3] === '0px', 'host div{} rules do not reach the chart root', dom.root);
  check(dom.canvases.every(c => c[0] === dom.box[0] && c[1] === dom.box[1] && c[2] === '0px' && c[3] === '0px'), 'host canvas{} !important rules do not reach the canvases', dom.canvases);
  check(dom.element[0] > 100 && dom.element[1] === 260 && dom.element[2] === true, '<chartist-chart> draws under style-src \'self\' (no inline styles)', dom.element);
  check(dom.link[0] > 20 && dom.link[0] < 80 && dom.link[1] < 30, 'host a{} / a::after rules do not reach the attribution link', dom.link);
  check(dom.root[4] === 'ltr', 'chart root is dir="ltr" on an RTL page', dom.root[4]);
  check(/^chartist-lite-\d+-[a-z0-9]{4,}-help$/.test(dom.ids), 'element ids carry a random part', dom.ids);
  check(dom.touch === 'pan-y', 'touch-action follows the gesture options (default pan-y)', dom.touch);
  await page.screenshot({ path: path.join(out, 'hostile-rtl-csp.png') });

  // The attribution link opens on click (pointer capture must not swallow it).
  const linkBox = await page.evaluate(() => { const l = document.querySelector('#chart [data-chartist-attribution]').getBoundingClientRect(); return { x: l.x + l.width / 2, y: l.y + l.height / 2 }; });
  const popup = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
  await page.mouse.click(linkBox.x, linkBox.y);
  const pop = await popup;
  check(!!pop && /mrchartist\.com/.test(pop.url()), 'the attribution link opens on click', pop ? pop.url() : null);
  if (pop) await pop.close();
  // The link sits in the cell under the price axis: below every pane, right of the plot.
  const where = await page.evaluate(() => {
    const c = window.__hostile.chart;
    const plotW = c.timeScale().width();
    const rootEl = document.querySelector('#chart').firstElementChild;
    const l = rootEl.querySelector('[data-chartist-attribution]').getBoundingClientRect();
    const r = rootEl.getBoundingClientRect();
    return { left: l.left - r.left, top: l.top - r.top, plotW, paneH: c.panes()[0].getHeight() };
  });
  check(where.left >= where.plotW && where.top >= where.paneH, 'the attribution link sits clear of the data (axis corner)', where);

  // Wheel: no focus + scrollable page = the page scrolls, the chart does not zoom.
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
  const cbox = await page.locator('#chart').boundingBox();
  const before = await page.evaluate(() => window.__hostile.chart.timeScale().getVisibleLogicalRange());
  await page.mouse.move(cbox.x + cbox.width / 3, cbox.y + cbox.height / 2);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  const afterWheel = await page.evaluate(() => ({ y: window.scrollY, r: window.__hostile.chart.timeScale().getVisibleLogicalRange() }));
  check(afterWheel.y > 0 && Math.abs(afterWheel.r.from - before.from) < 1e-6, 'wheel over an unfocused chart scrolls the page', afterWheel);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  const cbox2 = await page.locator('#chart').boundingBox();
  await page.mouse.click(cbox2.x + cbox2.width / 3, cbox2.y + cbox2.height / 2);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(200);
  const afterFocus = await page.evaluate(() => ({ y: window.scrollY, r: window.__hostile.chart.timeScale().getVisibleLogicalRange() }));
  check(afterFocus.y === 0 && afterFocus.r.to - afterFocus.r.from < before.to - before.from, 'wheel over a focused chart zooms and leaves the page', afterFocus);
  await page.keyboard.down('Control');
  await page.evaluate(() => document.activeElement.blur());
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  const afterCtrl = await page.evaluate(() => window.__hostile.chart.timeScale().getVisibleLogicalRange());
  check(afterCtrl.to - afterCtrl.from > afterFocus.r.to - afterFocus.r.from, 'ctrl + wheel zooms without focus', afterCtrl);

  // A fitContent made while the container was hidden is applied once it has a width.
  const pending = await page.evaluate(async () => {
    const box = document.getElementById('hidden-box');
    box.classList.remove('hidden');
    await new Promise(r => setTimeout(r, 200));
    window.__hostile.hidden.paint();
    return window.__hostile.hidden.timeScale().getVisibleLogicalRange();
  });
  check(pending && pending.from < 1 && pending.to >= 499, 'fitContent before the chart had a width is kept and applied', pending);

  // API behaviour on the hostile page's chart.
  const api = await page.evaluate(() => {
    const L = window.ChartistLite;
    const { chart, series } = window.__hostile;
    const bars = window.__hostile.bars(300);
    const r = {};
    // 5: pane 0 options do not leak into a new pane; a missing pane is an error.
    chart.priceScale().applyOptions({ mode: 'log', autoScale: false });
    try { chart.priceScale('right', 3); r.missingPane = 'no error'; } catch (e) { r.missingPane = e instanceof RangeError ? 'RangeError' : String(e); }
    const lower = chart.addSeries(L.LineSeries, {}, 1);
    lower.setData(bars.map(b => ({ time: b.time, value: b.close })));
    r.pane1 = chart.priceScale('right', 1).options();
    chart.priceScale().applyOptions({ mode: 'linear', autoScale: true });
    // 3: wrong kind of time is refused and leaves the series usable.
    try { lower.setData([{ time: '2026-01-02', value: 1 }]); r.kind = 'no error'; } catch (e) { r.kind = e.message; }
    lower.setData(bars.slice(0, 50).map(b => ({ time: b.time, value: b.close })));
    r.afterKind = lower.data().length;
    // 19: an overlay scale's options travel with a series to another pane.
    const vol = chart.addSeries(L.HistogramSeries, { priceScaleId: 'vol' });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    vol.setData(bars.map(b => ({ time: b.time, value: 1000 })));
    vol.moveToPane(1);
    r.volMargins = vol.priceScale().options().scaleMargins;
    // 18: remove() detaches primitives of hidden series too.
    let detached = 0;
    const hiddenS = chart.addSeries(L.LineSeries, { visible: false });
    hiddenS.attachPrimitive({ detached() { detached++; } });
    series.attachPrimitive({ draw() { series.detachPrimitive(this); }, detached() { detached++; } });
    series.attachPrimitive({ draw() { r.secondDrawn = true; }, detached() { detached++; } });
    chart.paint();
    r.detachedBeforeRemove = detached;
    // 10: minMove alone sets the precision.
    const q = chart.addSeries(L.LineSeries, { priceFormat: { minMove: 0.25 } });
    r.quarter = q.options().priceFormat;
    const w = chart.addSeries(L.LineSeries, { priceFormat: { minMove: 5 } });
    r.five = w.options().priceFormat;
    // 20: touch-action follows the options.
    chart.applyOptions({ interaction: { pinchZoom: false } });
    r.touch = chart.element().style.touchAction;
    chart.applyOptions({ interaction: { pinchZoom: true } });
    // 17: NaN options are ignored.
    chart.applyOptions({ fontSize: NaN, timeScale: { barSpacing: Infinity } });
    r.font = chart.options().fontSize;
    r.spacing = chart.options().timeScale.barSpacing;
    // 12: fewer rows while scrolled back returns to the live edge.
    // (on the one-series chart: the union of times only shrinks when every series has fewer rows)
    const { hidden, hiddenSeries } = window.__hostile;
    hidden.timeScale().setVisibleLogicalRange({ from: 300, to: 340 });
    hidden.paint();
    hiddenSeries.setData(window.__hostile.bars(40).map(b => ({ time: b.time, value: b.close })));
    hidden.paint();
    r.shrink = hidden.timeScale().getVisibleLogicalRange();
    chart.remove();
    r.detachedAfterRemove = detached;
    return r;
  });
  check(api.missingPane === 'RangeError', 'priceScale for a pane that does not exist throws RangeError', api.missingPane);
  check(api.pane1.mode === 'linear' && api.pane1.autoScale === true, 'pane 0 log / autoScale off does not leak into a new pane', api.pane1);
  check(/same kind of time/.test(api.kind) && api.afterKind === 50, 'a wrong kind of time is refused and the series stays usable', [api.kind, api.afterKind]);
  check(api.volMargins.top === 0.8 && api.volMargins.bottom === 0, 'moveToPane keeps the overlay scale settings', api.volMargins);
  check(api.secondDrawn === true, 'a primitive detaching itself in draw does not skip the next one');
  check(api.detachedBeforeRemove === 1 && api.detachedAfterRemove === 3, 'remove() detaches primitives of hidden series too', [api.detachedBeforeRemove, api.detachedAfterRemove]);
  check(api.quarter.precision === 2 && api.quarter.minMove === 0.25 && api.five.precision === 0, 'minMove alone sets the precision', [api.quarter, api.five]);
  check(api.touch === 'pan-y pinch-zoom', 'touch-action follows pinchZoom: false', api.touch);
  check(api.font === 12 && api.spacing === 8, 'NaN / Infinity options are ignored', [api.font, api.spacing]);
  check(api.shrink && api.shrink.to >= 39 && api.shrink.from <= 39, 'fewer rows while scrolled back returns to the live edge', api.shrink);

  // 7: the focus ring inside <chartist-chart> (the document sees only the host as focused).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.getElementById('el').scrollIntoView());
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const inEl = await page.evaluate(() => document.activeElement && document.activeElement.id === 'el');
    if (inEl) break;
  }
  await page.waitForTimeout(150);
  const ring = await page.evaluate(() => {
    const el = document.getElementById('el');
    const canvases = el.shadowRoot.querySelectorAll('canvas');
    const top = canvases[canvases.length - 1];
    const ctx = top.getContext('2d');
    const px = ctx.getImageData(1, Math.floor(top.height / 2), 1, 1).data;
    return { focusedHost: document.activeElement === el, alpha: px[3] };
  });
  check(ring.focusedHost && ring.alpha > 0, 'focus ring drawn inside <chartist-chart>', ring);
  await page.screenshot({ path: path.join(out, 'hostile-element-focus.png') });

  // 11: `.data` set while a slow `src` is loading wins.
  const race = await page.evaluate(async () => {
    const el = document.createElement('chartist-chart');
    el.setAttribute('loading', 'eager');
    el.setAttribute('height', '200');
    el.setAttribute('src', '../data/demo-daily.json?slow=600');
    document.body.appendChild(el);
    await new Promise(r => setTimeout(r, 50));
    el.data = [{ time: '2026-01-02', open: 1, high: 2, low: 0.5, close: 1.5 }, { time: '2026-01-05', open: 1.5, high: 2, low: 1, close: 1.8 }];
    await new Promise(r => setTimeout(r, 1000));
    return { rows: el.data.length, chartRows: el.series ? el.series.data().length : -1 };
  });
  check(race.rows === 2 && race.chartRows === 2, '.data set while src is loading wins', race);
  await ctx.close();

  // 13: markers at 200k bars must not copy the rows on every frame.
  const perfPage = await browser.newPage({ viewport: { width: 1200, height: 600 } });
  watch(perfPage);
  await perfPage.goto(`${base}/examples/basic.html`);
  const mk = await perfPage.evaluate(() => {
    const L = window.ChartistLite;
    const { chart, candles, avg } = window.__demo;
    avg.setData([]);
    const rows = [];
    let c = 100;
    for (let i = 0; i < 200000; i++) { const o = c; c = Math.max(1, c * (1 + Math.sin(i * 0.37) * 0.01)); rows.push({ time: 1500000000 + i * 60, open: o, high: Math.max(o, c) + 0.2, low: Math.min(o, c) - 0.2, close: c }); }
    candles.setData(rows);
    const time = () => {
      const ts = chart.timeScale();
      const f = [];
      for (let k = 0; k < 40; k++) { const t0 = performance.now(); ts.setVisibleLogicalRange({ from: 100000 + k * 30, to: 100300 + k * 30 }); chart.paint(); f.push(performance.now() - t0); }
      f.sort((a, b) => a - b);
      return +f[20].toFixed(2);
    };
    const plain = time();
    const markers = [];
    for (let i = 100000; i < 101500; i += 10) markers.push({ time: rows[i].time, position: 'aboveBar', shape: 'arrowDown' });
    L.createSeriesMarkers(candles, markers);
    const withMarkers = time();
    return { plain, withMarkers };
  });
  check(mk.withMarkers < mk.plain + 1.5, 'markers add little to a pan frame at 200k bars', mk);
  await perfPage.close();

  await browser.close();
  server.close();
  if (errors.length) { console.error('console problems:\n' + errors.join('\n')); failures.push('console errors'); }
  if (failures.length) { console.error(`${failures.length} check(s) failed`); process.exit(1); }
  console.log('all review checks passed; no console errors');
})().catch(e => { console.error(e); process.exit(1); });
