// Screenshots of examples/chart-types.html (every chart type on the same data, plus the big chart with its type
// switcher) in light and dark at device scale 2; fails on any console error or on a chart type that draws nothing.
// Needs Playwright importable on this machine (it is NOT a dev dependency): `npm run build && node scripts/screenshots-chart-types.cjs`.
// If dist/chartist-lite-transforms.iife.min.js is missing (a build without the transforms entry) it is bundled here
// with the package's esbuild. CT_EXTRA=<dir> also writes one big-chart shot per chart type there.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const url = 'file://' + path.join(root, 'examples', 'chart-types.html');
const extra = process.env.CT_EXTRA || '';

async function ensureBundles() {
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const need = [
    ['chartist-lite.iife.min.js', 'src/index.ts', 'ChartistLite'],
    ['chartist-lite-transforms.iife.min.js', 'src/transforms/index.ts', 'ChartistLiteTransforms'],
  ].filter(([f]) => !fs.existsSync(path.join(dist, f)));
  if (!need.length) return;
  const { build } = require(path.join(root, 'node_modules', 'esbuild'));
  for (const [file, entry, globalName] of need) {
    await build({
      absWorkingDir: root, entryPoints: [entry], outfile: path.join('dist', file), bundle: true, format: 'iife', globalName,
      minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning',
    });
    console.log('bundled dist/' + file);
  }
}

(async () => {
  await ensureBundles();
  fs.mkdirSync(out, { recursive: true });
  if (extra) fs.mkdirSync(extra, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  await page.waitForTimeout(400);

  const ids = await page.evaluate(() => window.__types.ids);
  if (ids.length !== 16) problems.push(`expected 16 chart types, the page has ${ids.length}`);

  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => window.__types.setTheme(t), theme);
    await page.evaluate(() => window.__types.apply());
    await page.waitForTimeout(200);
    const drawn = await page.evaluate(() => window.__types.drawn());
    for (const d of drawn) if (!(d.rows > 0) || d.marked < 30) problems.push(`${theme}: chart "${d.id}" drew ${d.marked} marked pixels from ${d.rows} rows`);

    // Every type on the big chart, with its default inputs, then a few inputs changed.
    if (theme === 'light') {
      for (const id of ids) {
        await page.evaluate(i => window.__types.selectBig(i), id);
        await page.waitForTimeout(80);
        const d = (await page.evaluate(() => window.__types.drawn())).pop();
        if (!(d.rows > 0) || d.marked < 30) problems.push(`big chart "${id}" drew ${d.marked} marked pixels from ${d.rows} rows`);
        if (extra) await page.locator('#big').screenshot({ path: path.join(extra, `big-${id}-${theme}.png`) });
      }
      const changed = await page.evaluate(() => {
        const t = window.__types;
        const res = {};
        const set = (id, key, v) => { t.settings[id][key] = v; t.selectBig(id); t.apply(); const a = t.states[t.states.length - 1].applied; return a.info; };
        res.renko = set('renko', 'brick', 1.5);
        res.kagi = set('kagi', 'reversal', 2);
        res.pf = set('pointFigure', 'box', 1);
        res.range = set('rangeBars', 'range', 2);
        res.lb = set('lineBreak', 'lines', 2);
        return res;
      });
      console.log(JSON.stringify(changed));
      if (changed.renko.brick !== 1.5 || changed.kagi.reversal !== 2 || changed.pf.box !== 1 || changed.range.range !== 2 || changed.lb.lines !== 2) problems.push('inputs did not reach the transforms');
      await page.evaluate(() => { const t = window.__types; for (const [id, k, v] of [['renko', 'brick', 0], ['kagi', 'reversal', 1.5], ['pointFigure', 'box', 0], ['rangeBars', 'range', 0], ['lineBreak', 'lines', 3]]) t.settings[id][k] = v; t.selectBig('candles'); });
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: path.join(out, `chart-types-${theme}.png`), fullPage: true });
  }

  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log('no console errors; every chart type drew');
})().catch(e => { console.error(e); process.exit(1); });
