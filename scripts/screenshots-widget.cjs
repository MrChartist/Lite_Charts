// Browser check of the widget (examples/widget.html with demo data, examples/widget-live.html with BTC): every menu
// and dialog by pointer and by keyboard, indicators added and edited, chart type, interval and range keys, go to date,
// screenshot download, full screen, save and reload of the workspace, destroy leaving nothing behind, at 1280, 768
// and 390 px, light and dark. The drawing bar: lazy loading (no drawings request before the pencil), a trend line
// drawn from the left bar with real pointer input, a flyout pick (pitchfork), the style bar in the top bar, keyboard
// (tab order, roving index, flyout by arrows, Escape), the phone row (scroll, touch picks), the breakpoint flip, the
// open state saved with the workspace, no per-frame layout, no overlap at 1280 / 1024 / 768 / 390 and 420 px tall.
// The rail closed: drawings stay painted, selectable, draggable and deletable; T reaches the widget; undo order; the
// eye saved; reload with drawings loads the module once, without none; a failing module; touch not blocked; cost.
// Writes docs/screenshots/widget-*.png. Needs Playwright and `npm run build`.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const failures = [];
const check = (ok, what, detail) => { if (!ok) failures.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const url = (file, q = '') => `file://${path.join(root, 'examples', file)}${q}`;

// Counts listeners added to window / document (to prove destroy removes them).
const COUNT_LISTENERS = () => {
  const live = new Map();
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target), rem = target.removeEventListener.bind(target);
    target.addEventListener = (t, f, o) => { const k = `${target === window ? 'w' : 'd'}:${t}`; if (!live.has(f) && !/playwright/i.test(t) && !/playwright|__pw|injected/i.test(new Error().stack || '')) live.set(f, k); add(t, f, o); };
    target.removeEventListener = (t, f, o) => { live.delete(f); rem(t, f, o); };
  }
  window.__listeners = () => [...live.values()];
};

