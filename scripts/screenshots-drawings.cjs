// Browser checks of the drawing tools (examples/drawings.html) with real pointer input in Chromium: every one of the 53
// tools created from the toolbar, move, handle resize, delete, undo, export / import, a text note's one undo step and
// its cancel, touch creation, keyboard-only horizontal line, the toolbar's roving focus, a phone-width chart with touch
// emulation (a selected drawing dragged vertically by a finger; style bar, flyout and editor inside the chart), a
// 260 x 220 chart, the drag cost of every tool at 20 drawings, and screenshots (docs/screenshots/drawings-*.png,
// drawings-all-tools.png is the gallery). Needs Playwright importable here and a build (`npm run build`):
// `node scripts/screenshots-drawings.cjs`.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const url = 'file://' + path.join(root, 'examples', 'drawings.html');
const failures = [];
const check = (ok, what, detail) => { if (!ok) failures.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

(async () => {
  if (!fs.existsSync(path.join(root, 'dist', 'chartist-lite-drawings.iife.min.js'))) throw new Error('run `npm run build` first');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(300);
  const box = await page.locator('#chart').boundingBox();
  const plot = await page.evaluate(() => ({ w: window.__demo.chart.timeScale().width(), h: window.__demo.chart.panes()[0].getHeight() }));
  const at = (fx, fy) => ({ x: box.x + 1 + plot.w * fx, y: box.y + 1 + plot.h * fy });
  const count = () => page.evaluate(() => window.__demo.tools.drawings().length);
  const ui = () => page.locator('#chart [data-chartist-drawing-ui]');
  const btn = label => ui().locator(`button[aria-label="${label}"]`);
  // Arm a tool the way a person would: its group button, or the group's flyout (opened from the corner mark).
  const groups = await page.evaluate(() => null);
  const pickTool = async (id, label, pg = page) => {
    const u = pg.locator('#chart [data-chartist-drawing-ui]');
    // In a flyout: open each group's menu from its corner mark until the tool is listed (exact name).
    for (const b of await u.locator('button[aria-haspopup="menu"]').all()) {
      const r = await b.boundingBox();
      await pg.mouse.click(r.x + r.width - 4, r.y + r.height - 4);
      const items = await u.locator('[role="menu"] [role="menuitemradio"]').all();
      for (const it of items) {
        const name = await it.evaluate(el => el.children[1].textContent);
        if (name === label) {
          await it.scrollIntoViewIfNeeded();
          await it.click();
          if (await pg.evaluate(() => window.__demo.tools.tool()) !== id) throw new Error(`picked ${label} but ${await pg.evaluate(() => window.__demo.tools.tool())} is armed`);
          return;
        }
      }
      await pg.mouse.click(r.x + r.width - 4, r.y + r.height - 4); // close it again
    }
    throw new Error(`no way to arm ${label}`);
  };
  void groups;

  // Start from an empty chart.
  await page.evaluate(() => window.__demo.tools.clear());
  const tools = await page.evaluate(() => window.__demo.tools.tools().map(t => [t.id, t.label, t.points]));
  check(tools.length === 53, 'the example offers all 53 tools', tools.length);
  // Every tool from its toolbar flyout with real clicks (freehand: a press, moves, a release; a path: clicks, then a
  // double click). Each is checked, then cleared, so the next one starts on an empty chart.
  const editorOpen = () => page.waitForFunction(() => { const h = document.querySelector('#chart [data-chartist-drawing-ui]'); return h && h.shadowRoot.activeElement && h.shadowRoot.activeElement.tagName === 'INPUT'; });
  for (const [id, label, n, open, hasText] of await page.evaluate(() => window.__demo.tools.tools().map(t => [t.id, t.label, t.points, !!t.open, t.text !== undefined]))) {
    await pickTool(id, label);
    if (n === 0) {
      const a = at(0.4, 0.5);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let k = 1; k <= 14; k++) await page.mouse.move(a.x + k * 8, a.y + Math.sin(k / 2) * 18);
      await page.mouse.up();
    } else if (open) {
      for (let k = 0; k < 3; k++) { const p = at(0.35 + k * 0.08, 0.5 - (k % 2) * 0.12); await page.mouse.click(p.x, p.y); }
      const p = at(0.59, 0.4);
      await page.mouse.dblclick(p.x, p.y);
    } else {
      const pts = [[0.4, 0.55], [0.55, 0.4], [0.62, 0.6], [0.7, 0.45]];
      for (let k = 0; k < n; k++) { const p = at(pts[k][0], pts[k][1]); await page.mouse.click(p.x, p.y); }
    }
    if (hasText) { await editorOpen(); await page.keyboard.type('Note'); await page.keyboard.press('Enter'); }
    const got = await page.evaluate(() => window.__demo.tools.drawings().map(d => ({ tool: d.tool, n: d.points.length, text: d.text })));
    const want = open ? 4 : n === 0 ? null : (id === 'long' || id === 'short') ? 3 : n;
    check(got.length === 1 && got[0].tool === id && (want === null || got[0].n === want) && (!hasText || got[0].text === 'Note'), `created a ${label.toLowerCase()} with the pointer`, got);
    check(await page.evaluate(() => window.__demo.tools.tool()) === null, `${label}: back to the cursor after the drawing`);
    await page.evaluate(() => window.__demo.tools.clear());
  }

  // A text note: one undo step (placing and typing), and a cancelled note leaves nothing.
  await page.evaluate(() => { const t = window.__demo.tools; t.importJSON(t.exportJSON()); });
  await pickTool('text', 'Text note');
  let p0 = at(0.5, 0.5);
  await page.mouse.click(p0.x, p0.y);
  await editorOpen();
  await page.keyboard.type('One');
  await page.keyboard.press('Enter');
  const one = await page.evaluate(() => { const t = window.__demo.tools; const n = t.drawings().length; t.undo(); return { n, after: t.drawings().length }; });
  check(one.n === 1 && one.after === 0, 'placing and typing a note is one undo step', one);
  await pickTool('text', 'Text note');
  await page.mouse.click(p0.x, p0.y);
  await editorOpen();
  await page.keyboard.press('Escape');
  const cancelled = await page.evaluate(() => ({ n: window.__demo.tools.drawings().length, redo: window.__demo.tools.canRedo() }));
  check(cancelled.n === 0, 'a cancelled note leaves no empty note behind', cancelled);

  // Move a drawing by dragging its body, then resize it by a handle.
  await page.evaluate(() => { window.__demo.tools.clear(); window.__demo.tools.setMagnet(false); });
  await pickTool('trend', 'Trend line');
  const a = at(0.3, 0.5), b = at(0.5, 0.5);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  const before = await page.evaluate(() => window.__demo.tools.drawings()[0].points);
  await page.mouse.move(a.x + 80, a.y); await page.mouse.down(); await page.mouse.move(a.x + 80, a.y + 60, { steps: 6 }); await page.mouse.up();
  const moved = await page.evaluate(() => window.__demo.tools.drawings()[0].points);
  check(moved[0].price < before[0].price && moved[1].price < before[1].price, 'dragging the body moves the drawing', [before[0].price, moved[0].price]);
  await page.mouse.move(b.x, b.y + 60); await page.mouse.down(); await page.mouse.move(b.x + 60, b.y + 120, { steps: 6 }); await page.mouse.up();
  const resized = await page.evaluate(() => window.__demo.tools.drawings()[0].points);
  check(resized[0].price === moved[0].price && resized[1].time > moved[1].time, 'dragging a handle moves only that point', resized);
  // Undo twice brings back the original line; redo once.
  await page.locator('#chart [role="application"]').focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  const undone = await page.evaluate(() => window.__demo.tools.drawings()[0].points);
  check(JSON.stringify(undone) === JSON.stringify(before), 'undo restores the drawing', undone);
  await ui().locator('button[aria-label^="Redo"]').click();
  const redone = await page.evaluate(() => window.__demo.tools.drawings()[0].points);
  check(JSON.stringify(redone) === JSON.stringify(moved), 'redo from the toolbar', redone);
  // Delete with the key, export / import.
  const json = await page.evaluate(() => window.__demo.tools.exportJSON());
  await page.evaluate(() => { const t = window.__demo.tools; t.select(t.drawings()[0].id); });
  await page.locator('#chart [role="application"]').focus();
  await page.keyboard.press('Delete');
  check(await count() === 0, 'Delete removes the selected drawing');
  const loaded = await page.evaluate(j => window.__demo.tools.importJSON(j), json);
  check(loaded === 1 && await count() === 1, 'import of the export brings it back', loaded);
  // Delete all asks for a second click.
  await btn('Delete all drawings').click();
  check(await count() === 1, 'delete all waits for a confirming click');
  await btn('Click again to delete all drawings').click();
  check(await count() === 0, 'the second click deletes all');

  // Keyboard only: focus the chart, Shift + H, arrows nudge it, Delete.
  await page.locator('#chart [role="application"]').focus();
  await page.keyboard.press('Shift+H');
  const kb = await page.evaluate(() => window.__demo.tools.drawings());
  check(kb.length === 1 && kb[0].tool === 'horizontal', 'Shift + H adds a horizontal line from the keyboard', kb[0] && kb[0].points);
  await page.keyboard.press('ArrowUp');
  const nudged = await page.evaluate(() => window.__demo.tools.drawings()[0].points[0].price);
  check(Math.abs(nudged - kb[0].points[0].price - 0.01) < 1e-9, 'ArrowUp nudges the selected line by one tick', nudged);
  // Toolbar roving focus: one tab stop; arrows move along the rail; ArrowRight opens a group's flyout.
  await ui().locator('button[aria-label^="Cursor"]').focus();
  await page.keyboard.press('ArrowDown');
  const active = () => page.evaluate(() => { const h = document.querySelector('#chart [data-chartist-drawing-ui]'); const a = h.shadowRoot.activeElement; return a && (a.getAttribute('aria-label') || a.textContent); });
  const focused = await active();
  check(/^Lines/.test(focused), 'arrow keys move along the toolbar (roving tab index)', focused);
  await page.keyboard.press('ArrowRight');
  const menuOpen = await page.evaluate(() => { const h = document.querySelector('#chart [data-chartist-drawing-ui]'); const m = h.shadowRoot.querySelector('[role="menu"]'); return { shown: getComputedStyle(m).display !== 'none', items: m.querySelectorAll('[role="menuitemradio"]').length, focus: h.shadowRoot.activeElement && h.shadowRoot.activeElement.getAttribute('role') }; });
  check(menuOpen.shown && menuOpen.items === 10 && menuOpen.focus === 'menuitemradio', 'ArrowRight opens the Lines flyout with focus in it', menuOpen);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => window.__demo.tools.tool()) === 'ray', 'a flyout item picked by keyboard arms that tool', await page.evaluate(() => window.__demo.tools.tool()));
  const after = await active();
  check(/Ray/.test(after), 'the flyout closes and focus returns to the group button, now showing the picked tool', after);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => { const h = document.querySelector('#chart [data-chartist-drawing-ui]'); return getComputedStyle(h.shadowRoot.querySelector('[role="menu"]')).display; });
  check(closed === 'none' && /^Lines/.test(await active()), 'Escape closes the flyout and returns focus');
  // By pointer: press and hold the Shapes button opens its flyout; a click on an item arms it.
  const shapes = ui().locator('button[aria-label^="Shapes"]');
  const sb = await shapes.boundingBox();
  await page.mouse.move(sb.x + 10, sb.y + 10);
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.mouse.up();
  const shapeItems = ui().locator('[role="menu"] [role="menuitemradio"]');
  check(await shapeItems.count() === 7, 'press and hold opens a flyout', await shapeItems.count());
  const inBox = await page.evaluate(() => { const h = document.querySelector('#chart [data-chartist-drawing-ui]'); const m = h.shadowRoot.querySelector('[role="menu"]').getBoundingClientRect(); const c = document.querySelector('#chart').getBoundingClientRect(); return m.left >= c.left && m.right <= c.right && m.top >= c.top && m.bottom <= c.bottom; });
  check(inBox, 'the flyout is inside the chart box');
  await page.screenshot({ path: path.join(out, 'drawings-flyout.png') });
  await shapeItems.filter({ hasText: 'Ellipse' }).click();
  check(await page.evaluate(() => window.__demo.tools.tool()) === 'ellipse', 'a flyout item picked by pointer arms that tool');
  // Single-key shortcuts while the chart has focus.
  await page.locator('#chart [role="application"]').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  check(await page.evaluate(() => window.__demo.tools.tool()) === 'fib', 'F arms the Fibonacci tool from the keyboard');
  await page.keyboard.press('Escape');
  await page.close();

  // A short pane: one column that scrolls inside itself, never a second column.
  const short = await browser.newPage({ viewport: { width: 900, height: 420 } });
  short.on('pageerror', e => errors.push(e.message));
  await short.goto(url);
  await short.addStyleTag({ content: '#chart { height: 288px !important; }' });
  await short.waitForTimeout(400);
  const fit = await short.evaluate(() => {
    window.__demo.chart.paint();
    const h = document.querySelector('#chart [data-chartist-drawing-ui]');
    const rail = h.shadowRoot.querySelector('[role="toolbar"]');
    const xs = [...rail.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().left));
    return { pane: window.__demo.chart.panes()[0].getHeight(), columns: new Set(xs).size, railH: rail.getBoundingClientRect().height, scrolls: rail.scrollHeight > rail.clientHeight };
  });
  check(fit.pane <= 260 && fit.columns === 1 && fit.scrolls && fit.railH <= fit.pane, 'in a 260 px pane the rail stays one column and scrolls inside itself', fit);
  await short.screenshot({ path: path.join(out, 'drawings-short-pane.png') });
  await short.close();

  // Touch: a horizontal line from a tap is placed above the finger.
  const touch = await browser.newPage({ viewport: { width: 900, height: 620 }, hasTouch: true, isMobile: true });
  touch.on('pageerror', e => errors.push(e.message));
  await touch.goto(url);
  await touch.waitForTimeout(300);
  await touch.evaluate(() => { window.__demo.tools.clear(); window.__demo.tools.setMagnet(false); window.__demo.tools.setTool('horizontal'); });
  const tb = await touch.locator('#chart').boundingBox();
  const tx = tb.x + tb.width * 0.5, ty = tb.y + 300;
  await touch.touchscreen.tap(tx, ty);
  const tr = await touch.evaluate(([y]) => {
    const { tools, candles, chart } = window.__demo;
    const d = tools.drawings()[0];
    return { price: d && d.points[0].price, under: candles.coordinateToPrice(y), lifted: candles.coordinateToPrice(y - 36), touchAction: chart.element().style.touchAction };
  }, [300 - 1]);
  check(tr.price !== undefined && Math.abs(tr.price - tr.lifted) < Math.abs(tr.price - tr.under), 'on touch the point is placed above the finger', tr);
  await touch.close();

  // Phone width with touch emulation: a tap selects a drawing, a finger drags it vertically (touch-action is none while
  // something is selected), and the style bar, a flyout and the text editor stay inside the chart.
  const phone = await browser.newPage({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(url);
  await phone.addStyleTag({ content: 'body { padding: 8px; } #chart { height: 460px !important; }' });
  await phone.waitForTimeout(400);
  const inside = (pg, sel) => pg.evaluate(s => {
    const h = document.querySelector('#chart [data-chartist-drawing-ui]');
    const els = [...h.shadowRoot.querySelectorAll(s)].filter(e => getComputedStyle(e).display !== 'none');
    const c = document.querySelector('#chart').getBoundingClientRect();
    return els.length > 0 && els.every(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5; });
  }, sel);
  const hline = await phone.evaluate(() => {
    const { tools, chart, candles } = window.__demo;
    tools.clear(); tools.setMagnet(false);
    const d = tools.add({ tool: 'horizontal', points: [{ time: window.__demo.bars[390].time, price: window.__demo.bars[399].close }] });
    const c = chart.element().getBoundingClientRect();
    return { id: d.id, price: d.points[0].price, x: c.left + chart.priceScale('left').width() + chart.timeScale().width() / 2, y: c.top + candles.priceToCoordinate(d.points[0].price) };
  });
  await phone.touchscreen.tap(hline.x, hline.y);
  const sel = await phone.evaluate(() => ({ sel: window.__demo.tools.selected() && window.__demo.tools.selected().id, ta: window.__demo.chart.element().style.touchAction }));
  check(sel.sel === hline.id && sel.ta === 'none', 'a tap selects the drawing; touch-action is none while it is selected', sel);
  const cdp = await phone.context().newCDPSession(phone);
  const finger = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await finger('touchStart', hline.x, hline.y);
  for (let k = 1; k <= 8; k++) await finger('touchMove', hline.x, hline.y + k * 8);
  await finger('touchEnd');
  const dragged = await phone.evaluate(() => window.__demo.tools.drawings()[0].points[0].price);
  check(dragged < hline.price, 'a finger drags the selected line down (vertical drag is not taken by the page scroll)', { before: hline.price, after: dragged });
  await phone.waitForTimeout(100);
  check(await inside(phone, '[role="toolbar"][aria-label="Drawing style"]'), 'at 390 px the style bar (compact) is inside the chart');
  await phone.screenshot({ path: path.join(out, 'drawings-phone.png') });
  const annotate = phone.locator('#chart [data-chartist-drawing-ui] button[aria-label^="Annotate"]');
  await annotate.scrollIntoViewIfNeeded();
  await phone.waitForTimeout(150);
  const ab = await annotate.boundingBox();
  await phone.touchscreen.tap(ab.x + ab.width - 4, ab.y + ab.height - 4);
  await phone.waitForTimeout(100);
  check(await inside(phone, '[role="menu"]'), 'at 390 px the Annotate flyout (11 tools) is inside the chart', await phone.evaluate(() => { const m = document.querySelector('#chart [data-chartist-drawing-ui]').shadowRoot.querySelector('[role="menu"]').getBoundingClientRect(); return [m.top, m.bottom, m.height]; }));
  await phone.screenshot({ path: path.join(out, 'drawings-phone-flyout.png') });
  await phone.locator('#chart [data-chartist-drawing-ui] [role="menuitemradio"]', { hasText: 'Text note' }).first().tap();
  const right = await phone.evaluate(() => { const c = window.__demo.chart.element().getBoundingClientRect(); return { x: c.right - 70, y: c.top + 40 }; });
  await phone.touchscreen.tap(right.x, right.y + 36);
  await phone.waitForTimeout(150);
  check(await inside(phone, 'input'), 'at 390 px the text editor near the right edge is inside the chart');
  await phone.keyboard.press('Escape');
  await phone.close();

  // A 260 x 220 chart: compact style bar, its panel, a flyout and the editor all inside.
  const tiny = await browser.newPage({ viewport: { width: 400, height: 400 } });
  tiny.on('pageerror', e => errors.push(e.message));
  await tiny.goto(url);
  await tiny.addStyleTag({ content: '#chart { width: 260px !important; height: 220px !important; }' });
  await tiny.waitForTimeout(400);
  await tiny.evaluate(() => { const t = window.__demo.tools; t.select(t.drawings()[2].id); });
  await tiny.waitForTimeout(100);
  check(await inside(tiny, '[role="toolbar"][aria-label="Drawing style"]'), '260 x 220: the compact style bar is inside the chart');
  await tiny.locator('#chart [data-chartist-drawing-ui] button[aria-label="More style options"]').click();
  check(await inside(tiny, '[role="group"][aria-label="Drawing style options"]'), '260 x 220: the style panel wraps inside the chart');
  await tiny.locator('#chart [data-chartist-drawing-ui] [role="group"] button[aria-label="Red"]').click();
  check(await tiny.evaluate(() => window.__demo.tools.selected().style.color) === await tiny.evaluate(() => window.ChartistLite.lightTheme.down), 'the compact panel sets the colour');
  await tiny.screenshot({ path: path.join(out, 'drawings-tiny.png') });
  await tiny.evaluate(() => window.__demo.tools.select(null));
  const fib = tiny.locator('#chart [data-chartist-drawing-ui] button[aria-label^="Fibonacci"]');
  await fib.scrollIntoViewIfNeeded();
  await tiny.waitForTimeout(150);
  const fb = await fib.boundingBox();
  await tiny.mouse.click(fb.x + fb.width - 4, fb.y + fb.height - 4);
  check(await inside(tiny, '[role="menu"]'), '260 x 220: a flyout of nine tools fits inside (it scrolls)');
  await tiny.screenshot({ path: path.join(out, 'drawings-tiny-flyout.png') });
  await tiny.mouse.click(fb.x + fb.width - 4, fb.y + fb.height - 4); // the corner mark closes it again
  await tiny.evaluate(() => window.__demo.tools.setTool('text'));
  const tb2 = await tiny.locator('#chart').boundingBox();
  await tiny.mouse.click(tb2.x + tb2.width - 80, tb2.y + 120);
  await tiny.waitForTimeout(100);
  check(await inside(tiny, 'input'), '260 x 220: the text editor is inside the chart');
  await tiny.close();

  // Drag cost per tool at 20 drawings: the drawing handler's move plus a synchronous paint (script cost only,
  // rasterisation not included), measured on the production build.
  const bench = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  bench.on('pageerror', e => errors.push(e.message));
  await bench.goto(url);
  await bench.waitForTimeout(300);
  const perf = await bench.evaluate(() => {
    const { chart, candles, tools, bars } = window.__demo;
    const h = chart.pointerHandlers().find(x => x.blocksTouch);
    const ts = chart.timeScale();
    const out = {};
    const N = bars.length;
    for (const t of tools.tools()) {
      tools.clear();
      tools.setMagnet(false);
      const n = t.points === 0 ? 40 : t.open ? 5 : t.points;
      for (let k = 0; k < 20; k++) {
        const pts = Array.from({ length: n }, (_, i) => { const b = bars[N - 160 + k * 4 + i * (t.points === 0 ? 1 : 6)]; return { time: b.time, price: b.close * (1 + (i % 2 ? 0.02 : -0.01)) }; });
        tools.add({ tool: t.id, points: pts, text: 'Note', options: t.id === 'anchoredVwap' ? { bands: [1, 2] } : undefined });
      }
      const d = tools.drawings()[19];
      const p = d.points[0];
      const l = ts.timeToLogical(p.time);
      // Press on its first handle (or the body): select it, then drag.
      tools.select(d.id);
      const hs = { x: ts.logicalToCoordinate(l), y: candles.priceToCoordinate(p.price) };
      const ev = (x, y) => ({ point: { x, y }, paneIndex: 0, logical: ts.coordinateToLogical(x), area: 'pane', pointerType: 'mouse', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false });
      if (!h.pointerDown(ev(hs.x, hs.y))) { out[t.id] = null; continue; }
      const times = [];
      for (let k = 1; k <= 60; k++) {
        const t0 = performance.now();
        h.pointerMove(ev(hs.x + k * 2, hs.y + Math.sin(k / 5) * 30));
        chart.paint();
        times.push(performance.now() - t0);
        // Rasterise outside the timing (as scripts/bench.cjs does): read one pixel of each canvas.
        for (const c of chart.element().querySelectorAll('canvas')) c.getContext('2d').getImageData(0, 0, 1, 1);
      }
      h.pointerUp(ev(hs.x + 120, hs.y), false);
      times.sort((a, b) => a - b);
      out[t.id] = { p95: +times[Math.floor(times.length * 0.95)].toFixed(2), max: +times[times.length - 1].toFixed(2) };
    }
    tools.clear();
    return out;
  });
  const worst = Object.entries(perf).filter(([, v]) => v).sort((a, b) => b[1].p95 - a[1].p95);
  console.log('drag cost per tool, 20 drawings (p95 ms, script only):', JSON.stringify(Object.fromEntries(worst.map(([k, v]) => [k, v.p95]))));
  check(Object.values(perf).every(v => v !== null), 'every tool can be pressed and dragged', Object.entries(perf).filter(([, v]) => !v).map(([k]) => k));
  check(worst.length && worst[0][1].p95 < 8.33, 'dragging any tool at 20 drawings stays under 8.33 ms p95 (script cost only)', worst.slice(0, 3));
  await bench.close();

  // The gallery: every tool drawn on its own small chart (docs/screenshots/drawings-all-tools.png), light 1x, dark 2x.
  for (const [theme, scale] of [['light', 1], ['dark', 2]]) {
    const g = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: scale });
    g.on('pageerror', e => errors.push(e.message));
    await g.goto(url + `?gallery&theme=${theme}`);
    await g.waitForTimeout(700);
    const bad = await g.evaluate(() => window.__gallery.filter(x => !x.ok || x.tools.drawings().length !== 1).map(x => x.id));
    check(bad.length === 0, `gallery (${theme}): all 53 tools drawn`, bad);
    await g.screenshot({ path: path.join(out, theme === 'light' ? 'drawings-all-tools.png' : 'drawings-all-tools-dark.png'), fullPage: true });
    await g.close();
  }

  // Screenshots, light and dark, with a selection.
  for (const theme of ['light', 'dark']) {
    const p = await browser.newPage({ viewport: { width: 1100, height: 680 }, deviceScaleFactor: 2 });
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(url);
    await p.waitForTimeout(300);
    if (theme === 'dark') await p.click('#theme');
    await p.evaluate(() => { const t = window.__demo.tools; t.select(t.drawings()[2].id); });
    await p.mouse.move(5, 5);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(out, `drawings-${theme}.png`) });
    await p.close();
  }
  await browser.close();
  if (errors.length) { console.error('console problems:\n' + errors.join('\n')); failures.push('console errors'); }
  if (failures.length) { console.error(`${failures.length} check(s) failed`); process.exit(1); }
  console.log('all drawing checks passed; no console errors');
})().catch(e => { console.error(e); process.exit(1); });
