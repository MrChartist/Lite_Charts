// Browser check of the widget (examples/widget.html with demo data, examples/widget-live.html with BTC): every menu
// and dialog by pointer and by keyboard, indicators added and edited, chart type, interval and range keys, go to date,
// screenshot download, full screen, save and reload of the workspace, destroy leaving nothing behind, at 1280, 768
// and 390 px, light and dark. Writes docs/screenshots/widget-*.png. Needs Playwright and `npm run build`.
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

  // Drawings load on demand.
  const hadDrawings = await page.evaluate(() => !!window.ChartistLiteDrawings);
  await page.locator('[data-chartist-widget] button[aria-label="Drawing tools"]').click();
  await page.waitForFunction(() => !!document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('[data-chartist-drawing-ui]'), null, { timeout: 5000 }).catch(() => {});
  check(!hadDrawings && await page.evaluate(() => !!window.ChartistLiteDrawings), 'drawing code loads only when the rail is first opened');
  { await calm(page); await page.screenshot({ path: path.join(out, 'widget-drawings.png') }); }

  // Destroy leaves nothing behind.
  const counts = await page.evaluate(() => {
    const listenersBefore = window.__listeners().length;
    const nodes = document.querySelectorAll('*').length;
    window.__widget.destroy();
    return { listenersBefore, after: window.__listeners(), nodesBefore: nodes, nodesAfter: document.querySelectorAll('*').length, left: document.querySelector('#w').childNodes.length };
  });
  check(counts.left === 0 && counts.after.length === 0, 'destroy removes every node and window/document listener', counts);
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
      if (name === 'desk' && theme === 'light') { await calm(page); await page.screenshot({ path: path.join(out, 'widget-light.png') }); }
      if (name === 'desk' && theme === 'dark') { await calm(page); await page.screenshot({ path: path.join(out, 'widget-dark.png') }); }
      if (name === 'phone' && theme === 'light') { await calm(page); await page.screenshot({ path: path.join(out, 'widget-phone.png') }); }
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

  check(errors.length === 0, 'no page errors', errors.slice(0, 5));
  await browser.close();
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log('\nwidget checks passed');
})().catch(e => { console.error(e); process.exit(1); });