(async () => {
  if (!fs.existsSync(path.join(root, 'dist', 'chartist-lite-widget.iife.min.js'))) throw new Error('run `npm run build` first');
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (w, h, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, acceptDownloads: true, ...opts });
    const page = await ctx.newPage();
    await page.addInitScript(COUNT_LISTENERS);
    page.on('pageerror', e => errors.push(`${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    return page;
  };
  const ready = page => page.waitForFunction(() => window.__widget && window.__widget.chart.panes()[0].getSeries()[0]?.data().length > 50, null, { timeout: 20000 });
  const openLayer = page => page.locator('[data-chartist-widget] .menu, [data-chartist-widget] .dlg').count();
  const activeLabel = page => page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const a = s.activeElement; return a ? (a.getAttribute('aria-label') || a.textContent || a.tagName).slice(0, 40) : null; });
  // Before a picture: no focus ring left from the last key press, the pointer out of the chart.
  const calm = async page => { await page.evaluate(() => { const h = document.querySelector('[data-chartist-widget]'); h?.shadowRoot?.activeElement?.blur?.(); document.activeElement?.blur?.(); }); await page.mouse.move(2, 2); await page.waitForTimeout(150); };
  const visibleRange = page => page.evaluate(() => window.__widget.chart.timeScale().getVisibleLogicalRange());
  const W = '[data-chartist-widget]';
  // The rail's buttons live in the drawings entry's shadow root inside the widget's bar (Playwright pierces both).
  const inRail = sel => `${W} .lbar [role="toolbar"] ${sel}, ${W} .tbar [role="toolbar"] ${sel}`;
  /** Open (or close) the drawing bar with the pencil, through More when the pencil collapsed into it. */
  const toggleDraw = async page => {
    const pencil = page.locator(`${W} .top button[aria-label="Drawing tools"]:not(.hide)`);
    if (await pencil.count()) await pencil.click();
    else { await page.locator(`${W} .top button[aria-label="More"]`).click(); await page.locator(`${W} .menu [role^="menuitem"]`, { hasText: 'Drawing tools' }).first().click(); }
    await page.waitForTimeout(350);
  };
  const railReady = page => page.waitForFunction(s => !!document.querySelector('[data-chartist-widget]').shadowRoot.querySelector(s), '.lbar [role="toolbar"], .tbar [role="toolbar"]', { timeout: 8000 }).catch(() => {});
  /** Boxes of the chrome (CSS px): bars, card, the drawing column / row and its rail, and whether anything overlaps. */
  const GEO = () => {
    const s = document.querySelector('[data-chartist-widget]').shadowRoot;
    const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } : null; };
    const top = box(s.querySelector('.top')), bot = box(s.querySelector('.bot')), card = box(s.querySelector('.card')), lbar = box(s.querySelector('.lbar')), tbar = box(s.querySelector('.tbar'));
    const mountHost = (s.querySelector('.lbar [data-chartist-drawing-ui]') || s.querySelector('.tbar [data-chartist-drawing-ui]'));
    const rail = mountHost && mountHost.shadowRoot ? mountHost.shadowRoot.querySelector('[role="toolbar"]') : null;
    const btns = rail ? [...rail.querySelectorAll('button')].map(box).filter(Boolean) : [];
    const railBox = box(rail);
    const visibleBtns = railBox ? btns.filter(b => b.t >= railBox.t - 1 && b.b <= railBox.b + 1 && b.l >= railBox.l - 1 && b.r <= railBox.r + 1) : [];
    const over = [...s.querySelectorAll('.bar')].map(b => b.scrollWidth - b.clientWidth);
    const legend = [...s.querySelectorAll('.lg')].map(box).filter(Boolean);
    const problems = [];
    if (lbar) { if (lbar.r > card.l + 2.01) problems.push('left bar under the card'); if (lbar.t < top.b - 0.5 || lbar.b > bot.t + 0.5) problems.push('left bar over a bar'); }
    if (tbar) { if (card.b > tbar.t + 0.5) problems.push('card over the phone row'); if (tbar.b > bot.t + 0.5) problems.push('phone row over the bottom bar'); }
    if (card.t < top.b - 0.5 || card.b > bot.t + 0.5) problems.push('card over a bar');
    for (const b of visibleBtns) if (b.l < card.l - 1 && b.r > card.l + 1) problems.push('rail button under the card');
    if (lbar) for (const b of visibleBtns) if (b.r > card.l - 4) problems.push('rail button closer than 4 px to the card');
    for (const g of legend) if (g.l < card.l) problems.push('legend left of the card');
    if (over.some(x => x > 1)) problems.push('a bar overflows');
    return { top, bot, card, lbar, tbar, rail: railBox, buttons: btns.length, visibleButtons: visibleBtns.length, scrolls: rail ? Math.max(rail.scrollHeight - rail.clientHeight, rail.scrollWidth - rail.clientWidth) : 0, problems, scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  };
  /** Layout and style passes counted by the browser (CDP), to prove the open bar adds none per frame. */
  const cdp = new WeakMap();
  const metrics = async page => {
    let c = cdp.get(page);
    if (!c) { c = await page.context().newCDPSession(page); await c.send('Performance.enable'); cdp.set(page, c); }
    const m = (await c.send('Performance.getMetrics')).metrics;
    const g = n => m.find(x => x.name === n)?.value ?? 0;
    return { layout: g('LayoutCount'), style: g('RecalcStyleCount') };
  };
  /** Layout passes during a 60-step crosshair sweep over the card. */
  const sweep = async (page, card) => { const a = await metrics(page); for (let i = 0; i < 60; i++) await page.mouse.move(card.l + 200 + i * 10, card.t + 200 + (i % 7) * 20); const b = await metrics(page); await page.mouse.move(2, 2); return b.layout - a.layout; };

  // ── 1280 light: pointer flows ──
  let page = await newPage(1280, 800);
  await page.goto(url('widget.html'));
  await ready(page);
  check(true, 'demo widget ready');
  const before = await page.evaluate(() => window.__widget.indicators().map(i => i.id));
  check(before.join() === 'ema,rsi', 'initial indicators from options', before);

  // Each menu and dialog by pointer, closed with Escape (focus back on its button).
  for (const label of ['More intervals', 'Chart type', 'Indicators (Alt+I)', 'Settings', 'Go to date', 'Time zone', 'Search symbol']) {
    const btn = page.locator(`[data-chartist-widget] button[aria-label^="${label}"]`).first();
    await btn.click();
    await page.waitForTimeout(150);
    const n = await openLayer(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    const after = await openLayer(page);
    const focus = await activeLabel(page);
    check(n === 1 && after === 0 && !!focus && focus.startsWith(label.split(' (')[0].slice(0, 8)), `pointer: ${label} opens, Escape closes and returns focus`, { n, after, focus });
  }

  // Indicators: add RSI and Bollinger from the dialog (search), change a param.
  await page.locator('[data-chartist-widget] button[aria-label^="Indicators"]').click();
  const search = page.locator('[data-chartist-widget] .dlg input[type="search"]');
  await search.fill('relative strength');
  await page.locator('[data-chartist-widget] .dlg button[aria-label^="Add Relative Strength"]').first().click();
  await search.fill('bollinger');
  await page.locator('[data-chartist-widget] .dlg button[aria-label^="Add Bollinger"]').first().click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(out, 'widget-indicators-dialog.png') });
  await page.keyboard.press('Escape');
  const ids = await page.evaluate(() => window.__widget.indicators().map(i => i.id));
  check(ids.filter(i => i === 'rsi').length === 2 && ids.some(i => /^(bb|bollinger)/.test(i)), 'RSI and Bollinger added from the dialog', ids);
  const bbId = ids.find(i => /^(bb|bollinger)/.test(i));
  // Settings of the Bollinger legend row: hover shows the actions; change the period.
  const bbRow = page.locator('[data-chartist-widget] .row', { hasText: /^BB|Bollinger/ }).first();
  await bbRow.hover();
  await bbRow.locator('button[aria-label$="settings"]').click();
  const period = page.locator('[data-chartist-widget] .dlg input[type="number"]').first();
  await period.fill('30');
  await period.press('Tab');
  await page.locator('[data-chartist-widget] .dlg button[aria-label="Done"]').click();
  const bbParams = await page.evaluate(id => window.__widget.indicators().find(i => i.id === id).params(), bbId);
  check(Object.values(bbParams).includes(30), 'indicator param changed in its settings dialog', bbParams);
  // Hide from the legend row.
  await bbRow.hover();
  await bbRow.locator('button[aria-label="Hide"]').click();
  check(await page.evaluate(id => !window.__widget.indicators().find(i => i.id === id).visible(), bbId), 'legend row hides an indicator');
  await page.locator('[data-chartist-widget] .row', { hasText: /^BB|Bollinger/ }).first().hover();
  await page.locator('[data-chartist-widget] .row', { hasText: /^BB|Bollinger/ }).first().locator('button[aria-label="Show"]').click();
  // Undo / redo.
  const nInd = (await page.evaluate(() => window.__widget.indicators().length));
  await page.locator('[data-chartist-widget] button[aria-label^="Undo"]').click();
  await page.locator('[data-chartist-widget] button[aria-label^="Undo"]').click();
  await page.locator('[data-chartist-widget] button[aria-label^="Redo"]').click();
  await page.locator('[data-chartist-widget] button[aria-label^="Redo"]').click();
  check((await page.evaluate(() => window.__widget.indicators().length)) === nInd, 'undo and redo round trip');

  // Chart type and interval.
  await page.locator('[data-chartist-widget] button[aria-label^="Chart type"]').click();
  await page.locator('[data-chartist-widget] .menu [role="menuitemradio"]', { hasText: 'Heikin' }).click();
  check(await page.evaluate(() => window.__widget.save().chartType) === 'heikinAshi', 'chart type switched from the menu');
  await page.locator('[data-chartist-widget] .menu, x').count();
  await page.locator('[data-chartist-widget] button[role="radio"][title^="1 hours"], [data-chartist-widget] button[role="radio"]:text-is("1h")').first().click();
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__widget.save().interval) === '1h', 'interval key switches the interval');
  await page.locator('[data-chartist-widget] button[aria-label^="Chart type"]').click();
  await page.locator('[data-chartist-widget] .menu [role="menuitemradio"]', { hasText: /^Candles$/ }).click();

  // Range keys: each sets a range (the feed may change the interval).
  const seen = [];
  for (const k of ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All']) {
    await page.locator(`[data-chartist-widget] .bot button[role="radio"]:text-is("${k}")`).click();
    await page.waitForTimeout(350);
    const st = await page.evaluate(() => ({ iv: window.__widget.save().interval, r: window.__widget.chart.timeScale().getVisibleLogicalRange() }));
    seen.push(`${k}:${st.iv}:${st.r ? Math.round(st.r.to - st.r.from) : 'none'}`);
  }
  check(seen.every(s => !s.endsWith('none')), 'every range key sets a visible range', seen);
  check(new Set(seen.map(s => s.split(':')[1])).size >= 3, 'range keys pick fitting intervals from the feed', seen);

  // Go to date (keyboard in the date field).
  await page.locator('[data-chartist-widget] .bot button[role="radio"]:text-is("1Y")').click();
  await page.waitForTimeout(400);
  const target = await page.evaluate(() => { const d = window.__widget.chart.panes()[0].getSeries()[0].data(); return d[Math.floor(d.length * 0.3)].time; });
  await page.locator('[data-chartist-widget] button[aria-label="Go to date"]').click();
  const iso = new Date(target * 1000).toISOString().slice(0, 10);
  await page.locator('[data-chartist-widget] input[type="date"]').fill(iso);
  await page.locator('[data-chartist-widget] input[type="date"]').press('Enter');
  await page.waitForTimeout(150);
  const vr = await visibleRange(page);
  const tl = await page.evaluate(t => window.__widget.chart.timeScale().timeToLogical(t), target);
  check(vr && tl > vr.from && tl < vr.to, 'go to date centres the date', { iso, vr, tl });
  // Go to latest appears when scrolled back, and works.
  const latestShown = await page.locator('[data-chartist-widget] .latest:not(.hide)').count();
  if (latestShown) await page.locator('[data-chartist-widget] .latest').click();
  await page.waitForTimeout(150);
  check(latestShown === 1 && await page.evaluate(() => window.__widget.chart.timeScale().isAtRealTime()), 'go to latest button shows when scrolled back and returns');

  // Screenshot download: a non-empty PNG.
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator('[data-chartist-widget] button[aria-label^="Screenshot"]').click()]);
  const file = await download.path();
  const buf = fs.readFileSync(file);
  check(buf.length > 10000 && buf.slice(1, 4).toString() === 'PNG', 'screenshot downloads a non-empty PNG', { bytes: buf.length, name: download.suggestedFilename() });

  // Full screen.
  await page.locator('[data-chartist-widget] button[aria-label="Full screen"]').click();
  await page.waitForTimeout(400);
  const fs1 = await page.evaluate(() => { const h = document.querySelector('[data-chartist-widget]'); const r = h.shadowRoot.querySelector('.w').getBoundingClientRect(); return { fs: document.fullscreenElement === h || h.shadowRoot.querySelector('.w').classList.contains('pseudo'), w: r.width, h: r.height, cw: window.__widget.chart.timeScale().width() }; });
  await page.locator('[data-chartist-widget] button[aria-label="Exit full screen"]').click();
  await page.waitForTimeout(300);
  check(fs1.fs && fs1.w >= 1279 && fs1.cw > 1000, 'full screen fills the screen and the chart follows', fs1);

  // ── keyboard flows ──
  await page.evaluate(() => window.__widget.chart.element().focus());
  await page.keyboard.press('/');
  check((await openLayer(page)) === 1, 'keyboard: / opens symbol search');
  await page.keyboard.type('orb');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__widget.save().symbol.symbol) === 'ORBT', 'keyboard: search and Enter switch the symbol');
  await page.evaluate(() => window.__widget.chart.element().focus());
  await page.keyboard.press(',');
  check((await openLayer(page)) === 1, 'keyboard: comma opens the interval menu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__widget.chart.element().focus());
  await page.keyboard.press('Alt+KeyI');
  const dlgOpen = (await openLayer(page)) === 1;
  // Tab is trapped in the dialog.
  for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; return !!s.activeElement && !!s.activeElement.closest('.dlg'); });
  await page.keyboard.press('Escape');
  check(dlgOpen && inside, 'keyboard: Alt+I opens indicators, Tab stays inside');
  await page.evaluate(() => window.__widget.chart.element().focus());
  await page.keyboard.press('1'); await page.keyboard.press('5'); await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__widget.save().interval) === '15m', 'keyboard: digits then Enter set the interval');
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.keyboard.press('Alt+KeyS')]);
  check(!!dl2, 'keyboard: Alt+S downloads a screenshot');
  // Tab reaches the bars' controls.
  await page.evaluate(() => document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.top button').focus());
  const tabbed = new Set();
  for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); tabbed.add(await activeLabel(page)); }
  check(tabbed.size > 12, 'Tab walks the controls', tabbed.size);

  // Drawings load on demand (the request itself is checked in the drawing section below).
  const hadDrawings = await page.evaluate(() => !!window.ChartistLiteDrawings);
  await toggleDraw(page);
  await railReady(page);
  check(!hadDrawings && await page.evaluate(() => !!window.ChartistLiteDrawings), 'drawing code loads only when the rail is first opened');

  // Destroy leaves nothing behind.
  const counts = await page.evaluate(() => {
    const listenersBefore = window.__listeners().length;
    const nodes = document.querySelectorAll('*').length;
    window.__widget.destroy();
    return { listenersBefore, after: window.__listeners(), nodesBefore: nodes, nodesAfter: document.querySelectorAll('*').length, left: document.querySelector('#w').childNodes.length };
  });
  check(counts.left === 0 && counts.after.length === 0, 'destroy removes every node and window/document listener', counts);
  await page.context().close();

  // ── the drawing bar (desk): lazy load, real pointer drawing, flyout, style bar, keyboard, no per-frame layout ──
  page = await newPage(1280, 800);
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  await page.goto(url('widget.html'));
  await ready(page);
  await page.waitForTimeout(500);
  const drawReq = () => requests.filter(u => /drawings/.test(u));
  check(drawReq().length === 0 && !(await page.evaluate(() => !!window.ChartistLiteDrawings)), 'lazy: no drawings script requested before the pencil', drawReq());
  const geoClosed = await page.evaluate(GEO);
  const sweepClosed = await sweep(page, geoClosed.card);
  await page.waitForTimeout(200);
  await toggleDraw(page);
  await railReady(page);
  await page.waitForTimeout(400);
  check(drawReq().length === 1, 'lazy: the pencil requests the drawings script once', drawReq().map(u => u.split('/').pop()));
  const geoOpen = await page.evaluate(GEO);
  check(!!geoOpen.lbar && !geoOpen.tbar && geoOpen.problems.length === 0, 'desk: the rail opens in the left bar, nothing overlaps', geoOpen.problems);
  check(Math.abs(geoOpen.lbar.t - geoOpen.top.b) < 0.6 && Math.abs(geoOpen.lbar.b - geoOpen.bot.t) < 0.6 && Math.abs(geoOpen.card.l - geoOpen.lbar.l - 42) < 0.6, 'desk: left bar flush with the top and bottom bars, card inset beside it', { lbar: geoOpen.lbar, card: geoOpen.card.l });
  check(geoOpen.card.w < geoClosed.card.w - 30, 'desk: the card gives the bar its room', { closed: geoClosed.card.w, open: geoOpen.card.w });
  // Opening the bar (module loaded) lays out in one burst while the rail is built (synchronous), then no more than an
  // idle page during its fade: no layout per frame. Closed, 440 ms idle; then the pencil, 60 ms, and 440 ms.
  await toggleDraw(page);
  await page.waitForTimeout(300);
  const i0 = await metrics(page); await page.waitForTimeout(440); const i1 = await metrics(page);
  const pencil = page.locator(`${W} .top button[aria-label="Drawing tools"]`);
  const o0 = await metrics(page); await pencil.click(); await page.waitForTimeout(60); const o1 = await metrics(page); await page.waitForTimeout(440); const o2 = await metrics(page);
  const idleL = i1.layout - i0.layout, fadeL = o2.layout - o1.layout;
  check(fadeL <= idleL + 5, 'desk: opening the bar: one burst while the rail is built, no layout per frame of the fade', { burst: o1.layout - o0.layout, duringFade: fadeL, idle: idleL });
  // The built-in legend and the indicator rows sit at the plot's left again (nothing makes room for a rail).
  const legendL = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; return { card: s.querySelector('.card').getBoundingClientRect().left, lg: s.querySelector('.lg').getBoundingClientRect().left }; });
  check(legendL.lg - legendL.card <= 8, 'desk: indicator legend rows at the plot\'s left edge', legendL);
  // All 53 tools by default: the Fibonacci group alone has more than the basic set's two.
  const groups = await page.locator(inRail('button[aria-haspopup="menu"]')).count();
  check(groups >= 7, 'desk: every tool group of ALL_TOOLS is on the rail', groups);

  // A trend line with real pointer input: the Lines button, then press, move and release on the chart.
  const cardBox = geoOpen.card;
  await page.locator(inRail('button[aria-label^="Lines"]')).click();
  await page.mouse.move(cardBox.l + 380, cardBox.t + 330);
  await page.mouse.down();
  await page.mouse.move(cardBox.l + 600, cardBox.t + 260, { steps: 8 });
  await page.mouse.move(cardBox.l + 820, cardBox.t + 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const drawn = await page.evaluate(() => JSON.parse(window.__widget.save().drawings || '{"drawings":[]}').drawings.map(d => d.tool));
  check(drawn.join() === 'trend', 'a trend line drawn from the left bar with the pointer', drawn);
  // The selected drawing's style bar sits in the top bar's free area, not over the candles.
  const styleAt = await page.evaluate(() => {
    const s = document.querySelector('[data-chartist-widget]').shadowRoot;
    const slot = s.querySelector('.top .sp [data-chartist-drawing-ui]');
    const bar = slot && slot.shadowRoot && slot.shadowRoot.querySelector('[aria-label="Drawing style"]');
    const r = bar && bar.getBoundingClientRect(), t = s.querySelector('.top').getBoundingClientRect();
    return r && r.width ? { inTop: r.top >= t.top - 0.5 && r.bottom <= t.bottom + 0.5, w: r.width, h: r.height } : null;
  });
  check(!!styleAt && styleAt.inTop, 'style bar of the selected drawing in the top bar', styleAt);
  // A colour from the style bar.
  const swatch = page.locator(`${W} .top .sp button[aria-label="Colour, width and dash"], ${W} .top .sp button[aria-label="Green"]`).first();
  await swatch.click();
  const green = page.locator(`[data-chartist-drawing-ui] button[aria-label="Green"]`).first();
  if (await green.isVisible()) await green.click();
  await page.waitForTimeout(100);
  check(await page.evaluate(() => !!JSON.parse(window.__widget.save().drawings).drawings[0].style.color), 'style bar sets a colour');
  // Flyout: press and hold the Channels and pitchforks button, pick the pitchfork; it opens over the chart beside the bar.
  const chBtn = page.locator(inRail('button[aria-label^="Channels"]'));
  const cb = await chBtn.boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down(); await page.waitForTimeout(450); await page.mouse.up();
  await page.waitForTimeout(150);
  const fly = await page.evaluate(() => {
    const root = window.__widget.chart.element();
    const ui = root.querySelector('[data-chartist-drawing-ui]');
    const m = ui && ui.shadowRoot && ui.shadowRoot.querySelector('[role="menu"]');
    if (!m || getComputedStyle(m).display === 'none') return null;
    const r = m.getBoundingClientRect(), c = root.getBoundingClientRect();
    return { l: r.left - c.left, t: r.top - c.top, w: r.width, h: r.height, inside: r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom, items: m.querySelectorAll('[role="menuitemradio"]').length };
  });
  check(!!fly && fly.inside && fly.l < 12 && fly.items >= 4, 'flyout opens over the chart next to the left bar', fly);
  await page.mouse.move(2, 2);
  await calm(page);
  await page.screenshot({ path: path.join(out, 'widget-drawings.png') });
  await page.locator('[data-chartist-drawing-ui] [role="menuitemradio"]', { hasText: /^Pitchfork/ }).first().click();
  check(await page.evaluate(() => window.__widget.chart.element().querySelector('[data-chartist-drawing-ui]') && true) && (await chBtn.getAttribute('aria-pressed')) === 'true', 'flyout pick arms the pitchfork', await chBtn.getAttribute('aria-label'));
  for (const [x, y] of [[300, 420], [560, 240], [700, 470]]) { await page.mouse.click(cardBox.l + x, cardBox.t + y); await page.waitForTimeout(60); }
  await page.waitForTimeout(150);
  const tools2 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.map(d => d.tool));
  check(tools2.includes('pitchfork'), 'a pitchfork drawn from the new group', tools2);
  await page.keyboard.press('Escape');

  // No layout added per frame with the bar open: the same crosshair sweep as with it closed.
  const sweepOpen = await sweep(page, cardBox);
  check(sweepOpen <= sweepClosed + 4, 'bar open: a crosshair sweep lays out no more than with the bar closed', { closed: sweepClosed, open: sweepOpen });

  // Keyboard: the rail is the next tab stop after the top bar; arrows rove; the cross arrow opens a flyout; Escape.
  await calm(page);
  await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const b = [...s.querySelectorAll('.top button')].filter(b => b.offsetParent && b.tabIndex >= 0 && !b.disabled && !b.closest('[data-chartist-drawing-ui]')); b[b.length - 1].focus(); });
  await page.keyboard.press('Tab');
  const deepActive = () => page.evaluate(() => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a ? { label: a.getAttribute('aria-label') || (a.textContent || '').trim() || a.tagName, inRail: !!(a.closest && a.closest('[role="toolbar"][aria-label="Drawing tools"]')), role: a.getAttribute('role') } : null; });
  const k1 = await deepActive();
  check(!!k1 && k1.inRail, 'keyboard: Tab after the top bar lands on the rail', k1);
  // The rail remembers its last button (roving tab index); Home goes to the cursor, ArrowDown to the Lines group.
  await page.keyboard.press('Home');
  const k1b = await deepActive();
  await page.keyboard.press('ArrowDown');
  const k2 = await deepActive();
  check(!!k2 && k2.inRail && /^Cursor/.test(k1b?.label) && /^Lines/.test(k2.label), 'keyboard: Home and arrows rove inside the rail', { home: k1b?.label, down: k2?.label.slice(0, 24) });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  const k3 = await deepActive();
  await page.keyboard.press('ArrowDown');
  const k4 = await deepActive();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  const k5 = await deepActive();
  check(k3?.role === 'menuitemradio' && k4?.role === 'menuitemradio' && k4.label !== k3.label && k5?.inRail && k5.label === k2.label, 'keyboard: ArrowRight opens the flyout, arrows move, Escape returns to the button', { k3, k4, k5 });
  await page.keyboard.press('Tab');
  const k6 = await page.evaluate(() => { const a = document.querySelector('[data-chartist-widget]').shadowRoot.activeElement; return a ? (a.closest('.card') ? 'card' : a.className || a.tagName) : null; });
  check(k6 === 'card', 'keyboard: Tab from the rail goes on to the chart', k6);
  // The widget's shortcuts still work with the bar open (Ctrl+Z undoes the pitchfork, comma opens the interval menu).
  await page.evaluate(() => window.__widget.chart.element().focus());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  const afterUndo = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length);
  await page.keyboard.press(',');
  const commaMenu = await openLayer(page);
  await page.keyboard.press('Escape');
  check(afterUndo === tools2.length - 1 && commaMenu === 1, 'keyboard: Ctrl+Z and the comma key unchanged with the bar open', { afterUndo, commaMenu });

  // The breakpoint flips (phone width): the tools are made again as a row, drawings kept, selection cleared.
  const nBefore = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const flip = await page.evaluate(GEO);
  const nAfter = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length);
  const selAfter = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.top .sp [data-chartist-drawing-ui]'); const b = s && s.shadowRoot && s.shadowRoot.querySelector('[aria-label="Drawing style"]'); return !!b && getComputedStyle(b).display !== 'none'; });
  check(!flip.lbar && !!flip.tbar && flip.problems.length === 0 && nAfter === nBefore && !selAfter, 'breakpoint flip: rail becomes the phone row, drawings kept, selection cleared', { problems: flip.problems, nBefore, nAfter, selAfter });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(500);
  const back = await page.evaluate(GEO);
  check(!!back.lbar && !back.tbar && back.problems.length === 0, 'breakpoint flip back: the left bar again', back.problems);
  // Close with the pencil: the bar fades and goes, the card takes the room back.
  await toggleDraw(page);
  await page.waitForTimeout(200);
  const shut = await page.evaluate(GEO);
  check(!shut.lbar && Math.abs(shut.card.w - geoClosed.card.w) < 1, 'the pencil closes the bar and the card takes the room back', { card: shut.card.w, closed: geoClosed.card.w });
  await page.context().close();

  // ── the rail closed: drawings stay painted and editable; the letter keys go back to the widget ──
  {
    page = await newPage(1280, 800);
    const reqs = [];
    page.on('request', r => { if (/drawings/.test(r.url())) reqs.push(r.url()); });
    await page.goto(url('widget.html', '?persist'));
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await ready(page);
    const D = () => page.evaluate(() => JSON.parse(window.__widget.save().drawings || '{"drawings":[]}').drawings);
    // Screen point of a drawing's two first anchors' midpoint (pane 0).
    const mid = i => page.evaluate(i => {
      const w = window.__widget, ts = w.chart.timeScale(), s = w.chart.panes()[0].getSeries().find(x => x.seriesType() === 'candlestick');
      const d = JSON.parse(w.save().drawings).drawings[i];
      const r = w.chart.element().getBoundingClientRect();
      const xy = p => ({ x: ts.logicalToCoordinate(ts.timeToLogical(p.time)), y: s.priceToCoordinate(p.price) });
      const a = xy(d.points[0]), b = xy(d.points[1]);
      return { x: r.left + (a.x + b.x) / 2, y: r.top + (a.y + b.y) / 2 };
    }, i);
    // Is the orange of the style bar painted on a chart canvas within 3 px of a point?
    const orangeAt = pt => page.evaluate(pt => {
      for (const c of window.__widget.chart.element().querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        if (pt.x < r.left || pt.x > r.right || pt.y < r.top || pt.y > r.bottom) continue;
        const k = c.width / r.width, ctx = c.getContext('2d');
        const px = ctx.getImageData(Math.round((pt.x - r.left) * k) - 6, Math.round((pt.y - r.top) * k) - 6, 13, 13).data;
        for (let i = 0; i < px.length; i += 4) if (px[i] > 170 && px[i + 1] > 30 && px[i + 1] < 90 && px[i + 2] < 30 && px[i + 3] > 200) return true;
      }
      return false;
    }, pt);
    const railShown = () => page.evaluate(() => { const l = document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.lbar'); return getComputedStyle(l).display !== 'none'; });
    const styleBarShown = () => page.evaluate(() => { const h = document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.top .sp [data-chartist-drawing-ui]'); const b = h && h.shadowRoot && h.shadowRoot.querySelector('[aria-label="Drawing style"]'); return !!b && getComputedStyle(b).display !== 'none'; });
    await toggleDraw(page);
    await railReady(page);
    let card = (await page.evaluate(GEO)).card;
    // Two tools with the pointer: a trend line (made orange from the style bar) and a rectangle.
    await page.locator(inRail('button[aria-label^="Lines"]')).click();
    await page.mouse.move(card.l + 360, card.t + 300); await page.mouse.down(); await page.mouse.move(card.l + 760, card.t + 180, { steps: 10 }); await page.mouse.up();
    await page.locator(`${W} .top .sp button[aria-label="Colour, width and dash"], ${W} .top .sp button[aria-label="Orange"]`).first().click();
    const orange = page.locator('[data-chartist-drawing-ui] button[aria-label="Orange"]').first();
    if (await orange.isVisible()) await orange.click();
    await page.locator(inRail('button[aria-label^="Shapes"]')).click();
    await page.mouse.move(card.l + 900, card.t + 380); await page.mouse.down(); await page.mouse.move(card.l + 1050, card.t + 460, { steps: 10 }); await page.mouse.up();
    await page.keyboard.press('Escape');
    const two = (await D()).map(d => d.tool);
    check(two.join() === 'trend,rectangle', 'closed rail: two tools drawn from the rail first', two);
    // A widget change between the drawing actions (for the undo order below).
    await page.evaluate(() => window.__widget.addIndicator('sma'));
    await toggleDraw(page);
    await page.waitForTimeout(300);
    card = (await page.evaluate(GEO)).card;
    let m = await mid(0);
    check(!(await railShown()) && (await D()).length === 2 && await orangeAt(m), 'closed rail: rail hidden, both drawings kept and still painted', { rail: await railShown(), n: (await D()).length });
    // Select by click, drag it, and the style bar shows in the top bar.
    await page.mouse.click(m.x, m.y);
    await page.waitForTimeout(100);
    check(await styleBarShown(), 'closed rail: a click selects a drawing; its style bar shows in the top bar');
    const beforeDrag = JSON.stringify((await D())[0].points);
    await page.mouse.move(m.x, m.y); await page.mouse.down(); await page.mouse.move(m.x + 80, m.y + 40, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(100);
    const afterDrag = JSON.stringify((await D())[0].points);
    check(afterDrag !== beforeDrag, 'closed rail: the selected drawing is dragged');
    await calm(page);
    // Re-select for the picture (calm blurred, the selection stays).
    m = await mid(0);
    if (!(await styleBarShown())) await page.mouse.click(m.x, m.y);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, 'widget-drawings-closed.png') });
    // Undo order with the rail closed: the drag, then the indicator, then redo both.
    await page.evaluate(() => window.__widget.chart.element().focus());
    const nInd = await page.evaluate(() => window.__widget.indicators().length);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(80);
    const u1 = { pts: JSON.stringify((await D())[0].points), inds: await page.evaluate(() => window.__widget.indicators().length) };
    await page.keyboard.press('Control+z'); await page.waitForTimeout(120);
    const u2 = { n: (await D()).length, inds: await page.evaluate(() => window.__widget.indicators().length) };
    await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(120);
    await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(80);
    const r2 = { pts: JSON.stringify((await D())[0].points), inds: await page.evaluate(() => window.__widget.indicators().length) };
    check(u1.pts === beforeDrag && u1.inds === nInd && u2.n === 2 && u2.inds === nInd - 1 && r2.pts === afterDrag && r2.inds === nInd, 'closed rail: undo and redo keep their order (drag, then the indicator, and back)', { u1: u1.inds, u2, r2: r2.inds });
    // Delete the selected drawing.
    m = await mid(0);
    await page.mouse.click(m.x, m.y);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    check((await D()).map(d => d.tool).join() === 'rectangle', 'closed rail: Delete removes the selected drawing', (await D()).map(d => d.tool));
    // T does not arm the trend tool: it reaches the widget (symbol search with "t"); Shift+H adds nothing.
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__widget.chart.element().focus());
    await page.keyboard.press('t');
    await page.waitForTimeout(150);
    const searchOpen = await openLayer(page);
    const typed = await page.evaluate(() => document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.dlg input, .menu input')?.value ?? null);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__widget.chart.element().focus());
    await page.keyboard.press('Shift+H');
    await page.mouse.click(card.l + 300, card.t + 420);
    await page.mouse.click(card.l + 500, card.t + 440);
    await page.waitForTimeout(100);
    check(searchOpen === 1 && typed === 't' && (await D()).length === 1, 'closed rail: T opens the symbol search (no trend tool armed), Shift+H and clicks add nothing', { searchOpen, typed, n: (await D()).length });
    // Touch: nothing selected, the chart's touch-action is the plain chart's (no blocking).
    check(await page.evaluate(() => getComputedStyle(window.__widget.chart.element()).touchAction !== 'none'), 'closed rail: nothing selected, touch is not blocked');
    // Reopen: state intact; the eye hides the drawings and stays on through a close and a reopen.
    await toggleDraw(page);
    await railReady(page);
    const reopenedN = (await D()).length;
    const eye = page.locator(inRail('button[aria-label="Hide drawings"]'));
    await eye.click();
    await toggleDraw(page);
    await toggleDraw(page);
    const eyeKept = await eye.getAttribute('aria-pressed');
    check(reopenedN === 1 && (await railShown()) && eyeKept === 'true' && (await page.evaluate(() => window.__widget.save().drawingsHidden)) === true, 'reopen: drawings intact; the eye stays on through close and reopen', { reopenedN, eyeKept });
    await eye.click();
    // Persist with the rail closed: on reload the drawings are painted, the drawings script requested exactly once.
    await toggleDraw(page);
    await page.waitForTimeout(700);
    reqs.length = 0;
    await page.reload();
    await ready(page);
    await page.waitForFunction(() => !!window.__widget.chart.element().querySelector('[data-chartist-drawing-ui]'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const reload1 = await page.evaluate(() => ({ open: window.__widget.save().drawingsOpen, n: JSON.parse(window.__widget.save().drawings).drawings.length, painted: !!window.__widget.chart.element().querySelector('[data-chartist-drawing-ui]') }));
    check(!reload1.open && reload1.n === 1 && reload1.painted && !(await railShown()) && reqs.length === 1, 'persist, rail closed: reload paints the drawings, the drawings script requested once', { ...reload1, requests: reqs.length });
    // The eye state is saved too.
    await toggleDraw(page); await railReady(page);
    await page.locator(inRail('button[aria-label="Hide drawings"]')).click();
    await toggleDraw(page);
    await page.waitForTimeout(700);
    await page.reload();
    await ready(page);
    await page.waitForTimeout(300);
    const eyeSaved = await page.evaluate(() => window.__widget.save().drawingsHidden);
    await toggleDraw(page); await railReady(page);
    check(eyeSaved === true && (await page.locator(inRail('button[aria-label="Hide drawings"]')).getAttribute('aria-pressed')) === 'true', 'persist: the eye (hide drawings) is saved and restored', { eyeSaved });
    // A workspace with no drawings and the rail closed: the drawings script is not requested.
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    await ready(page);
    await page.evaluate(() => window.__widget.setTheme('light'));
    await page.waitForTimeout(700);
    reqs.length = 0;
    await page.reload();
    await ready(page);
    await page.waitForTimeout(600);
    check(reqs.length === 0 && (await page.evaluate(() => window.__widget.save().drawings)) === null, 'persist without drawings, rail closed: the drawings script is not requested', reqs);
    // load(json) with drawings and the rail closed: they show (module loaded for them).
    const ws = await page.evaluate(() => { const s = window.__widget.save(); s.drawingsOpen = false; s.drawings = JSON.stringify({ format: 'chartist-lite-drawings', version: 2, drawings: [{ tool: 'horizontal', points: (r => [{ time: r[r.length - 5].time, price: r[r.length - 1].close }])(window.__widget.chart.panes()[0].getSeries().find(x => x.seriesType() === 'candlestick').data()) }] }); return s; });
    await page.evaluate(ws => window.__widget.load(ws), ws);
    await page.waitForFunction(() => !!window.__widget.chart.element().querySelector('[data-chartist-drawing-ui]'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(200);
    const loadedN = (await D()).length;
    check(reqs.length === 1 && loadedN === 1 && !(await railShown()) && (await page.evaluate(() => !!window.__widget.chart.element().querySelector('[data-chartist-drawing-ui]'))), 'load(json) with drawings, rail closed: the drawings show', { requests: reqs.length, drawings: loadedN });
    await page.evaluate(() => localStorage.clear());
    await page.context().close();
  }

  // ── a drawings module that fails to load: a quiet word, the chart keeps working ──
  {
    page = await newPage(1280, 800);
    await page.route(/chartist-lite-drawings\.iife\.min\.js/, r => r.abort());
    const errs0 = errors.length;
    await page.goto(url('widget.html'));
    await ready(page);
    await toggleDraw(page);
    await page.waitForTimeout(400);
    const tip = await page.evaluate(() => document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.tip')?.textContent ?? null);
    await page.locator(`${W} .bot button[role="radio"]:text-is("1M")`).click();
    await page.waitForTimeout(300);
    check(tip === 'Drawings could not be loaded' && !!(await visibleRange(page)), 'drawings fail to load: a quiet tip, the chart keeps working', tip);
    errors.length = errs0; // the aborted request is the point of this check
    await page.context().close();
  }

  // ── cost per frame: 20 drawings, rail open versus closed (the same but the toolbar) ──
  {
    page = await newPage(1280, 800);
    await page.goto(url('widget.html'));
    await ready(page);
    await toggleDraw(page);
    await railReady(page);
    await page.evaluate(async () => {
      const w = window.__widget, rows = w.chart.panes()[0].getSeries().find(x => x.seriesType() === 'candlestick').data();
      const tools = ['trend', 'ray', 'extended', 'horizontal', 'rectangle', 'fib', 'channel', 'measure', 'long', 'text'];
      const drawings = [];
      for (let i = 0; i < 20; i++) {
        const k = rows.length - 130 + i * 5, a = rows[k], b = rows[k + 15], c = rows[k + 25];
        const t = tools[i % tools.length];
        drawings.push({ tool: t, text: t === 'text' ? 'Note' : undefined, points: [{ time: a.time, price: a.close }, { time: b.time, price: b.close * 1.01 }, { time: c.time, price: c.close * 0.99 }] });
      }
      const s = w.save(); s.drawings = JSON.stringify({ format: 'chartist-lite-drawings', version: 2, drawings });
      await w.load(s);
    });
    await page.waitForTimeout(300);
    const n20 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length);
    const cost = async () => {
      const c = await page.context().newCDPSession(page); await c.send('Performance.enable');
      const get = async () => { const m = (await c.send('Performance.getMetrics')).metrics; const g = n => m.find(x => x.name === n)?.value ?? 0; return g('ScriptDuration') + g('LayoutDuration') + g('RecalcStyleDuration'); };
      const card = (await page.evaluate(GEO)).card;
      const a = await get();
      for (let i = 0; i < 80; i++) await page.mouse.move(card.l + 150 + i * 9, card.t + 150 + (i % 9) * 25);
      const b = await get();
      await c.detach();
      await page.mouse.move(2, 2);
      return ((b - a) * 1000) / 80;
    };
    await cost(); // warm
    const open = Math.min(await cost(), await cost());
    await toggleDraw(page);
    await page.waitForTimeout(300);
    const closed = Math.min(await cost(), await cost());
    check(n20 === 20 && closed <= open * 1.25 + 0.1, '20 drawings: a pointer step costs no more with the rail closed than open', { drawings: n20, openMsPerStep: +open.toFixed(3), closedMsPerStep: +closed.toFixed(3) });
    await page.context().close();
  }

  // ── phone, touch, rail closed with drawings: page scroll over the chart not trapped; a tap selects ──
  {
    page = await newPage(390, 844, { hasTouch: true, isMobile: true });
    await page.goto(url('widget.html', '?persist'));
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await ready(page);
    const plainTouch = await page.evaluate(() => getComputedStyle(window.__widget.chart.element()).touchAction);
    await page.evaluate(async () => {
      const w = window.__widget, rows = w.chart.panes()[0].getSeries().find(x => x.seriesType() === 'candlestick').data();
      const a = rows[rows.length - 30], b = rows[rows.length - 8];
      const s = w.save(); s.drawingsOpen = false;
      s.drawings = JSON.stringify({ format: 'chartist-lite-drawings', version: 2, drawings: [{ tool: 'trend', points: [{ time: a.time, price: a.low }, { time: b.time, price: b.high }] }] });
      await w.load(s);
    });
    await page.waitForFunction(() => !!window.__widget.chart.element().querySelector('[data-chartist-drawing-ui]'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(200);
    const closedTouch = await page.evaluate(() => getComputedStyle(window.__widget.chart.element()).touchAction);
    // A one-finger swipe over the chart pans it (the chart's own gesture, as without drawings).
    const vr0 = await visibleRange(page);
    const box = (await page.evaluate(GEO)).card;
    const cdpT = await page.context().newCDPSession(page);
    const tp = (type, x, y) => cdpT.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await tp('touchStart', box.l + 120, box.t + 420);
    for (let i = 1; i <= 8; i++) await tp('touchMove', box.l + 120 + i * 20, box.t + 420);
    await tp('touchEnd');
    await page.waitForTimeout(300);
    const vr1 = await visibleRange(page);
    // A tap on the drawing selects it: touch then belongs to the drawing (as with the rail open).
    await page.evaluate(() => window.__widget.chart.timeScale().scrollToRealTime());
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const w = window.__widget, ts = w.chart.timeScale(), s = w.chart.panes()[0].getSeries().find(x => x.seriesType() === 'candlestick');
      const d = JSON.parse(w.save().drawings).drawings[0], r = w.chart.element().getBoundingClientRect();
      const xy = p => ({ x: ts.logicalToCoordinate(ts.timeToLogical(p.time)), y: s.priceToCoordinate(p.price) });
      const a = xy(d.points[0]), b = xy(d.points[1]);
      return { x: r.left + (a.x + b.x) / 2, y: r.top + (a.y + b.y) / 2 };
    });
    await page.touchscreen.tap(m.x, m.y);
    await page.waitForTimeout(200);
    const selTouch = await page.evaluate(() => getComputedStyle(window.__widget.chart.element()).touchAction);
    check(closedTouch === plainTouch && closedTouch !== 'none' && vr0 && vr1 && Math.abs(vr1.from - vr0.from) > 1, 'phone, rail closed: touch-action as without drawings, a swipe pans the chart', { plainTouch, closedTouch, moved: vr0 && vr1 ? +(vr1.from - vr0.from).toFixed(1) : null });
    check(selTouch === 'none', 'phone, rail closed: a tap selects the drawing and touch belongs to it', selTouch);
    await cdpT.detach();
    await page.evaluate(() => localStorage.clear());
    await page.context().close();
  }

  // ── sizes with the bar open: 1280, 1024, 768 and a 420 px tall widget; light and dark ──
  for (const [vw, vh, theme] of [[1280, 800, 'dark'], [1024, 768, 'light'], [768, 900, 'dark'], [1280, 452, 'light'], [1024, 452, 'dark']]) {
    page = await newPage(vw, vh);
    await page.goto(url('widget.html', `?theme=${theme}`));
    await ready(page);
    await toggleDraw(page);
    await railReady(page);
    await page.waitForTimeout(300);
    const g = await page.evaluate(GEO);
    const short = vh < 500;
    check(g.problems.length === 0 && g.scrollX <= 0 && !!g.lbar && (!short || g.scrolls > 0), `${vw}x${vh} ${theme}: left bar fits${short ? ', the rail scrolls inside it' : ''}, nothing overlaps`, { problems: g.problems, scrolls: g.scrolls, h: g.card.h });
    if (short) {
      // Scrolled to the end, the last button (delete all) is inside the bar.
      await page.evaluate(() => { const h = document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.lbar [data-chartist-drawing-ui]'); const r = h.shadowRoot.querySelector('[role="toolbar"]'); r.scrollTop = r.scrollHeight; });
      await page.waitForTimeout(100);
      const last = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const h = s.querySelector('.lbar [data-chartist-drawing-ui]'); const bs = h.shadowRoot.querySelectorAll('button'); const b = bs[bs.length - 1].getBoundingClientRect(), l = s.querySelector('.lbar').getBoundingClientRect(); return b.top >= l.top && b.bottom <= l.bottom + 0.5; });
      check(last, `${vw}x${vh}: scrolled to the end, the last rail button is in view`);
    }
    await page.context().close();
  }

  // ── phone (touch emulation): the row above the bottom bar, scrolls, a tool picked by touch, a flyout by touch ──
  page = await newPage(390, 844, { hasTouch: true, isMobile: true });
  await page.goto(url('widget.html'));
  await ready(page);
  await toggleDraw(page);
  await railReady(page);
  await page.waitForTimeout(300);
  const ph = await page.evaluate(GEO);
  check(!!ph.tbar && !ph.lbar && ph.problems.length === 0 && ph.scrolls > 0, 'phone: tools as a scrolling row above the bottom bar, plot shortened, nothing covered', { problems: ph.problems, scrolls: ph.scrolls, tbar: ph.tbar, card: ph.card });
  const coarseBtn = await page.evaluate(() => { const h = document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.tbar [data-chartist-drawing-ui]'); return h.shadowRoot.querySelector('button').getBoundingClientRect().height; });
  check(coarseBtn >= 44, 'phone: 44 px touch targets', coarseBtn);
  await calm(page);
  await page.screenshot({ path: path.join(out, 'widget-phone.png') });
  // A tool picked by touch: tap the Shapes button.
  const shapes = page.locator(inRail('button[aria-label^="Shapes"]'));
  await shapes.tap();
  check((await shapes.getAttribute('aria-pressed')) === 'true', 'phone: a tap on the row arms a tool');
  // A flyout by touch: tap the Fibonacci button's corner mark; it opens upwards inside the chart.
  const fib = page.locator(inRail('button[aria-label^="Fibonacci"]'));
  await fib.scrollIntoViewIfNeeded();
  const fb = await fib.boundingBox();
  await page.touchscreen.tap(fb.x + fb.width - 4, fb.y + fb.height - 4);
  await page.waitForTimeout(200);
  const pfly = await page.evaluate(() => {
    const root = window.__widget.chart.element();
    const m = root.querySelector('[data-chartist-drawing-ui]').shadowRoot.querySelector('[role="menu"]');
    if (!m || getComputedStyle(m).display === 'none') return null;
    const r = m.getBoundingClientRect(), c = root.getBoundingClientRect();
    return { inside: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5, items: m.querySelectorAll('[role="menuitemradio"]').length };
  });
  check(!!pfly && pfly.inside && pfly.items > 2, 'phone: a flyout opens upwards inside the chart', pfly);
  await page.locator('[data-chartist-drawing-ui] [role="menuitemradio"]').nth(1).tap();
  check((await fib.getAttribute('aria-pressed')) === 'true', 'phone: a tool picked from the flyout by touch');
  // The row scrolls sideways: at the end, the last button (delete all) is in view.
  const scrolled = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const h = s.querySelector('.tbar [data-chartist-drawing-ui]'); const r = h.shadowRoot.querySelector('[role="toolbar"]'); r.scrollLeft = r.scrollWidth; const bs = r.querySelectorAll('button'); const b = bs[bs.length - 1].getBoundingClientRect(), t = s.querySelector('.tbar').getBoundingClientRect(); return { left: r.scrollLeft, inView: b.left >= t.left && b.right <= t.right + 0.5 }; });
  check(scrolled.left > 0 && scrolled.inView, 'phone: the row scrolls to its last button', scrolled);
  await page.context().close();

  // ── the open state is saved with the workspace (persist) ──
  page = await newPage(1280, 800);
  await page.goto(url('widget.html', '?persist'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready(page);
  await toggleDraw(page);
  await railReady(page);
  await page.waitForTimeout(600);
  await page.reload();
  await ready(page);
  await railReady(page);
  await page.waitForTimeout(300);
  const reopened = await page.evaluate(() => ({ open: window.__widget.save().drawingsOpen, rail: !!document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.w.rail .lbar [data-chartist-drawing-ui]') }));
  await toggleDraw(page);
  await page.waitForTimeout(600);
  await page.reload();
  await ready(page);
  await page.waitForTimeout(500);
  const reclosed = await page.evaluate(() => ({ open: window.__widget.save().drawingsOpen, rail: !!document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.lbar [data-chartist-drawing-ui]') }));
  check(reopened.open === true && reopened.rail && reclosed.open === false && !reclosed.rail, 'persist: the drawing bar comes back open, or closed, as it was saved', { reopened, reclosed });
  await page.evaluate(() => localStorage.clear());
  await page.context().close();

  // ── the tools option: 'basic' gives the first fifteen ──
  page = await newPage(1280, 800);
  await page.goto(url('widget.html', '?tools=basic'));
  await ready(page);
  await toggleDraw(page);
  await railReady(page);
  const basicGroups = await page.locator(inRail('button[aria-label*=":"]')).evaluateAll(bs => bs.map(b => b.getAttribute('aria-label').split(':')[0]));
  const flyBasic = await (async () => { const b = page.locator(inRail('button[aria-label^="Lines"]')); await b.focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(80); const n = await page.locator('[data-chartist-drawing-ui] [role="menuitemradio"]').count(); await page.keyboard.press('Escape'); return n; })();
  check(flyBasic > 0 && flyBasic < 8, "drawings: { tools: 'basic' } offers the basic set", { groups: basicGroups, lines: flyBasic });
  await page.context().close();

  // ── extras in the widget: price alert from the bell, replay from More ──
  page = await newPage(1280, 800);
  await page.goto(url('widget.html'));
  await ready(page);
  await page.locator('[data-chartist-widget] button[aria-label="Price alert"]').click();
  const alerted = await page.waitForFunction(() => !!window.ChartistLiteExtras, null, { timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(300);
  check(alerted, 'the Alert button loads the extras on first use and adds an alert');
  await page.locator('[data-chartist-widget] .top button[aria-label="More"]').click();
  const replayItem = page.locator('[data-chartist-widget] .menu [role="menuitem"]', { hasText: 'Replay' });
  const hasReplay = await replayItem.count();
  if (hasReplay) await replayItem.click();
  await page.waitForTimeout(400);
  const shown = await page.evaluate(() => window.__widget.chart.panes()[0].getSeries()[0].data().length);
  check(hasReplay === 1 && shown > 0, 'Replay starts from the More menu', { shown });
  await page.context().close();

  // ── hostile page: strict CSP, right to left, broad CSS; tooltip and watermark on, three panes; desk and phone ──
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    page = await newPage(w, h);
    const csp = [];
    page.on('console', m => { if (/Content Security Policy|Refused/i.test(m.text())) csp.push(m.text()); });
    await page.goto(url('widget-hostile.html'));
    await ready(page);
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => { const r = document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.card').getBoundingClientRect(); const p = window.__widget.chart.panes().map(x => x.getHeight()); return { x: r.x, y: r.y, w: r.width, h: r.height, panes: p }; });
    // Hover in the last pane (an oscillator): the tooltip card stays inside the card.
    const lastTop = box.panes.slice(0, -1).reduce((a, b) => a + b + 1, 0);
    await page.mouse.move(box.x + box.w * 0.5, box.y + lastTop + box.panes[box.panes.length - 1] * 0.5);
    await page.waitForTimeout(200);
    const tip = await page.evaluate(() => {
      const root = window.__widget.chart.element();
      const hosts = [...root.querySelectorAll('*')].filter(e => e.shadowRoot);
      for (const hst of hosts) for (const el of hst.shadowRoot.querySelectorAll('div')) { const st = getComputedStyle(el); if (st.display !== 'none' && el.getAttribute('aria-hidden') === 'true' && el.textContent.length > 10) { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, text: el.textContent.slice(0, 40) }; } }
      return null;
    });
    // The drawing bar on the hostile page (RTL, strict CSP, broad CSS): in place, nothing overlaps.
    await page.mouse.move(2, 2);
    await toggleDraw(page);
    await railReady(page);
    await page.waitForTimeout(300);
    const hg = await page.evaluate(GEO);
    check(hg.problems.length === 0 && (w < 560 ? !!hg.tbar : !!hg.lbar) && hg.visibleButtons > 4, `hostile ${w}: drawing bar in place, nothing overlaps`, { problems: hg.problems, visible: hg.visibleButtons });
    check(csp.length === 0, `hostile ${w}: no CSP violations`, csp.slice(0, 2));
    check(box.panes.length >= 3, `hostile ${w}: three panes`, box.panes);
    check(!!tip && tip.l >= box.x - 1 && tip.r <= box.x + box.w + 1 && tip.t >= box.y - 1 && tip.b <= box.y + box.h + 1, `hostile ${w}: tooltip shows inside the card over a lower pane`, tip);
    if (w === 1280) await page.screenshot({ path: path.join(out, 'widget-hostile.png') });
    await page.context().close();
  }

  // ── save, reload, restore (persist) ──
  page = await newPage(1280, 800);
  await page.goto(url('widget.html', '?persist'));
  await ready(page);
  await page.evaluate(() => { localStorage.clear(); window.__widget.addIndicator('macd'); window.__widget.setChartType('line'); window.__widget.setTheme('dark'); });
  await page.waitForTimeout(600);
  const saved = await page.evaluate(() => window.__widget.save());
  await page.reload();
  await ready(page);
  await page.waitForTimeout(300);
  const restored = await page.evaluate(() => window.__widget.save());
  check(JSON.stringify(restored.indicators.map(i => i.id)) === JSON.stringify(saved.indicators.map(i => i.id)) && restored.chartType === 'line' && restored.theme === 'dark', 'persist: reload restores the workspace', { saved: saved.indicators.map(i => i.id), restored: restored.indicators.map(i => i.id) });
  await page.evaluate(() => localStorage.clear());
  await page.context().close();

  // ── sizes and themes ──
  for (const [w, h, name] of [[1280, 800, 'desk'], [768, 900, 'tablet'], [390, 844, 'phone']]) {
    for (const theme of ['light', 'dark']) {
      page = await newPage(w, h);
      await page.goto(url('widget.html', `?theme=${theme}`));
      await ready(page);
      await page.waitForTimeout(300);
      const geo = await page.evaluate(() => {
        const s = document.querySelector('[data-chartist-widget]').shadowRoot;
        const over = [...s.querySelectorAll('.bar')].map(b => b.scrollWidth - b.clientWidth);
        return { over, scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      check(geo.over.every(x => x <= 1) && geo.scrollX <= 0, `${name} ${theme}: bars fit, no page scroll`, geo);
      // With the drawing bar open (the pictures show it: the left bar, or the phone row).
      await toggleDraw(page);
      await railReady(page);
      await page.waitForTimeout(300);
      const g2 = await page.evaluate(GEO);
      check(g2.problems.length === 0 && g2.scrollX <= 0 && (name === 'phone' ? !!g2.tbar : !!g2.lbar), `${name} ${theme}: drawing bar open, nothing overlaps`, g2.problems);
      if (name === 'desk' && theme === 'light') { await calm(page); await page.screenshot({ path: path.join(out, 'widget-light.png') }); }
      if (name === 'desk' && theme === 'dark') { await calm(page); await page.screenshot({ path: path.join(out, 'widget-dark.png') }); }
      if (name === 'tablet' && theme === 'light') { await calm(page); await page.screenshot({ path: path.join(out, 'widget-tablet.png') }); }
      // The More menu (when present) opens as a bottom sheet on a phone.
      const more = page.locator('[data-chartist-widget] .top button[aria-label="More"]:not(.hide)');
      if (await more.count()) {
        await more.click();
        const sheet = await page.locator('[data-chartist-widget] .menu.sheet').count();
        if (name === 'phone') check(sheet === 1, 'phone: menus open as bottom sheets');
        await page.waitForTimeout(350);
        if (name === 'phone' && theme === 'light') await page.screenshot({ path: path.join(out, 'widget-phone-menu.png') });
        await page.keyboard.press('Escape');
      }
      await page.context().close();
    }
  }

  // ── live (real network when the exchange answers, else the page's fake provider) ──
  page = await newPage(1280, 800);
  const reachable = await page.evaluate(async () => { try { return (await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600')).ok; } catch { return false; } });
  await page.goto(url('widget-live.html', reachable ? '' : '?fake'));
  await ready(page);
  const st = await page.waitForFunction(() => /Live/.test(document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.st')?.textContent || ''), null, { timeout: 20000 }).then(() => true).catch(() => false);
  check(st, `live widget streams (${reachable ? 'real Coinbase' : 'fake provider'})`, await page.evaluate(() => document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.st')?.textContent));
  await page.locator('[data-chartist-widget] button[aria-label="Search symbol"]').click();
  await page.keyboard.type('eth');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  const eth = await page.waitForFunction(() => window.__widget.chart.panes()[0].getSeries()[0]?.data().length > 50 && window.__widget.save().symbol.symbol === 'ETH-USD', null, { timeout: 20000 }).then(() => true).catch(() => false);
  check(eth, 'live symbol search switches to ETH-USD');
  await page.locator('[data-chartist-widget] button[aria-label="Search symbol"]').click();
  await page.keyboard.type('btc');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await ready(page);
  await page.waitForTimeout(1500);
  { await calm(page); await page.screenshot({ path: path.join(out, 'widget-live-dark.png') }); }
  await page.context().close();

  // ── zero JavaScript: <chartist-terminal live> and <chartist-chart widget live> ──
  page = await newPage(1280, 1200);
  await page.goto(url('widget-element.html', ''));
  const both = await page.waitForFunction(() => ['t1', 't2'].every(id => { const el = document.getElementById(id); const c = el && el.chart; return c && c.panes()[0].getSeries().some(s => s.data().length > 50); }), null, { timeout: 25000 }).then(() => true).catch(() => false);
  check(both, 'zero-JS tags: <chartist-terminal live> and <chartist-chart widget live> both draw');
  await page.evaluate(() => document.getElementById('t2').remove());
  check(await page.evaluate(() => !document.querySelectorAll('chartist-chart [data-chartist-widget]').length), 'removing the element tears the widget down');
  await page.context().close();

  // ── brick chart types on the ordinal axis: indicators and volume on the bricks, compare kept but not drawn, session
  // breaks off, a drawing anchored on a brick survives candles -> Renko -> candles, save and restore ──
  page = await newPage(1280, 800);
  await page.goto(url('widget.html', ''));
  await ready(page);
  await page.waitForTimeout(600);
  {
    // A compare symbol and session breaks on, then Renko.
    await page.evaluate(async () => { const W = window.__widget; const s = W.save(); s.compare = ['ORBT']; s.settings = { ...s.settings, sessionBreaks: true }; await W.load(s); });
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__widget.setChartType('renko'));
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => {
      const W = window.__widget, c = W.chart;
      const all = c.panes().flatMap((pn, i) => pn.getSeries().map(s => ({ pane: i, type: s.seriesType(), title: s.options().title, n: s.data().length, last: s.data().length ? s.data()[s.data().length - 1].time : null })));
      const main = all.find(x => x.type === 'candlestick');
      return { ordinal: c.timeScale().isOrdinal(), all, main, ticks: c.timeTicks.map(t => t.text) };
    });
    const others = st.all.filter(x => x !== st.main && x.n > 0);
    check(st.ordinal && st.main.n > 10 && others.length >= 3 && others.every(x => x.last === st.main.last), 'widget Renko: ordinal axis; volume and indicators end on the last brick (computed on the bricks)', st.all);
    check(st.all.some(x => x.type === 'line' && x.n === 0), 'widget Renko: the compare line is kept but empty on a brick axis', st.all.map(x => x.n));
    check(st.ticks.length > 2 && st.ticks.some(t => /^[A-Z][a-z]{2} \d{4}$|^\d+ [A-Z][a-z]{2}$|^\d{4}$/.test(t)), 'widget Renko: brick axis labels', st.ticks);
    // A trend line anchored on two bricks (the virtual times of slots k and k + 8), then candles and back.
    const anchor = await page.evaluate(async () => {
      const W = window.__widget, ts = W.chart.timeScale();
      const main = W.chart.panes()[0].getSeries().find(s => s.seriesType() === 'candlestick');
      const n = main.data().length, k = n - 20;
      const pts = [k, k + 8].map(l => ({ time: ts.logicalToTime(l), price: main.data()[l].close }));
      const s = W.save();
      s.drawings = JSON.stringify({ format: 'chartist-lite-drawings', version: 2, drawings: [{ tool: 'trend', points: pts }] });
      await W.load(s);
      return { k, pts };
    });
    await page.waitForTimeout(900);
    const where = () => page.evaluate(() => { const W = window.__widget, ts = W.chart.timeScale(); const d = JSON.parse(W.save().drawings || '{"drawings":[]}').drawings; return { type: W.save().chartType, n: d.length, l: d.length ? d[0].points.map(p => ts.timeToLogical(p.time)) : [] }; });
    const onRenko = await where();
    await page.evaluate(() => window.__widget.setChartType('candles'));
    await page.waitForTimeout(500);
    const onCandles = await where();
    await page.evaluate(() => window.__widget.setChartType('renko'));
    await page.waitForTimeout(500);
    const back = await where();
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    check(onRenko.n === 1 && near(onRenko.l[0], anchor.k) && near(onRenko.l[1], anchor.k + 8), 'a drawing anchors on bricks by their one-to-one times', onRenko);
    check(onCandles.n === 1 && onCandles.l.every(Number.isFinite), 'switching to candles keeps the drawing, placed by source time', onCandles);
    check(back.n === 1 && near(back.l[0], anchor.k) && near(back.l[1], anchor.k + 8), 'back on Renko the drawing sits on the same bricks', back);
    // Go to date and a range key on bricks; the screenshot; save and restore of the brick type.
    const misc = await page.evaluate(async () => {
      const W = window.__widget, c = W.chart, ts = c.timeScale();
      await W.setRange('1Y');
      const r = ts.getVisibleLogicalRange();
      const blob = await W.screenshot(false);
      const saved = W.save();
      return { range: r, blob: blob ? blob.size : 0, type: saved.chartType };
    });
    check(misc.range && misc.range.to > misc.range.from && misc.blob > 1000 && misc.type === 'renko', 'widget Renko: range key, screenshot, saved chart type', misc);
    await calm(page);
    await page.screenshot({ path: path.join(out, 'widget-renko.png') });
  }
  await page.context().close();

  check(errors.length === 0, 'no page errors', errors.slice(0, 5));
  await browser.close();
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log('\nwidget checks passed');
})().catch(e => { console.error(e); process.exit(1); });
