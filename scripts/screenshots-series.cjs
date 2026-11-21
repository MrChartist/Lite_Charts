// Screenshots of examples/series.html (all six series types, price lines and markers) in light and dark, at device
// scale 2, plus a DPR 1 pass; fails on any console error. Needs Playwright importable on this machine (it is NOT a
// dev dependency): `npm run build && node scripts/screenshots-series.cjs`.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const url = 'file://' + path.join(root, 'examples', 'series.html');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  for (const dsf of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 740 }, deviceScaleFactor: dsf });
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
    await page.goto(url);
    await page.waitForTimeout(300);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => window.__series.setTheme(t), theme);
      await page.evaluate(() => window.__series.charts.forEach(c => c.paint()));
      await page.waitForTimeout(150);
      // The DPR 2 shots are the published ones; DPR 1 ones keep an "@1x" suffix for a crispness check.
      const file = dsf === 2 ? `series-${theme}.png` : `series-${theme}@1x.png`;
      await page.screenshot({ path: path.join(out, file) });
    }
    if (dsf === 2) {
      // Interaction smoke: zoom far out and in on the bar chart, change a price line, swap markers.
      const info = await page.evaluate(() => {
        const s = window.__series;
        s.charts[3].timeScale().setVisibleLogicalRange({ from: 0, to: 119 });
        s.lines[0].applyOptions({ lineStyle: 'solid' });
        s.markers.setMarkers(s.markers.markers().slice(0, 3));
        s.charts.forEach(c => c.paint());
        const n = s.markers.markers().length;
        s.lines[0].applyOptions({ lineStyle: 'dashed' });
        return { markers: n, price: s.lines[0].options().price };
      });
      console.log(JSON.stringify(info));
    }
    await page.close();
  }
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('no console errors');
})().catch(e => { console.error(e); process.exit(1); });
