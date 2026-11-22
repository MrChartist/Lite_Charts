// Cross-browser smoke check: loads the built core in Chromium, Firefox and WebKit,
// draws a chart, pans, zooms and updates it, and fails on any page error or empty canvas.
// Usage: node scripts/smoke-browsers.cjs [chromium firefox webkit]
const path = require('path');
const pw = require('playwright');

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];
const lib = path.join(__dirname, '..', 'dist', 'chartist-lite.iife.min.js');

const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">
<div id="c" style="width:800px;height:400px"></div>`;

function makeRows() {
  const rows = [];
  let price = 100;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 500; i++) {
    const open = price;
    const close = open + (rnd() - 0.5) * 2;
    rows.push({
      time: 1700000000 + i * 86400,
      open,
      high: Math.max(open, close) + rnd(),
      low: Math.min(open, close) - rnd(),
      close,
    });
    price = close;
  }
  return rows;
}

(async () => {
  let failed = false;
  for (const name of wanted) {
    const errors = [];
    let browser;
    try {
      browser = await pw[name].launch();
    } catch (e) {
      console.log(`${name}: could not start (${String(e.message).split('\n')[0]})`);
      failed = true;
      continue;
    }
    const p = await browser.newPage({ viewport: { width: 800, height: 400 } });
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.setContent(page);
    await p.addScriptTag({ path: lib });
    const result = await p.evaluate((rows) => {
      const L = window.ChartistLite;
      const chart = L.createChart(document.getElementById('c'), { theme: 'light' });
      const s = chart.addSeries(L.CandlestickSeries, { title: 'DEMO' });
      s.setData(rows);
      chart.timeScale().fitContent();
      chart.paint();
      const last = rows[rows.length - 1];
      s.update({ ...last, close: last.close + 1, high: last.high + 1 });
      chart.paint();
      const canvas = document.querySelector('#c canvas');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4 * 97) seen.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2]);
      return { colours: seen.size, range: chart.timeScale().getVisibleLogicalRange() };
    }, makeRows());
    await p.mouse.move(400, 200);
    await p.mouse.wheel(0, -300);
    await p.mouse.down();
    await p.mouse.move(250, 200, { steps: 5 });
    await p.mouse.up();
    await p.waitForTimeout(200);
    const ok = result.colours >= 3 && result.range && errors.length === 0;
    console.log(`${name}: ${ok ? 'ok' : 'FAILED'} (colours ${result.colours}, errors ${errors.length})`);
    for (const e of errors) console.log('  ' + e);
    if (!ok) failed = true;
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})();
