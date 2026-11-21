// Screenshots and a smoke run of examples/indicators.html in Chromium (light and dark): candles with SMA and Bollinger,
// RSI and MACD in their own panes of the same chart below. Writes docs/screenshots/indicators-light.png and indicators-dark.png and fails
// on any console error. Needs Playwright importable on this machine (not a dev dependency): `node scripts/screenshots-indicators.cjs`.
// The example reads the indicators entry as a <script> global; `npm run build` writes it.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const url = 'file://' + path.join(root, 'examples', 'indicators.html');

async function ensureBundles() {
  // `npm run build` writes both bundles (dist/chartist-lite.iife.min.js, dist/chartist-lite-indicators.iife.min.js).
  for (const f of ['chartist-lite.iife.min.js', 'chartist-lite-indicators.iife.min.js']) {
    if (!fs.existsSync(path.join(root, 'dist', f))) throw new Error(`run \`npm run build\` first (dist/${f} is missing)`);
  }
}

(async () => {
  await ensureBundles();
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 960, height: 760 }, deviceScaleFactor: 2 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  await page.waitForTimeout(400);

  const report = {};
  report.counts = await page.evaluate(() => {
    const d = window.__demo;
    return { candles: d.candles.data().length, charts: d.charts.length, panes: d.price.panes().map(p => p.getHeight()) };
  });
  await page.screenshot({ path: path.join(out, 'indicators-light.png') });

  // Live tick: the incremental indicators feed three series; the last bar is replaced, then a new one appended.
  report.tick = await page.evaluate(() => {
    const d = window.__demo;
    const n0 = d.candles.data().length;
    d.feed({ ...d.bars[d.bars.length - 1], close: d.bars[d.bars.length - 1].close * 1.01 });
    const n1 = d.candles.data().length;
    d.feed({ time: '2030-01-01', open: 100, high: 105, low: 99, close: 103 });
    return { n0, n1, n2: d.candles.data().length };
  });

  await page.click('#theme');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  // Reload the last-bar state for the dark picture so it is the same data as the light one.
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#theme');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'indicators-dark.png') });

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) {
    console.error('console problems:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('no console errors');
})().catch(e => { console.error(e); process.exit(1); });
