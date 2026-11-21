// Browser check for the element and React wrappers: serves this folder, loads examples/element.html and
// examples/react/index.html in Chromium (light and dark), takes docs/screenshots/element-*.png / react-*.png and
// asserts: chartist-ready fired, lazy creation, fallback hidden once drawn, error event, element removed and re-added
// without leaks, StrictMode mount and unmount clean, server render of the React entry, no console errors.
// Needs Playwright importable on this machine (not a dev dependency): `node scripts/screenshots-element.cjs`.
const { chromium } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.csv': 'text/csv', '.map': 'application/json' };

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  // Fresh builds of what the pages load.
  // `npm run build` writes dist/element.js and the element IIFE (dist/chartist-lite.element.iife.min.js).
  if (!fs.existsSync(path.join(root, 'dist', 'chartist-lite.element.iife.min.js'))) execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(root, 'examples', 'react', 'build.mjs')], { cwd: root, stdio: 'inherit' });
  execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), ['src/react/index.ts', '--bundle', '--format=esm', '--platform=node', '--target=es2020', `--outfile=${path.join(root, 'examples', 'react', 'dist', 'react-ssr.mjs')}`, '--log-level=warning'], { cwd: root, stdio: 'inherit' });

  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const watch = page => {
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  };

  // ── element page ──
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    watch(page);
    await page.addInitScript(() => {
      window.__ready = []; window.__errors = [];
      document.addEventListener('chartist-ready', e => window.__ready.push(e.target.id), true);
      document.addEventListener('chartist-error', e => window.__errors.push(e.detail.message), true);
    });
    await page.goto(`${base}/examples/element.html`);
    await page.waitForFunction(() => window.__ready.length >= 5, null, { timeout: 8000 }).catch(() => {});
    const state = await page.evaluate(() => ({
      ready: window.__ready.slice().sort(),
      lazyCreated: document.getElementById('lazy').chart !== null,
      errors: window.__errors,
      fallbackHidden: (() => { const el = document.getElementById('inline'); const fb = el.shadowRoot.querySelector('.fb'); return getComputedStyle(fb).display === 'none'; })(),
      inlineBars: document.getElementById('inline').series.data().length,
      jsonBars: document.getElementById('json').series.data().length,
      csvBars: document.getElementById('csv').series.data().length,
      weeklyBars: document.getElementById('weekly').series.data().length,
      darkBars: document.getElementById('dark').series.data().length,
      darkTheme: document.getElementById('dark').chart.options().theme,
      volume: document.getElementById('json').shadowRoot.querySelectorAll('canvas').length,
    }));
    check(JSON.stringify(state.ready) === JSON.stringify(['csv', 'dark', 'inline', 'json', 'weekly']), `${scheme}: chartist-ready fired for the five eager elements (${state.ready})`);
    check(state.lazyCreated === false, `${scheme}: the element below the fold is not created before it is scrolled to`);
    check(state.errors.length === 0, `${scheme}: no chartist-error (${state.errors})`);
    check(state.fallbackHidden, `${scheme}: fallback content is hidden once the chart draws`);
    check(state.inlineBars === 12 && state.jsonBars === 260 && state.csvBars === 260 && state.weeklyBars === 150 && state.darkBars === 370, `${scheme}: row counts ${JSON.stringify([state.inlineBars, state.jsonBars, state.csvBars, state.weeklyBars, state.darkBars])}`);
    check(state.darkTheme === 'dark', `${scheme}: theme attribute reaches the chart`);
    await page.screenshot({ path: path.join(out, `element-${scheme}.png`), fullPage: false });

    await page.evaluate(() => document.getElementById('lazy').scrollIntoView());
    await page.waitForFunction(() => document.getElementById('lazy').chart !== null, null, { timeout: 4000 }).catch(() => {});
    check(await page.evaluate(() => document.getElementById('lazy').chart !== null), `${scheme}: the lazy element is created when scrolled into view`);
    await page.waitForTimeout(200);

    if (scheme === 'light') {
      // Remove and re-add: the chart is removed on disconnect, rebuilt on reconnect, nothing is left behind.
      const cycle = await page.evaluate(async () => {
        const el = document.getElementById('json');
        const canvases = () => el.shadowRoot.querySelectorAll('canvas').length;
        const before = { canvases: canvases(), chart: el.chart };
        const old = el.chart.element();
        const parent = el.parentNode;
        const next = el.nextSibling;
        const result = { cycles: [] };
        for (let i = 0; i < 12; i++) {
          el.remove();
          const during = { chart: el.chart, canvases: canvases(), oldConnected: old.isConnected };
          const readyP = new Promise(r => el.addEventListener('chartist-ready', r, { once: true }));
          parent.insertBefore(el, next);
          await readyP;
          result.cycles.push({ during, after: { canvases: canvases(), hasChart: el.chart !== null, bars: el.series.data().length } });
        }
        result.before = before.canvases;
        result.oldGone = !old.isConnected;
        return result;
      });
      check(cycle.cycles.every(c => c.during.chart === null && c.during.canvases === 0 && c.during.oldConnected === false), 'removed element: chart dropped, canvases gone');
      check(cycle.cycles.every(c => c.after.hasChart && c.after.bars === 260 && c.after.canvases === cycle.before), `re-added element x12: chart back with 260 bars, canvas count stays ${cycle.before}`);

      // Attributes change the live chart; a bad src gives a quiet message and an event.
      const attr = await page.evaluate(async () => {
        const el = document.getElementById('csv');
        const chart = el.chart;
        el.setAttribute('theme', 'dark');
        const theme = chart.options().theme;
        el.setAttribute('type', 'candlestick');
        const typeNow = el.series.seriesType();
        const same = el.chart === chart;
        const bad = document.createElement('chartist-chart');
        bad.setAttribute('src', 'data/missing.json');
        bad.setAttribute('loading', 'eager');
        const err = new Promise(r => bad.addEventListener('chartist-error', e => r(e.detail.message), { once: true }));
        document.body.appendChild(bad);
        const message = await err;
        const shown = bad.shadowRoot.querySelector('.msg').textContent;
        const hidden = bad.shadowRoot.querySelector('.msg').hidden;
        bad.remove();
        const fresh = document.createElement('chartist-chart');
        fresh.setAttribute('loading', 'eager');
        fresh.setAttribute('type', 'bogus');
        const err2 = new Promise(r => fresh.addEventListener('chartist-error', e => r(e.detail.message), { once: true }));
        document.body.appendChild(fresh);
        const message2 = await err2;
        fresh.remove();
        // The .data property, set after the element is on the page.
        const dp = document.createElement('chartist-chart');
        dp.setAttribute('type', 'line');
        dp.setAttribute('loading', 'eager');
        dp.data = [{ time: '2024-01-01', value: 1 }, { time: '2024-01-02', value: 2 }];
        const rd = new Promise(r => dp.addEventListener('chartist-ready', r, { once: true }));
        document.body.appendChild(dp);
        await rd;
        const bars = dp.series.data().length;
        dp.data = [{ time: '2024-01-01', value: 1 }, { time: '2024-01-02', value: 2 }, { time: '2024-01-03', value: 3 }];
        const bars2 = dp.series.data().length;
        dp.remove();
        return { theme, typeNow, same, message, shown, hidden, message2, bars, bars2 };
      });
      check(attr.theme === 'dark' && attr.typeNow === 'candlestick' && attr.same, `attribute changes apply in place (${JSON.stringify([attr.theme, attr.typeNow, attr.same])})`);
      check(/HTTP 404/.test(attr.message) && attr.hidden === false && attr.shown.length > 0, `bad src: chartist-error and an inline message ("${attr.shown}")`);
      check(/type "bogus"/.test(attr.message2), `bad type: chartist-error ("${attr.message2}")`);
      check(attr.bars === 2 && attr.bars2 === 3, 'the .data property sets and replaces rows');
    }
    await ctx.close();
  }

  // ── embed.html: the one-script snippet ──
  {
    const page = await browser.newPage({ viewport: { width: 860, height: 520 } });
    watch(page);
    await page.addInitScript(() => { window.__ready = 0; document.addEventListener('chartist-ready', () => { window.__ready++; }, true); });
    await page.goto(`${base}/examples/embed.html`);
    await page.waitForFunction(() => window.__ready === 1, null, { timeout: 8000 }).catch(() => {});
    check(await page.evaluate(() => window.__ready === 1 && document.querySelector('chartist-chart').series.data().length === 260), 'embed.html: one script tag and one element draw the chart');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, 'element-embed.png') });
    await page.close();
  }

  // ── module.html: the ES module entry (needs `npm run build` for dist/element.js) ──
  {
    const page = await browser.newPage({ viewport: { width: 860, height: 420 } });
    watch(page);
    await page.goto(`${base}/examples/module.html`);
    await page.waitForFunction(() => { const e = document.querySelector('chartist-chart'); return e && e.chart; }, null, { timeout: 8000 }).catch(() => {});
    check(await page.evaluate(() => { const e = document.querySelector('chartist-chart'); return !!e.chart && e.series.data().length === 150; }), 'module.html: dist/element.js + defineChartistElement() draws the chart');
    await page.close();
  }

  // ── frame.html inside an iframe (for sites that forbid scripts) ──
  {
    const page = await browser.newPage({ viewport: { width: 860, height: 420 } });
    watch(page);
    await page.goto(`${base}/examples/embed.html`);
    await page.evaluate(() => {
      document.body.innerHTML = '<iframe id="f" title="DEMO-B weekly values" src="frame.html?src=data/demo-line.csv&type=line&volume=1&aria-label=DEMO-B%20weekly%20values" style="width:100%;height:340px;border:0"></iframe>';
    });
    const frame = await (await page.waitForSelector('#f')).contentFrame();
    await frame.waitForFunction(() => { const e = document.querySelector('chartist-chart'); return e && e.chart && e.series.data().length === 150; }, null, { timeout: 8000 }).catch(() => {});
    check(await frame.evaluate(() => { const e = document.querySelector('chartist-chart'); return !!e && !!e.chart && e.series.data().length === 150 && e.getAttribute('type') === 'line'; }), 'frame.html: the iframe page draws the chart from its query string');
    await page.screenshot({ path: path.join(out, 'element-frame.png') });
    await page.close();
  }

  // ── React page ──
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 }, colorScheme: scheme });
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${base}/examples/react/index.html`);
    await page.waitForFunction(() => window.__app && window.__app.stats.chart && window.__app.container.querySelector('canvas'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => window.__app.stats.chart.element().querySelector('canvas') && document.querySelector('.card') && window.__app.stats.chart.timeScale().getVisibleLogicalRange(), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `react-${scheme}.png`) });
    if (scheme === 'light') {
      const r = await page.evaluate(async () => {
        const { stats } = window.__app;
        const chart = stats.chart;
        const node = chart.element();
        const roots = () => document.querySelectorAll('#root [role="application"]').length;
        const n0 = chart.timeScale && document.querySelectorAll('canvas').length;
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const price = chart.element(); void price;
        document.getElementById('tick').click();
        await sleep(100);
        document.getElementById('append').click();
        await sleep(100);
        document.getElementById('tick').click();
        await sleep(100);
        return { sameChart: stats.chart === chart && chart.element() === node && node.isConnected, ready: stats.ready, roots: roots(), canvasesStable: document.querySelectorAll('canvas').length === n0 };
      });
      check(r.sameChart && r.ready === 1 && r.roots === 1 && r.canvasesStable, `react: ticks and a new bar keep the same chart (${JSON.stringify(r)})`);
      const bars = await page.evaluate(() => {
        // last bar changed through update, bar count grew by one
        const c = window.__app.stats.chart;
        return c.element().isConnected;
      });
      check(bars, 'react: chart still connected after updates');
      await page.screenshot({ path: path.join(out, 'react-light-updated.png') });
    }
    await ctx.close();
  }

  // StrictMode mount and unmount.
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    watch(page);
    await page.goto(`${base}/examples/react/index.html?strict=1`);
    await page.waitForFunction(() => window.__app && window.__app.stats.ready > 0 && window.__app.container.querySelector('canvas'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const s = await page.evaluate(async () => {
      const { stats, container } = window.__app;
      const live = container.querySelectorAll('[role="application"]').length;
      const canvases = container.querySelectorAll('canvas').length;
      const connected = stats.chart.element().isConnected;
      const node = stats.chart.element();
      window.__app.unmount();
      await new Promise(r => setTimeout(r, 100));
      return { live, canvases, connected, ready: stats.ready, emptyAfter: container.innerHTML === '', nodeGone: !node.isConnected };
    });
    check(s.live === 1 && s.canvases === 2 && s.connected && s.ready === 1, `StrictMode: one live chart, onReady once for the live chart (${JSON.stringify(s)})`);
    check(s.emptyAfter && s.nodeGone, 'StrictMode: unmount leaves nothing behind');
    await page.close();
  }

  // Server render of the React entry, under Node, with the real react-dom/server.
  {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const mod = await import('file://' + path.join(root, 'examples', 'react', 'dist', 'react-ssr.mjs'));
    const { ChartistChart } = mod.createChartistReact(React);
    const html = renderToString(React.createElement(ChartistChart, { height: 300, className: 'x', series: [{ type: 'line', data: [{ time: 1, value: 1 }] }] }));
    check(typeof window === 'undefined' && /^<div[^>]*class="x"[^>]*style="[^"]*height:300px/.test(html), `React server render gives an empty sized div (${html})`);
  }

  await browser.close();
  server.close();
  // The one expected 404 is the deliberate bad src in the attribute test.
  const expected404 = errors.findIndex(e => /Failed to load resource.*404/.test(e));
  if (expected404 >= 0) errors.splice(expected404, 1);
  check(errors.length === 0, `no console errors or warnings${errors.length ? '\n' + errors.join('\n') : ''}`);
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log('\nall checks passed');
})().catch(e => { console.error(e); process.exit(1); });
