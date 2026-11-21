// Browser checks of the drawing tools (examples/drawings.html) with real pointer input in Chromium: every tool created
// from the toolbar, move, handle resize, delete, undo, export / import, touch creation, keyboard-only horizontal line,
// the toolbar's roving focus, and light / dark screenshots (docs/screenshots/drawings-*.png). Needs Playwright importable
// here and a build (`npm run build`): `node scripts/screenshots-drawings.cjs`.
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
  const btn = label => page.locator('#chart [data-chartist-drawing-ui]').locator(`button[aria-label="${label}"]`);

  // Start from an empty chart.
  await page.evaluate(() => window.__demo.tools.clear());
  const tools = await page.evaluate(() => window.__demo.tools.tools().map(t => [t.id, t.label, t.points]));
  // Every tool from its toolbar button with real clicks (brush: a press, a move, a release).
  let made = 0;
  for (const [id, label, n] of tools) {
    await btn(label).click();
    const y0 = 0.3 + (made % 5) * 0.1;
    const x0 = 0.3 + Math.floor(made / 5) * 0.2;
    if (n === 0) {
      const a = at(x0, y0);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let k = 1; k <= 12; k++) await page.mouse.move(a.x + k * 6, a.y + Math.sin(k) * 8);
      await page.mouse.up();
    } else {
      for (let k = 0; k < n; k++) {
        const p = at(x0 + k * 0.06, y0 - k * 0.05);
        await page.mouse.click(p.x, p.y);
      }
    }
    if (id === 'text') {
      await page.waitForFunction(() => { const h = document.querySelector('#chart [data-chartist-drawing-ui]'); return h && h.shadowRoot.activeElement && h.shadowRoot.activeElement.tagName === 'INPUT'; });
      await page.keyboard.type('Note');
      await page.keyboard.press('Enter');
    }
    made++;
    const now = await count();
    check(now === made, `created a ${label.toLowerCase()} with the pointer`, now);
  }
  const texts = await page.evaluate(() => window.__demo.tools.drawings().filter(d => d.tool === 'text').map(d => d.text));
  check(texts[0] === 'Note', 'the text note editor takes typed text', texts);
  check(await page.evaluate(() => window.__demo.tools.tool()) === null, 'the tool returns to the cursor after a drawing');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: path.join(out, 'drawings-all-tools.png') });

  // Move a drawing by dragging its body, then resize it by a handle.
  await page.evaluate(() => { window.__demo.tools.clear(); window.__demo.tools.setMagnet(false); });
  await btn('Trend line').click();
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
  await btn('Redo').click();
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
  // Toolbar roving focus: Tab reaches one button; arrows move along the rail.
  await btn('Cursor').focus();
  await page.keyboard.press('ArrowDown');
  const focused = await page.evaluate(() => { const h = document.querySelector('#chart [data-chartist-drawing-ui]'); return h.shadowRoot.activeElement && h.shadowRoot.activeElement.getAttribute('aria-label'); });
  check(focused === 'Trend line', 'arrow keys move along the toolbar (roving tab index)', focused);
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => window.__demo.tools.tool()) === 'trend', 'Enter on a tool button arms it');
  await page.keyboard.press('Escape');
  await page.close();

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
