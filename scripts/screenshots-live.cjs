// Live data in Chromium against the REAL exchanges (needs network): examples/bitcoin.html reaches "live" with
// Coinbase, the last bar changes as trades arrive, the interval switch reloads, Binance and Kraken connect, scrolling
// to the left edge loads older bars, the element-live build streams with no page code, and removing it disconnects.
// Writes docs/screenshots/bitcoin-light.png / -dark.png. Without network it says so and exits 0 with "skipped"
// (streaming is covered by the fake-socket unit tests). Needs Playwright and `npm run build`.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const failures = [];
const check = (ok, what, detail) => { if (!ok) failures.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

(async () => {
  if (!fs.existsSync(path.join(root, 'dist', 'chartist-lite-live.iife.min.js'))) throw new Error('run `npm run build` first');
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const reachable = await page.evaluate(async () => {
    try { return (await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60')).ok; } catch { return false; }
  });
  if (!reachable) { console.log('skipped: the exchanges cannot be reached from here (streaming is covered by the unit tests)'); await browser.close(); return; }
  await page.goto('file://' + path.join(root, 'examples', 'bitcoin.html'));
  const waitLive = () => page.waitForFunction(() => window.__demo.live.status() === 'live', null, { timeout: 25000 }).then(() => true).catch(() => false);
  check(await waitLive(), 'Coinbase: history then a live stream', await page.evaluate(() => window.__demo.live.status()));
  const first = await page.evaluate(() => ({ n: window.__demo.candles.data().length, last: window.__demo.candles.data().at(-1) }));
  check(first.n >= 300, 'history loaded', first.n);
  // Trades move the forming bar (BTC trades every second or so on Coinbase).
  const moved = await page.waitForFunction(last => { const l = window.__demo.candles.data().at(-1); return l.time !== last.time || l.close !== last.close || l.high !== last.high || l.low !== last.low; }, first.last, { timeout: 30000 }).then(() => true).catch(() => false);
  check(moved, 'live trades update the last bar');
  // Older history at the left edge.
  await page.evaluate(() => window.__demo.chart.timeScale().setVisibleLogicalRange({ from: 0, to: 120 }));
  const older = await page.waitForFunction(n => window.__demo.candles.data().length > n, first.n, { timeout: 15000 }).then(() => true).catch(() => false);
  check(older, 'reaching the left edge loads older bars', await page.evaluate(() => window.__demo.candles.data().length));
  await page.evaluate(() => window.__demo.chart.timeScale().resetTimeScale());
  // Interval switch from the keyboard (page key 5 = 5m).
  await page.mouse.click(5, 5);
  await page.keyboard.press('5');
  check(await waitLive(), '5m interval live', await page.evaluate(() => ({ i: window.__demo.live.interval(), s: window.__demo.live.status() })));
  const step = await page.evaluate(() => { const d = window.__demo.candles.data(); return d.at(-1).time - d.at(-2).time; });
  check(step === 300, '5m bars are 300 s apart', step);
  await page.keyboard.press('1');
  await waitLive();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, 'bitcoin-light.png') });
  for (const prov of ['binance', 'kraken']) {
    await page.selectOption('#provider', prov);
    const ok = await waitLive();
    const info = await page.evaluate(() => ({ p: window.__demo.live.provider(), s: window.__demo.live.status(), n: window.__demo.candles.data().length, info: window.__demo.live.info(), title: window.__demo.candles.options().title, status: document.getElementById('statusText').textContent }));
    check(ok && info.p === prov && info.n > 50, `${prov}: history and stream`, info);
    const quote = prov === 'binance' ? 'USDT' : 'USD';
    check(info.info.quote === quote && info.title === `BTC-${quote}` && info.status === `Live · ${info.info.providerLabel} · ${quote}`, `${prov}: the status and the legend name the provider and the quote currency really in use`, info);
  }
  await page.selectOption('#provider', 'coinbase');
  await waitLive();
  await page.click('#theme');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, 'bitcoin-dark.png') });
  await page.close();

  // The element-live build: a live chart from one tag, disconnected when removed.
  const el = await browser.newPage({ viewport: { width: 900, height: 520 } });
  el.on('pageerror', e => errors.push(e.message));
  const sockets = [];
  el.on('websocket', ws => sockets.push(ws));
  await el.goto('file://' + path.join(root, 'examples', 'live-element.html'));
  const elLive = await el.waitForFunction(() => { const s = document.getElementById('btc').shadowRoot.querySelector('[part="status"]'); return s && /^Live · \w+ · \w+$/.test(s.textContent); }, null, { timeout: 25000 }).then(() => true).catch(() => false);
  check(elLive, '<chartist-chart live> streams with no page code and shows "Live · provider · quote" (dot and word)', await el.evaluate(() => document.getElementById('btc').shadowRoot.querySelector('[part="status"]')?.textContent));
  // A symbol change: the old bars go at once, the title follows the new symbol.
  const switched = await el.evaluate(async () => {
    const e = document.getElementById('btc');
    e.setAttribute('symbol', 'ETH-USD');
    await new Promise(r => setTimeout(r, 50));
    const cleared = e.series.data().length;
    for (let i = 0; i < 100 && !(e.series.data().length > 50); i++) await new Promise(r => setTimeout(r, 200));
    return { cleared, n: e.series.data().length, title: e.series.options().title, last: e.series.data().at(-1)?.close };
  });
  check(switched.cleared === 0 && switched.n > 50 && /^ETH-USDT?$/.test(switched.title) && switched.last < 20000, 'a symbol change clears the old bars and retitles the series', switched);
  await el.screenshot({ path: path.join(out, 'bitcoin-element.png') });
  await el.evaluate(() => document.getElementById('btc').remove());
  await el.waitForTimeout(500);
  check(sockets.length > 0 && sockets.every(s => s.isClosed()), 'removing the element closes its socket', sockets.map(s => s.isClosed()));
  await el.close();
  await browser.close();
  if (errors.length) { console.error('console problems:\n' + errors.join('\n')); failures.push('console errors'); }
  if (failures.length) { console.error(`${failures.length} check(s) failed`); process.exit(1); }
  console.log('all live checks passed against the real exchanges; no console errors');
})().catch(e => { console.error(e); process.exit(1); });
