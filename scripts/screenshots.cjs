// Screenshots and a smoke run of examples/basic.html in Chromium (light and dark, deviceScaleFactor 1 and 2).
// Needs Playwright importable from this machine (it is NOT a dev dependency): `node scripts/screenshots.cjs`.
// Exercises wheel zoom, drag pan, keyboard, update() and the crosshair, and fails on any console error.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const url = 'file://' + path.join(root, 'examples', 'basic.html');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const report = {};
  for (const dsf of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 960, height: 560 }, deviceScaleFactor: dsf });
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
    await page.goto(url);
    await page.waitForTimeout(300);
    const box = await page.locator('#chart').boundingBox();
    const suffix = dsf === 1 ? '' : `@${dsf}x`;
    await page.screenshot({ path: path.join(out, `basic-light${suffix}.png`) });

    if (dsf === 1) {
      const before = await page.evaluate(() => window.__demo.chart.timeScale().getVisibleLogicalRange());
      // Wheel zoom in at the middle of the plot.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(100);
      const zoomed = await page.evaluate(() => window.__demo.chart.timeScale().getVisibleLogicalRange());
      // Drag pan to the right (shows older bars).
      await page.mouse.move(box.x + 300, box.y + 200);
      await page.mouse.down();
      await page.mouse.move(box.x + 500, box.y + 210, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const panned = await page.evaluate(() => window.__demo.chart.timeScale().getVisibleLogicalRange());
      // Keyboard: End returns to the live edge.
      await page.locator('#chart [role="application"]').focus();
      await page.keyboard.press('End');
      await page.waitForTimeout(100);
      const ended = await page.evaluate(() => window.__demo.chart.timeScale().scrollPosition());
      // update(): replace the last bar, then append a new one.
      const upd = await page.evaluate(() => {
        const { candles, bars } = window.__demo;
        const n0 = candles.data().length;
        const last = bars[bars.length - 1];
        candles.update({ ...last, close: last.close + 1, high: Math.max(last.high, last.close + 1) });
        const n1 = candles.data().length;
        candles.update({ time: '2026-12-31', open: last.close, high: last.close + 2, low: last.close - 1, close: last.close + 1.5 });
        const n2 = candles.data().length;
        return { n0, n1, n2, lastClose: candles.data()[n2 - 1].close };
      });
      // Crosshair over the plot, and the event payload.
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
      await page.waitForTimeout(100);
      const legend = await page.textContent('#legend');
      await page.screenshot({ path: path.join(out, 'basic-light-crosshair.png') });
      const shot = await page.evaluate(() => { const c = window.__demo.chart.takeScreenshot(); return [c.width, c.height]; });
      report.interaction = { before, zoomed, panned, ended, upd, legend, shot };
      // Scale modes and an overlay scale anchored to the bottom 20% of the pane.
      report.scales = await page.evaluate(() => {
        const { chart, candles, bars } = window.__demo;
        const out = {};
        const vol = chart.addSeries(ChartistLite.LineSeries, { priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        vol.setData(bars.map((b, i) => ({ time: b.time, value: 1000 + (i % 7) * 100 })));
        chart.timeScale().setVisibleLogicalRange({ from: 500, to: 540 });
        chart.paint();
        const h = chart.timeScale().width() > 0 ? chart.element().clientHeight - 28 : 0;
        out.volTopY = Math.round(vol.priceToCoordinate(1600));
        out.volBottomY = Math.round(vol.priceToCoordinate(1000));
        out.paneH = h;
        chart.removeSeries(vol);
        for (const mode of ['log', 'percent', 'linear']) {
          chart.priceScale().applyOptions({ mode });
          chart.paint();
          out[mode] = [candles.priceToCoordinate(140), candles.coordinateToPrice(100)];
        }
        return out;
      });

      await page.click('#theme');
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(out, 'basic-dark-crosshair.png') });
      await page.mouse.move(5, 5);
      await page.evaluate(() => { window.__demo.chart.timeScale().resetTimeScale(); });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(out, 'basic-dark.png') });
    } else {
      await page.click('#theme');
      await page.mouse.move(5, 5);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(out, `basic-dark${suffix}.png`) });
    }
    await page.close();
  }

  // 100k bars: time a burst of pans in the page.
  const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  report.perf = await page.evaluate(async () => {
    const { chart, candles } = window.__demo;
    const rows = [];
    let c = 100;
    for (let i = 0; i < 100000; i++) {
      const o = c; c = Math.max(1, c * (1 + Math.sin(i * 0.37) * 0.01));
      rows.push({ time: 1500000000 + i * 60, open: o, high: Math.max(o, c) + 0.2, low: Math.min(o, c) - 0.2, close: c });
    }
    window.__demo.avg.setData([]);
    let t0 = performance.now();
    candles.setData(rows);
    chart.timeScale().fitContent();
    chart.paint();
    const setDataMs = performance.now() - t0;
    const ts = chart.timeScale();
    const frames = [];
    for (let k = 0; k < 60; k++) {
      t0 = performance.now();
      ts.setVisibleLogicalRange({ from: 40000 + k * 50, to: 42000 + k * 50 });
      chart.paint();
      frames.push(performance.now() - t0);
    }
    const zoomedOut = [];
    for (let k = 0; k < 20; k++) {
      t0 = performance.now();
      ts.setVisibleLogicalRange({ from: k * 10, to: 99999 });
      chart.paint();
      zoomedOut.push(performance.now() - t0);
    }
    frames.sort((a, b) => a - b);
    zoomedOut.sort((a, b) => a - b);
    return { setDataMs: +setDataMs.toFixed(1), panMedianMs: +frames[30].toFixed(2), panMaxMs: +frames[59].toFixed(2), allBarsMedianMs: +zoomedOut[10].toFixed(2), visible: ts.getVisibleLogicalRange() };
  });
  await page.screenshot({ path: path.join(out, 'perf-100k.png') });
  report.perfFit = await page.evaluate(() => {
    const { chart } = window.__demo;
    const ts = chart.timeScale();
    const frames = [];
    for (let k = 0; k < 30; k++) {
      const t0 = performance.now();
      ts.fitContent();
      chart.paint();
      frames.push(performance.now() - t0);
    }
    frames.sort((a, b) => a - b);
    return { fitAllMedianMs: +frames[15].toFixed(2), fitAllMaxMs: +frames[29].toFixed(2), visible: ts.getVisibleLogicalRange() };
  });
  await page.screenshot({ path: path.join(out, 'perf-100k-fit.png') });
  await page.close();

  // Two panes: price + volume + left-scale benchmark above, RSI below.
  const purl = 'file://' + path.join(root, 'examples', 'panes.html');
  const pp = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  pp.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  pp.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  await pp.goto(purl);
  await pp.waitForTimeout(300);
  await pp.screenshot({ path: path.join(out, 'panes-light.png') });
  const cbox = await pp.locator('#chart').boundingBox();
  report.panes = {};
  report.panes.before = await pp.evaluate(() => window.__demo.chart.panes().map(p => p.getHeight()));
  report.panes.leftWidth = await pp.evaluate(() => window.__demo.chart.priceScale('left').width());
  // Drag the divider up by 60 px.
  const div = pp.locator('[role="separator"]');
  const dbox = await div.boundingBox();
  await pp.mouse.move(dbox.x + 200, dbox.y + dbox.height / 2);
  await pp.mouse.down();
  await pp.mouse.move(dbox.x + 200, dbox.y + dbox.height / 2 - 60, { steps: 6 });
  await pp.mouse.up();
  await pp.waitForTimeout(100);
  report.panes.afterDrag = await pp.evaluate(() => window.__demo.chart.panes().map(p => p.getHeight()));
  await div.focus();
  await pp.keyboard.press('ArrowDown');
  await pp.waitForTimeout(100);
  report.panes.afterKey = await pp.evaluate(() => window.__demo.chart.panes().map(p => p.getHeight()));
  report.panes.dividerValue = await div.getAttribute('aria-valuenow');
  // Crosshair over the RSI pane, then keyboard inspect mode with the live region.
  await pp.mouse.move(cbox.x + 500, cbox.y + cbox.height - 70);
  await pp.waitForTimeout(100);
  await pp.screenshot({ path: path.join(out, 'panes-light-crosshair.png') });
  await pp.locator('#chart [role="application"]').focus();
  await pp.keyboard.press('Enter');
  await pp.keyboard.press('ArrowLeft');
  await pp.keyboard.press('ArrowLeft');
  await pp.waitForTimeout(100);
  report.panes.live = await pp.evaluate(() => document.querySelector('#chart [aria-live]').textContent);
  report.panes.describedBy = await pp.evaluate(() => { const r = document.querySelector('#chart [role="application"]'); return document.getElementById(r.getAttribute('aria-describedby')).textContent; });
  await pp.keyboard.press('Home');
  await pp.waitForTimeout(100);
  report.panes.liveHome = await pp.evaluate(() => document.querySelector('#chart [aria-live]').textContent);
  await pp.keyboard.press('Escape');
  // Removing the RSI series removes its pane.
  report.panes.afterRemove = await pp.evaluate(() => { const d = window.__demo; d.chart.removeSeries(d.rsiLine); d.chart.paint(); const n = d.chart.panes().length;
    d.rsiLine = d.chart.addSeries(ChartistLite.LineSeries, { title: 'RSI 14' }, 1); d.rsiLine.setData(d.bars.map(b => ({ time: b.time, value: 50 }))); return n; });
  await pp.reload();
  await pp.waitForTimeout(200);
  await pp.click('#theme');
  await pp.mouse.move(cbox.x + 500, cbox.y + 200);
  await pp.waitForTimeout(150);
  await pp.screenshot({ path: path.join(out, 'panes-dark-crosshair.png') });
  await pp.mouse.move(2, 2);
  await pp.click('#fit');
  await pp.mouse.move(2, 2);
  await pp.waitForTimeout(150);
  await pp.screenshot({ path: path.join(out, 'panes-dark.png') });
  await pp.close();
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('no console errors');
})().catch(e => { console.error(e); process.exit(1); });
