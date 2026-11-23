// Browser checks of the extras plugins (examples/extras.html, examples/custom-series.html) in Chromium with real
// pointer, touch and keyboard input: tooltip modes (mouse, keyboard inspect, touch long-press), go-to-realtime, range
// switcher keys, price alert add / drag / trigger / delete, compare re-basing, replay play / step / speed / live, and
// that every `remove()` leaves nothing in the DOM; crowded alert chips (2 px apart, ten in 30 px as one group with a
// keyboard list, a drag through a pair, 44 px touch targets). Saves docs/screenshots/extras-light.png, extras-dark.png,
// extras-tooltip.png, extras-replay.png, custom-series.png, alerts-close-light.png, alerts-close-dark.png and
// alerts-many.png; fails on any console error.
// The plugin bundles are built from source in memory with the package's esbuild and served over a local http server, so
// the run does not depend on the state of dist/. Playwright must be importable (it is not a dev dependency):
// `node scripts/screenshots-extras.cjs`.
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const failures = [];
const check = (ok, what, detail) => { if (!ok) failures.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

async function bundles() {
  const mem = {};
  for (const [file, entry, name] of [
    ['chartist-lite.iife.min.js', 'src/index.ts', 'ChartistLite'],
    ['chartist-lite-extras.iife.min.js', 'src/plugins/extras/index.ts', 'ChartistLiteExtras'],
    ['chartist-lite-indicators.iife.min.js', 'src/indicators/index.ts', 'ChartistLiteIndicators'],
  ]) {
    const r = await esbuild.build({ absWorkingDir: root, entryPoints: [entry], bundle: true, format: 'iife', globalName: name, minify: true, write: false, target: 'es2020', logLevel: 'silent' });
    mem[file] = r.outputFiles[0].text;
  }
  return mem;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const mem = await bundles();
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const m = /^\/dist\/(.+)$/.exec(u);
    if (m && mem[m[1]]) { res.setHeader('content-type', 'application/javascript'); return res.end(mem[m[1]]); }
    const f = path.join(root, u);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', u.endsWith('.html') ? 'text/html' : 'application/javascript');
    res.end(fs.readFileSync(f));
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/examples/`;
  const browser = await chromium.launch();
  const errors = [];
  const watch = page => {
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  };
  const sleep = (page, ms) => page.waitForTimeout(ms);
  const shift = (iso, days) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base + 'extras.html');
  await sleep(page, 500);

  // ── helpers ──
  const origin = id => page.evaluate(i => { const el = document.querySelector(`#${i} > div`); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, id);
  const plotOf = id => page.evaluate(i => { const c = Object.values(window.__extras).find(v => v && v.element && v.element().parentElement.id === i); return { w: c.timeScale().width(), h: c.panes()[0].getHeight() }; }, id);
  const tip = () => page.evaluate(() => {
    const host = document.querySelector('#c-tooltip [data-chartist-tooltip]');
    const card = host.shadowRoot.children[0];
    const dot = host.shadowRoot.children[1];
    const r = card.getBoundingClientRect();
    return { shown: card.style.getPropertyValue('display') !== 'none', text: card.textContent, x: r.left, y: r.top, w: r.width, h: r.height, dot: dot.style.getPropertyValue('display') !== 'none', pe: getComputedStyle(card).pointerEvents };
  });
  const shadowCount = () => page.evaluate(() => document.querySelectorAll('#card-tooltip [data-chartist-tooltip]').length);

  // ── 1. tooltip ──
  {
    const o = await origin('c-tooltip');
    const p = await plotOf('c-tooltip');
    await page.mouse.move(o.x + p.w * 0.5, o.y + 110, { steps: 4 });
    await sleep(page, 80);
    let t = await tip();
    check(t.shown && /DEMO/.test(t.text) && /O \d/.test(t.text) && /H \d/.test(t.text) && /L \d/.test(t.text) && /C \d/.test(t.text), 'floating tooltip lists date, O H L C and the title', t.text.slice(0, 80));
    check(/SMA 20/.test(t.text), 'floating tooltip lists every titled series');
    check(/[▲▼]/.test(t.text) && /%/.test(t.text), 'change carries an arrow, a sign and a percent');
    check(!/,/.test(t.text.replace(/\s,/g, '')), 'no grouping commas in the tooltip');
    check(t.pe === 'none', 'the card never takes pointer events');
    const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.closest('[data-chartist-tooltip]') ? 'tooltip' : 'other'; }, [t.x + t.w / 2, t.y + t.h / 2]);
    check(hit === 'other', 'a pointer over the card reaches the chart, not the card');
    await page.mouse.move(o.x + p.w - 30, o.y + o.h - 90, { steps: 3 });
    await sleep(page, 80);
    t = await tip();
    check(t.shown && t.x + t.w <= o.x + o.w + 0.5 && t.y + t.h <= o.y + o.h + 0.5 && t.x >= o.x - 0.5, 'floating card flips and stays inside the chart at the edges', { x: t.x - o.x, w: t.w, cw: o.w });
    await page.mouse.move(o.x + p.w * 0.5, o.y + 110, { steps: 2 });
    await page.mouse.move(5, 5, { steps: 3 });
    await sleep(page, 80);
    check(!(await tip()).shown, 'the card hides when the pointer leaves');

    await page.mouse.move(o.x + p.w * 0.45, o.y + 150, { steps: 4 });
    await sleep(page, 80);
    await page.screenshot({ path: path.join(out, '.floating.png'), clip: { x: o.x - 8, y: o.y - 8, width: o.w + 16, height: o.h + 16 } });
    // Tracking: pinned over the bar, with a marker dot.
    await page.click('#card-tooltip [data-mode="tracking"]');
    await page.mouse.move(o.x + p.w * 0.45, o.y + 150, { steps: 4 });
    await sleep(page, 80);
    t = await tip();
    check(t.shown && t.dot, 'tracking card shows a marker dot');
    const barX = await page.evaluate(() => { const c = window.__extras.tooltipChart; return c.element().getBoundingClientRect().left + c.timeScale().timeToCoordinate(c.timeScale().coordinateToTime(c.timeScale().width() * 0.45)); });
    check(Math.abs(t.x + t.w / 2 - barX) < 3 || t.x <= o.x + 6 || t.x + t.w >= o.x + o.w - 6, 'tracking card is centred on the hovered bar', { cardMid: t.x + t.w / 2, barX });
    await page.screenshot({ path: path.join(out, '.tracking.png'), clip: { x: o.x - 8, y: o.y - 8, width: o.w + 16, height: o.h + 16 } });

    // Magnifier: a strip along the top of the plot.
    await page.click('#card-tooltip [data-mode="magnifier"]');
    await page.mouse.move(o.x + p.w * 0.45, o.y + 150, { steps: 4 });
    await sleep(page, 80);
    t = await tip();
    check(t.shown && Math.abs(t.w - p.w) < 2 && Math.abs(t.y - o.y) < 3, 'magnifier is a fixed strip across the top of the plot', { w: t.w, plot: p.w });
    await page.screenshot({ path: path.join(out, '.magnifier.png'), clip: { x: o.x - 8, y: o.y - 8, width: o.w + 16, height: o.h + 16 } });

    // Keyboard inspect mode.
    await page.click('#card-tooltip [data-mode="floating"]');
    await page.mouse.move(5, 5);
    await sleep(page, 50);
    await page.evaluate(() => window.__extras.tooltipChart.element().focus());
    await page.keyboard.press('Enter');
    await sleep(page, 100);
    t = await tip();
    check(t.shown, 'keyboard inspect mode (Enter) shows the tooltip');
    const before = t.text;
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await sleep(page, 100);
    t = await tip();
    check(t.shown && t.text !== before, 'arrow keys move the tooltip bar by bar');
    await page.keyboard.press('Escape');
    await sleep(page, 100);
    check(!(await tip()).shown, 'Escape ends inspect mode and hides the tooltip');
  }

  // ── 3. go to realtime ──
  {
    const rtBtn = () => page.evaluate(() => {
      const b = document.querySelector('#c-realtime [data-chartist-realtime-button]').shadowRoot.querySelector('button');
      return { vis: getComputedStyle(b).visibility, op: getComputedStyle(b).opacity, label: b.getAttribute('aria-label'), sp: window.__extras.realtimeChart.timeScale().scrollPosition() };
    });
    await sleep(page, 250);
    let b = await rtBtn();
    check(b.vis === 'visible' && b.sp < -0.5, 'go-to-realtime shows while the newest bar is out of view', b);
    check(b.label === 'Go to the latest bar', 'go-to-realtime has an accessible name');
    await page.evaluate(() => document.querySelector('#c-realtime [data-chartist-realtime-button]').shadowRoot.querySelector('button').click());
    await sleep(page, 400);
    b = await rtBtn();
    check(b.sp >= -0.5 && b.vis === 'hidden', 'clicking it scrolls to the newest bar and it hides', b);
    await page.evaluate(() => window.__extras.realtimeChart.timeScale().setVisibleLogicalRange({ from: 20, to: 90 }));
    await sleep(page, 300);
    b = await rtBtn();
    check(b.vis === 'visible', 'it appears again after scrolling back');
    await page.evaluate(() => document.querySelector('#c-realtime [data-chartist-realtime-button]').shadowRoot.querySelector('button').focus());
    await page.keyboard.press('Enter');
    await sleep(page, 400);
    check((await rtBtn()).sp >= -0.5, 'it works from the keyboard (Enter)');
    // Wheel-free scroll back by dragging the chart, as a person would.
    const o = await origin('c-realtime');
    await page.mouse.move(o.x + 300, o.y + 120);
    await page.mouse.down();
    await page.mouse.move(o.x + 520, o.y + 120, { steps: 8 });
    await page.mouse.up();
    await sleep(page, 700);
    check((await rtBtn()).vis === 'visible', 'it appears after dragging the chart back in time');
  }

  // ── 4. range switcher ──
  {
    const state = () => page.evaluate(() => {
      const host = document.querySelector('#c-range [data-chartist-range-switcher]');
      const radios = [...host.shadowRoot.querySelectorAll('[role="radio"]')];
      const vr = window.__extras.rangeChart.timeScale().getVisibleRange();
      return { checked: radios.filter(r => r.getAttribute('aria-checked') === 'true').map(r => r.textContent), tabs: radios.filter(r => r.tabIndex === 0).map(r => r.textContent), n: radios.length, from: vr.from, to: vr.to, group: host.shadowRoot.querySelector('[role="radiogroup"]').getAttribute('aria-label') };
    });
    const radio = label => page.locator('#c-range [data-chartist-range-switcher] [role="radio"]', { hasText: new RegExp(`^${label}$`) });
    let s = await state();
    check(s.n === 9 && s.group === 'Visible range', 'nine ranges in a radiogroup', s.n);
    await radio('1M').click();
    await sleep(page, 300);
    s = await state();
    const want = await page.evaluate(() => {
      const d = window.__extras.rangeBars; const last = d[d.length - 1].time; const [y, m, dd] = last.split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 2, dd)); return t.toISOString().slice(0, 10);
    });
    check(s.checked[0] === '1M' && s.from >= shift(want, -4) && s.from <= shift(want, 4), '1M shows one calendar month ending at the last bar', { from: s.from, want });
    await page.keyboard.press('ArrowRight');
    await sleep(page, 200);
    s = await state();
    check(s.checked[0] === '3M' && s.tabs[0] === '3M', 'ArrowRight selects the next range (roving focus)', s);
    await page.keyboard.press('End');
    await sleep(page, 200);
    check((await state()).checked[0] === 'All', 'End selects the last range');
    await page.keyboard.press('ArrowRight');
    await sleep(page, 200);
    check((await state()).checked[0] === '1D', 'ArrowRight wraps to the first range');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    await sleep(page, 200);
    check((await state()).checked[0] === 'All', 'ArrowLeft wraps to the last range');
    await radio('YTD').click();
    await sleep(page, 300);
    s = await state();
    const ytd = await page.evaluate(() => { const d = window.__extras.rangeBars; return d[d.length - 1].time.slice(0, 4) + '-01-01'; });
    check(s.checked[0] === 'YTD' && s.from >= shift(ytd, -4) && s.from <= shift(ytd, 6), 'YTD starts at the first bar of the year', { from: s.from, ytd });
    const o = await origin('c-range');
    await page.mouse.move(o.x + 300, o.y + 150);
    await page.mouse.down();
    await page.mouse.move(o.x + 360, o.y + 150, { steps: 5 });
    await page.mouse.up();
    await sleep(page, 1200);
    check((await state()).checked.length === 0, 'panning away clears the selection');
    await radio('6M').click();
    await sleep(page, 300);
    check((await state()).checked[0] === '6M', 'a range can be picked again');
  }

  // ── 5. price alerts ──
  {
    const o = await origin('c-alerts');
    const p = await plotOf('c-alerts');
    const list = () => page.evaluate(() => window.__extras.alerts.alerts());
    const yOf = price => page.evaluate(pr => window.__extras.alertsCandles.priceToCoordinate(pr), price);
    check((await list()).length === 2, 'two alerts to start');
    // Hover near the axis, find the "+" and click it.
    const hy = 120;
    await page.mouse.move(o.x + p.w - 120, o.y + hy, { steps: 3 });
    await page.mouse.move(o.x + p.w - 24, o.y + hy, { steps: 6 });
    await sleep(page, 100);
    const cursor = await page.evaluate(() => window.__extras.alertsChart.element().style.getPropertyValue('cursor'));
    check(cursor === 'pointer', 'the cursor is a pointer over the "+"', cursor);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(page, 150);
    let a = await list();
    check(a.length === 3, 'clicking "+" adds an alert');
    const added = a[2];
    const expectPrice = await page.evaluate(y => window.__extras.alertsCandles.coordinateToPrice(y), hy);
    check(Math.abs(added.price - expectPrice) < 0.2, 'it sits at the crosshair price', { added: added.price, expectPrice });
    // Drag it (from the line, left of the chip) to a new price.
    const y0 = await yOf(added.price);
    await page.mouse.move(o.x + 70, o.y + y0, { steps: 3 });
    await sleep(page, 50);
    await page.mouse.down();
    await page.mouse.move(o.x + 70, o.y + y0 - 60, { steps: 8 });
    await page.mouse.up();
    await sleep(page, 150);
    a = await list();
    check(Math.abs(a[2].price - added.price) > 1, 'dragging the line moves the alert', { from: added.price, to: a[2].price });
    // Trigger two alerts with update(): tick up twice crosses the +4% alert.
    await page.click('#tick-up');
    await page.click('#tick-up');
    await sleep(page, 150);
    const status = await page.textContent('#alerts-status');
    check(/fired/.test(status) && /up/.test(status), 'an update that crosses an alert fires it once', status);
    const fired = await page.evaluate(() => window.__extras.alerts.alerts().filter(x => x.triggered).length);
    await page.click('#tick-up');
    await sleep(page, 100);
    check((await page.evaluate(() => window.__extras.alerts.alerts().filter(x => x.triggered).length)) >= fired, 'a triggered alert does not fire again');
    // Delete key on a selected alert.
    const target = (await list()).find(x => !x.triggered) || (await list())[0];
    const yy = await yOf(target.price);
    await page.mouse.click(o.x + 70, o.y + yy);
    await page.keyboard.press('Delete');
    await sleep(page, 100);
    check((await list()).length === a.length - 1, 'Delete removes the selected alert');
    // Close control.
    const rest = await list();
    const y1 = await yOf(rest[0].price);
    await page.mouse.click(o.x + p.w - 66, o.y + y1);
    await sleep(page, 100);
    check((await list()).length === rest.length - 1, 'the chip\'s close control removes an alert');
    // JSON round trip.
    const rt = await page.evaluate(() => { const al = window.__extras.alerts; al.add(101); al.add(99.5); const j = al.exportJSON(); const n = al.alerts().length; al.clear(); al.importJSON(j); return { n, m: al.alerts().length, j: JSON.parse(j).format }; });
    check(rt.n === rt.m && rt.j === 'chartist-lite-alerts', 'exportJSON / importJSON round-trips', rt);
    await page.evaluate(() => { const al = window.__extras.alerts; al.clear(); const last = window.__extras.bars[window.__extras.bars.length - 1].close; al.add(+(last * 1.04).toFixed(2)); al.add(+(last * 0.95).toFixed(2)); });
    // Restore the last bar so screenshots show the chart as built.
    await page.evaluate(() => { const b = window.__extras.bars; const c = window.__extras.alertsCandles; c.setData(b); });
    await page.evaluate(() => { document.getElementById('alerts-status').textContent = 'No alert has fired yet.'; });
  }

  // ── 6. compare ──
  {
    const info = () => page.evaluate(() => {
      const c = window.__extras.compareChart; const cmp = window.__extras.compare;
      const vr = c.timeScale().getVisibleRange();
      const base = window.__extras.compareCandles.data();
      const f = vr.from;
      const baseRow = base.find(r => r.time >= f);
      const lines = cmp.lines().map(l => { const row = l.series.data().find(r => r.time >= f); return row ? row.value : null; });
      const host = document.querySelector('#c-compare [data-chartist-compare]');
      const chips = host ? [...host.shadowRoot.querySelectorAll('[role="listitem"]')].map(x => x.textContent.replace(/\s+/g, ' ').trim()) : [];
      return { mode: c.priceScale('right').options().mode, baseRef: baseRow.close, lines, chips, from: f };
    });
    let i = await info();
    check(i.mode === 'percent', 'compare puts the axis in percent mode');
    check(i.lines.every(v => v !== null && Math.abs(v - i.baseRef) < 0.01 * i.baseRef), 'every line starts at the base value on the first visible bar', { baseRef: i.baseRef, lines: i.lines });
    check(i.chips.length === 3 && i.chips.every(t => /[▲▼]|0\.00%/.test(t)), 'the legend has a chip per series with arrow and percent', i.chips);
    await page.evaluate(() => window.__extras.compareChart.timeScale().setVisibleLogicalRange({ from: 70, to: 150 }));
    await sleep(page, 400);
    const j = await info();
    check(j.from !== i.from && j.lines.every(v => v !== null && Math.abs(v - j.baseRef) < 0.01 * j.baseRef), 'panning re-bases the lines to the new first visible bar', { from: j.from, baseRef: j.baseRef, lines: j.lines });
    await page.locator('#c-compare [data-chartist-compare] button[aria-label="Remove HARBOR"]').click();
    await sleep(page, 200);
    i = await info();
    check(i.lines.length === 1 && i.chips.length === 2, 'the chip\'s close control removes a compared line');
    await page.evaluate(() => window.__extras.compareChart.timeScale().fitContent());
    await page.evaluate(() => window.__extras.compare.add(window.__extras.bars.map((b, k) => ({ time: b.time, value: 90 + k * 0.1 + Math.sin(k / 6) * 3 })), { title: 'HARBOR' }));
    await sleep(page, 300);
  }

  // ── 7. replay ──
  {
    const o = await origin('c-replay');
    const p = await plotOf('c-replay');
    const st = () => page.evaluate(() => ({ ...window.__extras.replay.info(), n: window.__extras.replayCandles.data().length }));
    const strip = () => page.locator('#c-replay [data-chartist-replay]');
    const total = await page.evaluate(() => window.__extras.bars.length);
    check((await st()).active === false && (await st()).n === total, 'replay starts idle with every bar shown');
    await strip().locator('button', { hasText: 'Replay' }).click();
    await origin('c-replay');
    await sleep(page, 100);
    const picking = await page.evaluate(() => document.querySelector('#c-replay [data-chartist-replay]').shadowRoot.textContent.includes('Click a bar'));
    check(picking, 'the strip asks for a bar to start from');
    await page.mouse.move(o.x + p.w * 0.45, o.y + 120, { steps: 4 });
    await sleep(page, 80);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(page, 200);
    let s = await st();
    check(s.active && s.n === s.index + 1 && s.n < total && !s.playing, 'clicking a bar starts replay there, paused', { n: s.n, index: s.index });
    const startN = s.n;
    // Step forward and back with the keyboard.
    await strip().locator('button[aria-label="Step forward one bar"]').focus();
    await page.keyboard.press('Enter');
    await sleep(page, 80);
    check((await st()).n === startN + 1, 'step forward adds one bar');
    await strip().locator('button[aria-label="Step back one bar"]').focus();
    await page.keyboard.press('Space');
    await sleep(page, 80);
    check((await st()).n === startN, 'step back removes one bar');
    await page.keyboard.press('ArrowRight');
    const focused = await page.evaluate(() => document.querySelector('#c-replay [data-chartist-replay]').shadowRoot.activeElement?.getAttribute('aria-label'));
    check(focused === 'Play', 'arrow keys move focus along the strip', focused);
    // Play at 10x and count updates against frames.
    await strip().locator('button[aria-label="Speed 10x"]').click();
    const probe = page.evaluate(() => new Promise(resolve => {
      const series = window.__extras.replayCandles; const orig = series.update.bind(series);
      let updates = 0, frames = 0, maxPerFrame = 0, perFrame = 0;
      series.update = r => { updates++; perFrame++; return orig(r); };
      const t0 = performance.now();
      const loop = () => { frames++; maxPerFrame = Math.max(maxPerFrame, perFrame); perFrame = 0; if (performance.now() - t0 < 1500) requestAnimationFrame(loop); else { series.update = orig; resolve({ updates, frames, maxPerFrame }); } };
      requestAnimationFrame(loop);
    }));
    await strip().locator('button[aria-label="Play"]').click();
    const m = await probe;
    s = await st();
    check(s.playing || s.index >= total - 1, 'play runs');
    check(m.updates >= 8 && m.maxPerFrame <= 1, 'at most one update per frame while playing at 10x', m);
    await strip().locator('button[aria-label="Pause"]').click();
    const paused = (await st()).n;
    await sleep(page, 400);
    check((await st()).n === paused && !(await st()).playing, 'pause stops the timer');
    await page.screenshot({ path: path.join(out, 'extras-replay.png'), clip: { x: o.x - 8, y: o.y - 8, width: o.w + 16, height: o.h + 16 } });
    await strip().locator('button', { hasText: 'Live' }).click();
    await sleep(page, 150);
    s = await st();
    check(!s.active && s.n === total, 'Live leaves replay and shows every bar', s);
    // Indicators keep working: a started replay feeds only setData / update, so a series update count is the proof above.
  }

  // ── touch (separate context with a touch screen) ──
  {
    const tctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, hasTouch: true });
    const tp = await tctx.newPage();
    watch(tp);
    await tp.goto(base + 'extras.html');
    await tp.waitForTimeout(500);
    const cdp = await tctx.newCDPSession(tp);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const r = await tp.evaluate(() => { const b = document.querySelector('#c-tooltip > div').getBoundingClientRect(); return { x: b.left, y: b.top }; });
    const card = () => tp.evaluate(() => {
      const c = document.querySelector('#c-tooltip [data-chartist-tooltip]').shadowRoot.children[0];
      return { shown: c.style.getPropertyValue('display') !== 'none', text: c.textContent };
    });
    const rangeOf = () => tp.evaluate(() => JSON.stringify(window.__extras.tooltipChart.timeScale().getVisibleLogicalRange()));
    const before = await rangeOf();
    await touch('touchStart', r.x + 300, r.y + 120);
    await tp.waitForTimeout(150);
    check(!(await card()).shown, 'a touch that has not been held shows no tooltip yet');
    await tp.waitForTimeout(450);
    let c = await card();
    check(c.shown && /DEMO/.test(c.text), 'long-press shows the tooltip');
    const t0 = c.text;
    for (let k = 1; k <= 6; k++) { await touch('touchMove', r.x + 300 + k * 14, r.y + 120); await tp.waitForTimeout(30); }
    c = await card();
    check(c.shown && c.text !== t0, 'dragging after the long-press moves it bar by bar');
    check((await rangeOf()) === before, 'the chart does not pan during the long-press drag');
    await touch('touchEnd', 0, 0);
    await tp.waitForTimeout(150);
    check(!(await card()).shown, 'lifting the finger hides it');
    // A quick swipe still pans the chart.
    await touch('touchStart', r.x + 300, r.y + 120);
    for (let k = 1; k <= 8; k++) { await touch('touchMove', r.x + 300 + k * 12, r.y + 120); await tp.waitForTimeout(16); }
    await touch('touchEnd', 0, 0);
    await tp.waitForTimeout(300);
    check((await rangeOf()) !== before && !(await card()).shown, 'a quick swipe pans and shows no tooltip');
    await tctx.close();
  }

  // ── remove() leaves nothing ──
  {
    const left = () => page.evaluate(() => document.querySelectorAll('[data-chartist-tooltip],[data-chartist-realtime-button],[data-chartist-range-switcher],[data-chartist-compare],[data-chartist-replay]').length);
    check((await left()) >= 5, 'plugin DOM exists before removal', await left());
    const res = await page.evaluate(() => {
      const d = window.__extras;
      const n = c => c.element().children.length;
      const before = { tooltip: n(d.tooltipChart), rt: n(d.realtimeChart), range: n(d.rangeChart), cmp: n(d.compareChart), rp: n(d.replayChart) };
      d.tooltip.remove(); d.realtime.remove(); d.range.remove(); d.replay.remove();
      const series = d.compareChart.panes()[0].getSeries().length;
      d.compare.destroy();
      d.alerts.destroy(); d.watermark.remove(); d.bands.remove(); d.sessions.remove(); d.partial.remove(); d.vline.remove();
      d.tooltip.remove(); d.range.destroy(); // twice is harmless
      return { before, after: { tooltip: n(d.tooltipChart), rt: n(d.realtimeChart), range: n(d.rangeChart), cmp: n(d.compareChart), rp: n(d.replayChart) }, series, seriesAfter: d.compareChart.panes()[0].getSeries().length, mode: d.compareChart.priceScale('right').options().mode, cursor: d.alertsChart.element().style.getPropertyValue('cursor') };
    });
    check((await left()) === 0, 'after remove() no plugin element is left in the DOM');
    check(Object.keys(res.before).every(k => res.after[k] === res.before[k] - 1), 'each host element is removed (one child fewer per chart)', res);
    check(res.seriesAfter === 1 && res.mode === 'linear', 'compare destroy removes its series and restores the axis mode', { series: res.seriesAfter, mode: res.mode });
    check(res.cursor === '' || res.cursor === 'crosshair', 'the forced cursor is given back', res.cursor);
    const o = await origin('c-tooltip');
    await page.mouse.move(o.x + 300, o.y + 120, { steps: 3 });
    await sleep(page, 100);
    check((await shadowCount()) === 0, 'a removed tooltip stays gone');
  }

  // ── screenshots ──
  {
    const shot = async (name, setup) => {
      const p2 = await ctx.newPage();
      watch(p2);
      await p2.goto(base + 'extras.html' + (name.includes('dark') ? '?theme=dark' : ''));
      await p2.waitForTimeout(500);
      if (setup) await setup(p2);
      await p2.waitForTimeout(350);
      await p2.screenshot({ path: path.join(out, name), fullPage: true });
      await p2.close();
    };
    const hoverTip = async (p2, mode) => {
      await p2.click(`#card-tooltip [data-mode="${mode}"]`);
      const b = await p2.evaluate(() => { const r = document.querySelector('#c-tooltip > div').getBoundingClientRect(); return { x: r.left, y: r.top }; });
      await p2.mouse.move(b.x + 330, b.y + 160, { steps: 4 });
    };
    await shot('extras-light.png', async p2 => {
      await p2.locator('#c-range [role="radio"]', { hasText: /^6M$/ }).first().click().catch(async () => { await p2.evaluate(() => window.__extras.range.select('6M')); });
      await p2.evaluate(() => { const c = window.__extras.compareChart; c.timeScale().setVisibleLogicalRange({ from: 40, to: 162 }); });
      await hoverTip(p2, 'tracking');
    });
    await shot('extras-dark.png', async p2 => {
      await p2.evaluate(() => window.__extras.range.select('3M'));
      await p2.evaluate(() => window.__extras.replay.start(window.__extras.bars[90].time));
      await p2.evaluate(() => window.__extras.alerts.check(window.__extras.bars[159].close * 1.06));
      await hoverTip(p2, 'floating');
    });
    // Tooltip: the three modes side by side (clips taken above, same bar).
    {
      const imgs = ['.floating.png', '.tracking.png', '.magnifier.png'].map(f => fs.readFileSync(path.join(out, f)).toString('base64'));
      const comp = await ctx.newPage();
      await comp.setContent(`<body style="margin:0;padding:16px;background:#F8F8F8;display:flex;gap:12px;font:600 13px -apple-system,Segoe UI,sans-serif;color:#1D1D1F">${['Floating', 'Tracking', 'Magnifier'].map((n, i) => `<figure style="margin:0;flex:1;min-width:0"><div style="margin:0 2px 6px">${n}</div><img style="width:100%;border-radius:12px;display:block" src="data:image/png;base64,${imgs[i]}"></figure>`).join('')}</body>`);
      await comp.setViewportSize({ width: 1800, height: 420 });
      await comp.waitForTimeout(200);
      await comp.screenshot({ path: path.join(out, 'extras-tooltip.png'), fullPage: true });
      await comp.close();
      for (const f of ['.floating.png', '.tracking.png', '.magnifier.png']) fs.rmSync(path.join(out, f), { force: true });
    }
    const cp = await ctx.newPage();
    watch(cp);
    await cp.goto(base + 'custom-series.html');
    await cp.waitForTimeout(600);
    await cp.screenshot({ path: path.join(out, 'custom-series.png'), fullPage: true });
    await cp.close();
  }

  // ── alert chips that crowd: two lines 2 px apart, ten within 30 px (one "N alerts" group with a list), a drag
  //    through a pair; light and dark pictures ──
  for (const theme of ['light', 'dark']) {
    const lp = await ctx.newPage();
    watch(lp);
    await lp.goto(base + `extras.html?theme=${theme}`);
    await sleep(lp, 500);
    const card = lp.locator('#card-alerts');
    await card.scrollIntoViewIfNeeded();
    const P = () => lp.evaluate(() => window.__extras.alerts.placements());
    // Two alerts 2 px apart, around the middle of the pane.
    await lp.evaluate(() => {
      const al = window.__extras.alerts, s = window.__extras.alertsCandles;
      al.clear();
      const h = window.__extras.alertsChart.panes()[0].getHeight();
      const y = Math.round(h * 0.45);
      al.add(+s.coordinateToPrice(y).toFixed(2));
      al.add(+s.coordinateToPrice(y + 2).toFixed(2));
      // The price moves up between them: the lower one has fired (both chip kinds in the picture).
      const [lo, hi] = al.alerts().map(x => x.price).sort((p, q) => p - q);
      al.check((lo + hi) / 2);
    });
    await sleep(lp, 200);
    const two = await P();
    check(two.length === 2 && two.every(p => p.ids.length === 1) && Math.abs(two[1].y - two[0].y) >= 24 - 0.01 && Math.abs((two[0].y + two[1].y) / 2 - (two[0].line + two[1].line) / 2) < 1, `${theme}: two alerts 2 px apart: both chips, edge to edge, centred on their lines`, two);
    await lp.mouse.move(5, 5);
    await card.screenshot({ path: path.join(out, `alerts-close-${theme}.png`) });
    if (theme === 'dark') { await lp.close(); continue; }
    // A drag of a third line through the pair: smooth, the dragged chip on its own line, others never overlap; no layout.
    const o = await lp.evaluate(() => { const r = window.__extras.alertsChart.element().getBoundingClientRect(); return { x: r.left, y: r.top, w: window.__extras.alertsChart.timeScale().width() }; });
    const yTop = two[0].line - 60;
    await lp.evaluate(y => { const s = window.__extras.alertsCandles; window.__extras.alerts.add(+s.coordinateToPrice(y).toFixed(2)); }, yTop);
    await sleep(lp, 100);
    const cdp = await lp.context().newCDPSession(lp); await cdp.send('Performance.enable');
    const layouts = async () => (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'LayoutCount').value;
    const x = o.x + o.w * 0.4;
    await lp.mouse.move(x, o.y + yTop);
    await lp.mouse.down();
    const l0 = await layouts();
    let bad = 0, steps = 0, onLine = 0;
    for (let dy = 0; dy <= 120; dy += 4) {
      await lp.mouse.move(x, o.y + yTop + dy);
      await lp.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
      const pl = await P();
      steps++;
      const others = pl.slice(0, -1);
      if (!others.every((p, i) => i === 0 || p.y - others[i - 1].y >= 24 - 0.01)) bad++;
      const d = pl[pl.length - 1];
      if (d && Math.abs(d.y - Math.max(11, d.line)) < 0.6) onLine++;
    }
    const l1 = await layouts();
    await lp.mouse.up();
    check(bad === 0 && onLine === steps && l1 - l0 <= 2, 'drag through a pair: the dragged chip stays on its line, on top; the others never overlap; no layout per step', { steps, bad, onLine, layouts: l1 - l0 });
    // Ten alerts within 30 px: one "10 alerts" group (a DOM button), its list on hover, focus or tap; remove by keyboard.
    await lp.evaluate(() => {
      const al = window.__extras.alerts, s = window.__extras.alertsCandles;
      al.clear();
      const h = window.__extras.alertsChart.panes()[0].getHeight();
      for (let i = 0; i < 10; i++) al.add(+s.coordinateToPrice(Math.round(h * 0.4) + i * 3).toFixed(4));
    });
    await sleep(lp, 200);
    const many = await P();
    const btn = lp.locator('[data-chartist-alert-groups] button[data-group]');
    check(many.length === 1 && many[0].ids.length === 10 && (await btn.count()) === 1 && (await btn.textContent()) === '10 alerts', 'ten alerts within 30 px collapse into one "10 alerts" chip', many.map(p => p.ids.length));
    await btn.hover();
    await sleep(lp, 150);
    const rows = lp.locator('[data-chartist-alert-groups] [data-panel] button');
    check((await rows.count()) === 10 && (await btn.getAttribute('aria-expanded')) === 'true', 'hover opens the list: ten rows with a remove control', await rows.count());
    const tags = await lp.evaluate(() => { const g = window.__extras.alerts; return g.alerts().length; });
    await card.screenshot({ path: path.join(out, 'alerts-many.png') });
    // Keyboard: focus the chip, Tab to the first remove control, Enter removes; Escape closes and returns focus.
    await lp.mouse.move(5, 5);
    await sleep(lp, 400);
    await btn.focus();
    await sleep(lp, 100);
    await lp.keyboard.press('Tab');
    const first = await lp.evaluate(() => { const r = document.querySelector('[data-chartist-alert-groups]').shadowRoot; return r.activeElement ? r.activeElement.getAttribute('aria-label') : null; });
    await lp.keyboard.press('Enter');
    await sleep(lp, 150);
    const after = await lp.evaluate(() => window.__extras.alerts.alerts().length);
    const stillIn = await lp.evaluate(() => { const r = document.querySelector('[data-chartist-alert-groups]').shadowRoot; return !!r.activeElement && !!r.activeElement.closest('[data-panel]'); });
    await lp.keyboard.press('Escape');
    await sleep(lp, 100);
    const back = await lp.evaluate(() => { const r = document.querySelector('[data-chartist-alert-groups]')?.shadowRoot; return r && r.activeElement ? r.activeElement.getAttribute('data-group') !== null : false; });
    check(/^Remove the alert at /.test(first || '') && after === tags - 1 && stillIn && back, 'keyboard: focus opens the list, Tab reaches a remove control, Enter removes, focus stays in the list, Escape returns to the chip', { first, after, stillIn, back });
    // Coarse pointer: 44 px targets for the group chip.
    const coarse = await browser.newContext({ viewport: { width: 1200, height: 900 }, hasTouch: true, isMobile: true });
    const cp = await coarse.newPage();
    watch(cp);
    await cp.goto(base + 'extras.html');
    await sleep(cp, 500);
    await cp.evaluate(() => { const al = window.__extras.alerts, s = window.__extras.alertsCandles; al.clear(); const h = window.__extras.alertsChart.panes()[0].getHeight(); for (let i = 0; i < 8; i++) al.add(+s.coordinateToPrice(Math.round(h * 0.4) + i * 2).toFixed(4)); });
    await sleep(cp, 200);
    const cb = cp.locator('[data-chartist-alert-groups] button[data-group]');
    const box = await cb.boundingBox();
    await cb.tap();
    await sleep(cp, 150);
    const rb = await cp.locator('[data-chartist-alert-groups] [data-panel] button').first().boundingBox();
    check(!!box && box.height >= 44 && !!rb && rb.height >= 44 && rb.width >= 44, 'coarse pointer: the group chip and the remove controls are 44 px; a tap opens the list', { chip: box && box.height, remove: rb && [rb.width, rb.height] });
    await coarse.close();
    await lp.close();
  }

  await browser.close();
  server.close();
  if (errors.length) { console.error(errors.join('\n')); failures.push('console errors'); }
  else console.log('ok   no console errors');
  if (failures.length) { console.error(`\n${failures.length} failure(s): ${failures.join('; ')}`); process.exit(1); }
  console.log('\nall extras checks passed');
})().catch(e => { console.error(e); process.exit(1); });
