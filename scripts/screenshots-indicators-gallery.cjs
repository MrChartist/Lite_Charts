// Smoke run and screenshots of examples/indicators-gallery.html in Chromium: loads EVERY indicator of the catalog once
// (and edits its first input once through the page's own controls), asserts that nothing logs a console error or warning and
// that each one puts values on the chart, then writes docs/screenshots/indicators-gallery-light.png and -dark.png.
// Needs Playwright importable on this machine (not a dev dependency): `node scripts/screenshots-indicators-gallery.cjs`.
// The page reads the library and the indicators entry as <script> globals; `npm run build` writes them.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const url = 'file://' + path.join(root, 'examples', 'indicators-gallery.html');

function ensureBundles() {
  for (const f of ['chartist-lite.iife.min.js', 'chartist-lite-indicators.iife.min.js']) {
    if (!fs.existsSync(path.join(root, 'dist', f))) throw new Error(`run \`npm run build\` first (dist/${f} is missing)`);
  }
}

(async () => {
  ensureBundles();
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const problems = [];
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1.5 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__gallery && window.__gallery.ids.length > 0);

  const ids = await page.evaluate(() => window.__gallery.ids);
  const listed = await page.evaluate(() => { window.__gallery.renderList(''); return document.querySelectorAll('.item').length; });
  if (listed !== ids.length) problems.push(`the list shows ${listed} entries for ${ids.length} catalog entries`);
  if (new Set(ids).size !== ids.length) problems.push('duplicate catalog ids');

  const report = { indicators: ids.length, drawn: {}, edited: 0, needIntraday: [] };
  for (const id of ids) {
    const before = errors.length;
    await page.click(`.item[data-id="${id}"]`);
    let st = await page.evaluate(() => window.__gallery.state());
    if (!(st.drawn > 0)) {
      // A study that reads intraday bars (the opening range) has nothing to show on daily candles: try the 5-minute ones.
      await page.evaluate(() => window.__gallery.setData('intraday'));
      st = await page.evaluate(() => window.__gallery.state());
      if (st.drawn > 0) report.needIntraday.push(id);
    }
    report.drawn[id] = st.drawn;
    if (st.id !== id) problems.push(`${id}: not selected`);
    if (!(st.drawn > 0)) problems.push(`${id}: empty drawing (no values)`);
    if (!(st.seriesWithValues > 0)) problems.push(`${id}: the chart holds no series with values`);
    if (st.panes < 1) problems.push(`${id}: no pane`);
    // Edit the first input through the page's own control, as a user would.
    const control = page.locator('#inputs [data-key]').first();
    if (await control.count()) {
      const tag = await control.evaluate(el => el.tagName + ':' + el.type);
      if (tag === 'INPUT:number') {
        const v = await control.evaluate(el => Math.min(Number(el.max || Infinity), Number(el.value) + 1));
        await control.fill(String(v));
      } else if (tag.startsWith('SELECT')) {
        const last = await control.evaluate(el => el.options[el.options.length - 1].value);
        await control.selectOption(last);
      }
      report.edited++;
      const after = await page.evaluate(() => window.__gallery.state());
      if (after.id !== id) problems.push(`${id}: edit changed the selection`);
    }
    await page.evaluate(() => window.__gallery.setData('daily'));
    if (errors.length > before) problems.push(`${id}: console problems: ${errors.slice(before).join(' | ')}`);
  }

  // Search narrows the list.
  await page.fill('#search', 'rsi');
  const found = await page.evaluate(() => [...document.querySelectorAll('.item')].map(b => b.dataset.id));
  if (!found.includes('rsi') || !found.includes('stoch-rsi') || found.includes('macd')) problems.push(`search "rsi" gave ${found.join(', ')}`);
  report.searchRsi = found;
  await page.fill('#search', 'zzzz');
  if ((await page.locator('#empty').count()) !== 1) problems.push('an empty search shows no "No indicator matches" line');
  await page.fill('#search', '');

  // Pictures: an overlay with a cloud in the light theme, a pane with a histogram in the dark one.
  await page.click('.item[data-id="ichimoku"]');
  await page.locator('.item[data-id="ichimoku"]').scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'indicators-gallery-light.png') });
  await page.click('#theme');
  await page.click('.item[data-id="macd"]');
  await page.locator('.item[data-id="macd"]').scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'indicators-gallery-dark.png') });

  await browser.close();
  console.log(JSON.stringify({ ...report, drawn: Object.fromEntries(Object.entries(report.drawn).slice(0, 5)) }, null, 2) + `\n(first 5 of ${ids.length} drawn counts shown)`);
  if (errors.length) problems.push('console problems:\n' + errors.join('\n'));
  if (problems.length) {
    console.error('problems:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log(`all ${ids.length} indicators drew, no console errors`);
})().catch(e => { console.error(e); process.exit(1); });
