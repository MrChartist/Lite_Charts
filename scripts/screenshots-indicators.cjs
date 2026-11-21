// Screenshots and a smoke run of examples/indicators.html in Chromium (light and dark): candles with SMA and Bollinger,
// RSI and MACD on their own charts below. Writes docs/screenshots/indicators-light.png and indicators-dark.png and fails
// on any console error. Needs Playwright importable on this machine (not a dev dependency): `node scripts/screenshots-indicators.cjs`.
// The example reads the indicators entry as a <script> global; `npm run build` does not write one, so this script
// builds dist/chartist-lite-indicators.iife.min.js with the package's own esbuild when it is missing.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const url = 'file://' + path.join(root, 'examples', 'indicators.html');

async function ensureBundles() {
  const core = path.join(root, 'dist', 'chartist-lite.iife.min.js');
  if (!fs.existsSync(core)) throw new Error('run `npm run build` first (dist/chartist-lite.iife.min.js is missing)');
  const ind = path.join(root, 'dist', 'chartist-lite-indicators.iife.min.js');
  if (fs.existsSync(ind) && fs.statSync(ind).mtimeMs >= fs.statSync(path.join(root, 'dist', 'indicators.js')).mtimeMs) return;
  const { build } = require(path.join(root, 'node_modules', 'esbuild'));
  await build({
    absWorkingDir: root, entryPoints: ['src/indicators/index.ts'], outfile: ind, bundle: true, format: 'iife',
    globalName: 'ChartistLiteIndicators', minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning',
  });
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
    return { candles: d.candles.data().length, charts: d.charts.length };
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
