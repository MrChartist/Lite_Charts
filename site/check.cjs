// Verifies the built site in real Chromium (Playwright must be importable; it is not a dependency of this package).
//   node site/check.cjs
// Builds the site, serves site/dist, visits every page at 1280 and 390 wide in dark (the default) and light and asserts
// SEO tags, one h1, contrast, text size, touch targets, overflow, links and that every chart draws. Then checks the
// interactive parts by keyboard: search, the drawer's focus trap, copy buttons, ARIA tabs, the chapter scroll-spy, the
// API filter, the examples gallery and its dialog, the frame meter; fonts and layout shift; strict-CSP markup; and the
// pages from file:// and under a sub-path. Exit code 1 when anything fails. Screenshots: SITE_SHOTS=1 writes the
// final ones to docs/screenshots/site-*.png.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const dist = path.join(here, 'dist');
const shots = path.join(here, '..', 'docs', 'screenshots');
const scratch = process.env.SITE_CHECK_SCRATCH || '';

const failures = [];
let assertions = 0;
function ok(cond, msg) { assertions++; if (!cond) { failures.push(msg); console.error('  FAIL ' + msg); } }

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain', '.woff2': 'font/woff2' };
function serve(prefix) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (!p.startsWith(prefix)) { res.writeHead(404); res.end('not found'); return; }
    p = p.slice(prefix.length - 1);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(dist, path.normalize(p));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function listPages(dir, base = '') {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...listPages(p, base + f + '/'));
    else if (f.endsWith('.html')) out.push(base + f);
  }
  return out.sort();
}

/** Any http(s) or ws(s) address that is not this machine's test server. */
function isExternal(url) {
  const m = /^(?:https?|wss?):\/\/([^/:]+)/i.exec(url);
  return !!m && m[1] !== '127.0.0.1';
}

// ---- live data with no network: fetch and WebSocket for the exchanges, stubbed inside the page ----
// Coinbase history answers with deterministic one-minute bars; the stream opens at once and window.__stubTrade(price)
// sends a Coinbase "match". With { fail: true } every exchange request rejects and every socket closes, so the demos'
// fallbacks can be checked. Requests to the page's own origin go to the real fetch.
function liveStub(opts) {
  const HOST = /(^|\.)(coinbase\.com|binance\.vision|kraken\.com)$/;
  const realFetch = window.fetch.bind(window);
  const stub = { fail: !!(opts && opts.fail), requests: [], sockets: [] };
  window.__stub = stub;
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const f = (t) => 60000 + 300 * Math.sin(t / 3600) + 60 * Math.sin(t / 420);
  window.fetch = function (input, init) {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url, location.href); } catch (e) { return realFetch(input, init); }
    if (!HOST.test(url.hostname)) return realFetch(input, init);
    stub.requests.push(url.href);
    if (stub.fail) return Promise.reject(new TypeError('Failed to fetch (stub)'));
    if (url.hostname !== 'api.exchange.coinbase.com') return Promise.resolve(json([]));
    const g = Number(url.searchParams.get('granularity')) || 60;
    const start = Math.floor(Date.parse(url.searchParams.get('start')) / 1000);
    const end = Math.floor(Date.parse(url.searchParams.get('end')) / 1000);
    const rows = [];
    const newest = Math.min(Math.floor(end / g) * g, Math.floor(Date.now() / 1000 / g) * g);   // never a bar in the future
    for (let t = newest; t >= start; t -= g) {
      const o = +f(t).toFixed(2); const c = +f(t + g).toFixed(2);
      rows.push([t, +(Math.min(o, c) - 9).toFixed(2), +(Math.max(o, c) + 9).toFixed(2), o, c, +(1 + Math.abs(Math.sin(t)) * 6).toFixed(4)]);
    }
    return Promise.resolve(json(rows));
  };
  class FakeSocket {
    constructor(url) {
      this.url = url; this.readyState = 0; this.sent = [];
      this.onopen = this.onmessage = this.onerror = this.onclose = null;
      stub.sockets.push(this);
      setTimeout(() => {
        if (this.readyState !== 0) return;
        if (stub.fail) { this.readyState = 3; if (this.onclose) this.onclose({ code: 1006 }); return; }
        this.readyState = 1; if (this.onopen) this.onopen({});
      }, 20);
    }
    send(data) { this.sent.push(String(data)); }
    close() { this.readyState = 3; }
  }
  FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
  window.WebSocket = FakeSocket;
  let id = 1;
  window.__stubTrade = (price) => {
    let n = 0;
    for (const s of stub.sockets) {
      if (s.readyState !== 1 || !s.onmessage) continue;
      s.onmessage({ data: JSON.stringify({ type: 'match', trade_id: id++, price: String(price), size: '0.25', time: new Date().toISOString() }) });
      n++;
    }
    return n;
  };
}

// ---- in-page helpers (serialised into the page) ----
function inPagePassive() {
  const q = (s) => Array.from(document.querySelectorAll(s));
  const text = (el) => (el ? el.textContent.trim() : '');
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('pre, code, script, style, noscript, chartist-chart').forEach((n) => n.remove());
  const visible = clone.textContent;
  const ids = q('[id]').map((e) => e.id);
  const ldOk = q('script[type="application/ld+json"]').map((s) => { try { JSON.parse(s.textContent); return true; } catch (e) { return false; } });
  const meta = (sel) => { const e = document.querySelector(sel); return e ? e.getAttribute('content') || e.getAttribute('href') : null; };
  // Smallest font size and contrast of every element that directly holds text.
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (el) => {
    let layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
    }
    let base = { r: 255, g: 255, b: 255 };
    if (!layers.length || layers[layers.length - 1].a < 1) base = parse(getComputedStyle(document.documentElement).backgroundColor) || base;
    for (let i = layers.length - 1; i >= 0; i--) { const l = layers[i]; base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a) }; }
    return base;
  };
  let minFont = 99; const smallFonts = []; const lowContrast = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest('script, style, noscript, canvas') || el.closest('chartist-chart')) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    seen.add(el);
    const fs = parseFloat(st.fontSize);
    if (fs < minFont) minFont = fs;
    if (fs < 12) smallFonts.push(el.tagName + ':' + text(el).slice(0, 30));
    const fg = parse(st.color); const bg = bgOf(el);
    if (fg) {
      const fgl = lum({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) });
      const bgl = lum(bg);
      const ratio = (Math.max(fgl, bgl) + 0.05) / (Math.min(fgl, bgl) + 0.05);
      if (ratio < 4.5) lowContrast.push(el.tagName + '.' + el.className + ' ' + ratio.toFixed(2) + ' "' + text(el).slice(0, 24) + '"');
    }
  }
  const imgs = q('img').map((i) => ({ alt: i.getAttribute('alt'), w: i.getAttribute('width'), h: i.getAttribute('height') }));
  return {
    h1: q('h1').length, title: document.title, desc: meta('meta[name="description"]'), canonical: meta('link[rel="canonical"]'),
    ogTitle: meta('meta[property="og:title"]'), ogImage: meta('meta[property="og:image"]'), twCard: meta('meta[name="twitter:card"]'),
    lang: document.documentElement.getAttribute('lang'), skip: !!document.querySelector('a.skip[href="#main"]'), main: q('main').length,
    ldCount: ldOk.length, ldOk: ldOk.every(Boolean), dupIds: ids.filter((v, i) => ids.indexOf(v) !== i),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    emDash: visible.includes('—'), grouped: (visible.match(/\d,\d{3}(?!\d)/g) || []), hyphenNeg: (visible.match(/(^|\s)-\d/g) || []),
    minFont, smallFonts, lowContrast, imgs,
    links: q('a[href]').map((a) => a.getAttribute('href')).filter((h) => !/^(https?:|mailto:|data:)/.test(h)),
    anchors: q('a[href^="#"]').map((a) => a.getAttribute('href').slice(1)).filter(Boolean),
    ids,
    headingsOk: q('main h2, main h3').filter((h) => !h.closest('.card')).every((h) => h.id),
    hasCharts: q('[data-demo], chartist-chart').length,
  };
}

function inPageCharts() {
  function info(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width; const h = canvas.height;
    if (!w || !h) return { diff: 0, bright: -1 };
    const d = ctx.getImageData(0, 0, w, h).data;
    const r0 = d[0]; const g0 = d[1]; const b0 = d[2];
    let diff = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 24) diff++;
    return { diff, bright: Math.round((r0 + g0 + b0) / 3) };
  }
  // Canvases inside open shadow roots too (the widget draws in one).
  const canvases = (root) => { const list = Array.from(root.querySelectorAll('canvas')); for (const n of root.querySelectorAll('*')) if (n.shadowRoot) list.push(...canvases(n.shadowRoot)); return list; };
  const best = (root) => canvases(root).map(info).sort((a, b) => b.diff - a.diff)[0] || { diff: 0, bright: -1 };
  const out = [];
  for (const el of document.querySelectorAll('[data-demo]')) out.push({ kind: 'demo:' + el.dataset.demo, ...best(el), w: el.getBoundingClientRect().width, themeFree: el.hasAttribute('data-theme-free') });
  for (const el of document.querySelectorAll('chartist-chart')) out.push({ kind: 'element:' + (el.getAttribute('type') || ''), ...(el.shadowRoot ? best(el.shadowRoot) : { diff: 0, bright: -1 }), w: el.getBoundingClientRect().width, hasChart: !!el.chart });
  return out;
}

async function settle(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 350) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); }
    window.scrollTo(0, 0);
  });
}
async function waitCharts(page, label) {
  try {
    // A canvas may sit in an open shadow root (the widget).
    await page.waitForFunction(() => {
      const has = (root) => !!root.querySelector('canvas') || Array.from(root.querySelectorAll('*')).some((n) => n.shadowRoot && has(n.shadowRoot));
      return Array.from(document.querySelectorAll('[data-demo]')).every((e) => e.dataset.ready === '1' && has(e))
        && Array.from(document.querySelectorAll('chartist-chart')).every((e) => e.chart && e.shadowRoot && e.shadowRoot.querySelector('canvas'));
    }, null, { timeout: 8000 });
  } catch (e) { ok(false, `${label}: charts were not all created within 8 s`); }
  await page.waitForTimeout(250);
}


// ---- interactive parts, by keyboard where a person would use one ----
async function interactive(browser, origin) {
  const watch = (page) => { const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); return errs; };

  // Search: "/" opens it, typing finds headings, arrows move, Enter opens the heading.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(`${origin}/guide/getting-started.html`, { waitUntil: 'load' });
    await page.keyboard.press('/');
    await page.waitForFunction(() => document.getElementById('search').open && document.activeElement.id === 'search-input', null, { timeout: 3000 }).catch(() => {});
    ok(await page.evaluate(() => document.getElementById('search').open && document.activeElement.id === 'search-input'), 'search: "/" opens the search and focuses the field');
    await page.keyboard.type('legend');
    await page.waitForFunction(() => document.querySelectorAll('#search-results li').length > 0, null, { timeout: 3000 }).catch(() => {});
    const n = await page.evaluate(() => document.querySelectorAll('#search-results li').length);
    ok(n > 0, `search: "legend" finds results (${n})`);
    ok(await page.evaluate(() => document.getElementById('search-input').getAttribute('aria-activedescendant') === 'sr-0'), 'search: the first result is the active option');
    await page.keyboard.press('ArrowDown');
    ok(await page.evaluate(() => document.querySelector('#search-results li[aria-selected="true"]').id === 'sr-1' || document.querySelectorAll('#search-results li').length === 1), 'search: ArrowDown moves the selection');
    const target = await page.evaluate(() => document.querySelector('#search-results li[aria-selected="true"] a').href);
    await Promise.all([page.waitForNavigation({ timeout: 5000 }).catch(() => {}), page.keyboard.press('Enter')]);
    ok(page.url() === target && /#/.test(target), `search: Enter opens the result, a heading link (${target.replace(origin, '')})`);
    const frag = new URL(page.url()).hash.slice(1);
    ok(await page.evaluate((f) => !!document.getElementById(f), frag), 'search: the result heading exists on the page');
    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(200);
    await page.keyboard.type('zzzqqq');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => /Nothing matches/.test(document.getElementById('search-status').textContent)), 'search: Ctrl+K opens it, and no match says so');
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => !document.getElementById('search').open), 'search: Escape closes it');
    ok(errs.length === 0, 'search: no console errors ' + errs.join(' | '));
    await ctx.close();
  }

  // Drawer: opens from the menu button, traps focus, Escape closes and focus returns.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(`${origin}/guide/theming.html`, { waitUntil: 'load' });
    await page.click('#menu-open');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById('drawer').open), 'drawer: the menu button opens it');
    let inside = true;
    for (let i = 0; i < 40; i++) { await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab'); if (!(await page.evaluate(() => document.getElementById('drawer').contains(document.activeElement)))) { inside = false; break; } }
    ok(inside, 'drawer: Tab and Shift+Tab keep focus inside (40 presses)');
    ok(await page.evaluate(() => !!document.querySelector('#drawer a[aria-current="page"]')), 'drawer: the current guide is marked');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => !document.getElementById('drawer').open && document.activeElement.id === 'menu-open'), 'drawer: Escape closes it and focus returns to the menu button');
    ok(errs.length === 0, 'drawer: no console errors ' + errs.join(' | '));
    await ctx.close();
  }

  // Copy buttons, tabs, the chapter scroll-spy, the meter.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    const tabs = await page.evaluate(() => { const l = document.querySelector('[role="tablist"]'); const t = Array.from(l.querySelectorAll('[role="tab"]')); return { n: t.length, wired: t.every((x) => { const p = document.getElementById(x.getAttribute('aria-controls')); return p && p.getAttribute('role') === 'tabpanel' && p.getAttribute('aria-labelledby') === x.id; }) }; });
    ok(tabs.n === 3 && tabs.wired, 'tabs: three tabs, each controls a tabpanel labelled by it');
    await page.focus('#tab-script');
    await page.keyboard.press('ArrowRight');
    ok(await page.evaluate(() => document.activeElement.id === 'tab-module' && document.getElementById('tab-module').getAttribute('aria-selected') === 'true' && !document.getElementById('panel-module').hidden && document.getElementById('panel-script').hidden), 'tabs: ArrowRight selects and shows the next tab');
    await page.keyboard.press('End');
    ok(await page.evaluate(() => document.activeElement.id === 'tab-react' && document.getElementById('tab-script').tabIndex === -1), 'tabs: End selects the last; only the selected tab is in the Tab order');
    await page.click('#panel-react .copy');
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const pre = await page.evaluate(() => document.querySelector('#panel-react pre').textContent);
    ok(clip === pre && clip.includes('createChartistReact'), 'copy: the button copies the block text exactly');
    ok(await page.evaluate(() => document.querySelector('#panel-react .copy').textContent === 'Copied'), 'copy: the button says Copied');
    // Frame meter.
    await page.evaluate(() => document.getElementById('meter').scrollIntoView({ block: 'center' }));
    await page.waitForFunction(() => /Median/.test(document.getElementById('meter-read').textContent), null, { timeout: 15000 }).catch(() => {});
    const meter = await page.evaluate(() => document.getElementById('meter-read').textContent);
    ok(/Median [\d.]+ ms/.test(meter), `meter: it measures frames on this device ("${meter.slice(0, 80)}")`);
    ok(errs.length === 0, 'home interactions: no console errors ' + errs.join(' | '));
    // Scroll-spy on a guide page.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/guide/panes-and-scales.html`, { waitUntil: 'load' });
    const id = await page.evaluate(() => document.querySelectorAll('.prose > h2')[1].id);
    await page.evaluate((x) => document.getElementById(x).scrollIntoView(), id);
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.querySelector('nav.page-toc a[aria-current="true"]').getAttribute('href')) === `#${id}`, `scroll-spy: "On this page" marks the second section (#${id})`);
    ok(await page.evaluate(() => !document.querySelector('nav.chapters, .chapter-label')), 'plain look: no chapter capsule and no numbered chapter labels');
    await ctx.close();
  }

  // API filter and the examples gallery.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(`${origin}/guide/api-reference.html`, { waitUntil: 'load' });
    const total = await page.evaluate(() => document.querySelectorAll('.entry').length);
    await page.fill('#api-filter', 'setdata');
    const vis = await page.evaluate(() => Array.from(document.querySelectorAll('.entry')).filter((e) => !e.hidden).map((e) => e.dataset.entry));
    ok(total > 60 && vis.length > 0 && vis.length < 12 && vis.includes('series.setdata'), `api filter: "setdata" narrows ${total} entries to ${vis.length}`);
    ok(await page.evaluate(() => /match/.test(document.getElementById('api-count').textContent)), 'api filter: the count is announced');
    await page.fill('#api-filter', '');
    ok(await page.evaluate(() => Array.from(document.querySelectorAll('.entry')).every((e) => !e.hidden)), 'api filter: clearing shows every entry');

    await page.goto(`${origin}/examples.html`, { waitUntil: 'load' });
    await page.click('[data-filter="indicators"]');
    const shown = await page.evaluate(() => Array.from(document.querySelectorAll('.ex-card')).filter((c) => !c.hidden).map((c) => c.dataset.kind));
    ok(shown.length > 0 && shown.every((k) => k === 'indicators'), `gallery: the Indicators chip shows only indicator cards (${shown.length})`);
    await page.click('[data-filter="all"]');
    const opener = page.locator('[data-open="panes"]');
    await opener.scrollIntoViewIfNeeded();
    await opener.click();
    await page.waitForFunction(() => { const el = document.querySelector('#ex-dialog-stage [data-demo]'); return document.getElementById('ex-dialog').open && el && el.dataset.ready === '1' && el.querySelector('canvas'); }, null, { timeout: 8000 }).catch(() => {});
    ok(await page.evaluate(() => !!document.querySelector('#ex-dialog-stage [data-demo][data-ready="1"] canvas') && /Panes/.test(document.getElementById('ex-dialog-guide').textContent) && !!document.querySelector('#ex-dialog-code pre')), 'gallery: Open shows a large live chart, its code and the guide link');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => !document.getElementById('ex-dialog').open && !document.querySelector('#ex-dialog-stage canvas') && document.activeElement.dataset.open === 'panes'), 'gallery: Escape closes the view, releases its chart and returns focus');
    ok(errs.length === 0, 'api filter and gallery: no console errors ' + errs.join(' | '));
    await ctx.close();
  }

  // Drawing tools playground: a trend line drawn with real pointer input, then exported as JSON and undone.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => document.getElementById('ch-drawings').scrollIntoView());
    await page.waitForFunction(() => { const el = document.querySelector('[data-demo="draw"]'); return el && el.dataset.ready === '1' && el._demo && el._demo.tools.length; }, null, { timeout: 8000 }).catch(() => {});
    const count = () => page.evaluate(() => document.querySelector('[data-demo="draw"]')._demo.tools[0].drawings().length);
    const before = await count();
    // Arm the trend tool the way a reader would: focus the chart, press T (the Lines group's key).
    await page.evaluate(() => document.querySelector('[data-demo="draw"]')._demo.charts[0].element().focus());
    await page.keyboard.press('t');
    ok(await page.evaluate(() => document.querySelector('[data-demo="draw"]')._demo.tools[0].tool()) === 'trend', 'playground: T arms the trend tool');
    const box = await page.locator('[data-demo="draw"]').boundingBox();
    const x1 = box.x + box.width * 0.35; const y1 = box.y + box.height * 0.7;
    const x2 = box.x + box.width * 0.7; const y2 = box.y + box.height * 0.35;
    await page.mouse.move(x1, y1); await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await count();
    const trend = await page.evaluate(() => document.querySelector('[data-demo="draw"]')._demo.tools[0].drawings().filter((d) => d.tool === 'trend').length);
    ok(after === before + 1 && trend >= 1, `playground: a press, drag and release with the trend tool adds a trend line (${before} to ${after})`);
    await page.click('[data-draw="export"]');
    const exported = await page.evaluate(() => { try { return JSON.parse(document.querySelector('#ch-drawings ~ * [data-out], [data-stage] [data-out]').textContent); } catch (e) { return null; } });
    ok(!!exported && exported.format === 'chartist-lite-drawings' && exported.drawings.length === after && exported.drawings.some((d) => d.tool === 'trend'), 'playground: Export JSON shows the drawings, the new trend line included');
    await page.click('[data-draw="undo"]');
    ok(await count() === before, 'playground: Undo removes the trend line again');
    await page.click('[data-draw="import"]');
    ok(await count() === after, 'playground: importing the exported text brings it back');
    ok(errs.length === 0, 'playground: no console errors ' + errs.join(' | '));
    await ctx.close();
  }

  // 120 Hz figures: read from docs/performance.json, shown on the home page and on the performance page.
  {
    const perf = JSON.parse(fs.readFileSync(path.join(here, '..', 'docs', 'performance.json'), 'utf8'));
    const rows = perf.results.filter((r) => r.scenario && typeof r.p95 === 'number');
    const worst = Math.max(...rows.map((r) => r.p95));
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    const chip = await page.evaluate(() => document.querySelector('.stats').textContent);
    ok(chip.includes(`${worst.toFixed(1)} ms`) && chip.includes('8.33'), `120 Hz: the stats strip shows the measured worst p95 (${chip.replace(/\s+/g, ' ').slice(0, 120)})`);
    const big = await page.evaluate(() => document.querySelector('.bench .big').textContent);
    ok(big.startsWith(worst.toFixed(2)), `120 Hz: the speed chapter shows ${worst.toFixed(2)} ms (${big})`);
    await page.goto(`${origin}/performance.html`, { waitUntil: 'load' });
    const pp = await page.evaluate(() => ({ h1: document.querySelector('h1').textContent, rows: Math.max(...Array.from(document.querySelectorAll('table')).map((t) => t.querySelectorAll('tbody tr').length)) }));
    ok(/Performance/.test(pp.h1) && pp.rows >= rows.length, `performance page: renders the full table (${pp.rows} rows for ${rows.length} scenarios)`);
    ok(errs.length === 0, '120 Hz pages: no console errors ' + errs.join(' | '));
    await ctx.close();
  }

  // Guide navigation panel: a clear gap under the top bar at every scroll position, the current row in view on load,
  // the selected row readable in both themes, the foot's previous / next inside the panel.
  for (const theme of ['dark', 'light']) for (const width of [1440, 1280, 1024]) {
    const ctx = await browser.newContext({ viewport: { width, height: 760 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('cl-theme', t); } catch (e) { /* none */ } }, theme);
    const page = await ctx.newPage();
    await page.goto(`${origin}/guide/how-it-compares.html`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const gaps = [];
    for (const f of [0, 0.1, 0.35, 0.6, 0.9, 1]) {
      await page.evaluate((x) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * x), f);
      await page.waitForTimeout(120);
      gaps.push(await page.evaluate(() => Math.round(document.querySelector('.docs-nav .nav-panel').getBoundingClientRect().top - document.querySelector('.header-row').getBoundingClientRect().bottom)));
    }
    ok(gaps.every((g) => g >= 12), `guide nav @${width} ${theme}: never touches or slides under the top bar (gaps ${gaps.join(', ')} px)`);
    await page.evaluate(() => window.scrollTo(0, 0));
    // The panel's height follows the page scroll from a scroll handler, so give it a frame or two to settle.
    await page.waitForTimeout(200);
    const vis = await page.evaluate(() => { const sc = document.querySelector('.docs-nav [data-nav-scroll]'); const a = sc.querySelector('[aria-current="page"]'); const r = a.getBoundingClientRect(); const s = sc.getBoundingClientRect(); return r.top >= s.top - 1 && r.bottom <= s.bottom + 1; });
    ok(vis, `guide nav @${width} ${theme}: the current page (the last one) is in view on load, the panel scrolled to it`);
    const c = await page.evaluate(() => {
      const a = document.querySelector('.docs-nav [aria-current="page"]');
      const rgb = (v) => v.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const ratio = (x, y) => { const a1 = lum(rgb(x)); const b1 = lum(rgb(y)); return (Math.max(a1, b1) + 0.05) / (Math.min(a1, b1) + 0.05); };
      const bg = getComputedStyle(a).backgroundColor;
      return { label: ratio(getComputedStyle(a.querySelector('.nav-label')).color, bg), desc: ratio(getComputedStyle(a.querySelector('.nav-desc')).color, bg) };
    });
    ok(c.label >= 4.5 && c.desc >= 4.5, `guide nav @${width} ${theme}: the selected row reads at ${c.label.toFixed(1)}:1 (title) and ${c.desc.toFixed(1)}:1 (task line)`);
    const foot = await page.evaluate(() => { const p = document.querySelector('.docs-nav .nav-panel').getBoundingClientRect(); return Array.from(document.querySelectorAll('.docs-nav .nav-foot .nav-step')).every((b) => { const r = b.getBoundingClientRect(); return r.right <= p.right && r.left >= p.left; }); });
    ok(foot, `guide nav @${width} ${theme}: previous and next sit inside the panel`);
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`${origin}/guide/series-types.html`, { waitUntil: 'load' });
    ok(await page.evaluate(() => { const b = document.querySelector('.guide-menu'); return !!b && b.offsetParent !== null && /Guide menu/.test(b.textContent) && /Series types/.test(b.textContent); }), 'guide menu @390: the button says "Guide menu" and names the current page');
    await page.click('.guide-menu');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => { const d = document.getElementById('drawer'); const a = d.querySelector('[data-nav-scroll] [aria-current="page"]'); return d.open && a && document.activeElement === a; }), 'guide menu @390: opens the drawer with focus on the current page');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.activeElement.classList.contains('guide-menu')), 'guide menu @390: Escape returns focus to the button');
    await ctx.close();
  }

  // System fonts only: no web font anywhere, and nothing moves the layout while the charts arrive.
  {
    const files = [];
    (function walk(d) { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); if (fs.statSync(q).isDirectory()) walk(q); else files.push(q); } })(dist);
    const fontFiles = files.filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f));
    ok(fontFiles.length === 0, `fonts: no font files in site/dist (${fontFiles.length})`);
    const faces = files.filter((f) => /\.(css|html|js)$/.test(f) && /@font-face/.test(fs.readFileSync(f, 'utf8')));
    ok(faces.length === 0, `fonts: no @font-face rule anywhere in site/dist ${faces.map((f) => path.relative(dist, f)).join(', ')}`);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const fontRequests = [];
    page.on('request', (r) => { if (r.resourceType() === 'font') fontRequests.push(r.url()); });
    await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
    await page.goto(`${origin}/guide/series-types.html`, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    ok(fontRequests.length === 0, `fonts: a page requests no font (${fontRequests.length})`);
    const cls = await page.evaluate(() => window.__cls);
    ok(cls < 0.05, `layout: shift while the charts arrive is ${cls.toFixed(4)} (under 0.05)`);
    await ctx.close();
  }

  // No pink or purple in the stylesheet: every colour in site.css has a hue outside 270 to 345 degrees, or is grey.
  {
    const css = fs.readFileSync(path.join(dist, 'assets', 'site.css'), 'utf8');
    const hues = [];
    for (const m of css.matchAll(/#([0-9a-f]{6})\b|rgba?\((\d+),\s*(\d+),\s*(\d+)/gi)) {
      const [r, g, b] = m[1] ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [m[2], m[3], m[4]].map(Number);
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
      if (mx - mn < 40) continue;   // grey enough
      const d = mx - mn;
      let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      if (h >= 270 && h <= 345) hues.push(m[0]);
    }
    ok(hues.length === 0, `colour: no pink or purple in site.css ${hues.join(', ')}`);
  }

  // The default theme follows the system: light without a choice, dark when the system asks.
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${origin}/guide/getting-started.html`, { waitUntil: 'load' });
    const r = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
    const lum = r.bg.match(/\d+/g).slice(0, 3).map(Number).reduce((a, x) => a + x, 0) / 3;
    ok(!r.attr && (scheme === 'light' ? lum > 230 : lum < 40), `theme: with no choice the page follows a ${scheme} system (data-theme ${r.attr || 'none'}, background ${r.bg})`);
    await ctx.close();
  }

  // Live data, with no network at all: other hosts are blocked, and fetch and WebSocket are stubbed in the page.
  if (fs.existsSync(path.join(dist, 'assets', 'chartist-lite-live.iife.min.js'))) {
    const liveCtx = async (fail, extra) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }, { fail });
      if (extra) await ctx.addInitScript(extra);
      const page = await ctx.newPage();
      const errs = watch(page);
      const external = [];
      page.on('request', (r) => { if (isExternal(r.url())) external.push(r.url()); });
      page.on('websocket', (w) => external.push(w.url()));
      return { ctx, page, errs, external };
    };
    const hero = (page) => page.evaluate(() => {
      const box = document.querySelector('[data-hero-widget]');
      const h = box && box._hero;
      const w = h && h.widget;
      let last = null; let n = 0; let title = '';
      if (w) {
        const s = w.chart.panes()[0].getSeries()[0];
        const d = s ? s.data() : [];
        n = d.length; last = d[d.length - 1] || null; title = w.save().symbol.symbol;
      }
      return {
        ready: !!w, mode: h ? h.mode : '', status: h ? h.status : '', demo: document.querySelector('[data-hero-demo]').getAttribute('aria-pressed'),
        word: document.querySelector('.hero-bar .live-word').textContent, source: document.querySelector('[data-hero-source]').textContent,
        note: document.querySelector('[data-hero-live-note]').textContent, n, last, title, posterHidden: box.classList.contains('is-ready'),
        requests: window.__stub.requests.slice(), sockets: window.__stub.sockets.map((x) => ({ url: x.url, state: x.readyState, sent: x.sent })),
      };
    });
    const heroReady = (page) => page.waitForFunction(() => { const b = document.querySelector('[data-hero-widget]'); return b && b._hero && b._hero.widget; }, null, { timeout: 15000 }).catch(() => {});
    const waitWord = (page, w) => page.waitForFunction((x) => document.querySelector('.hero-bar .live-word').textContent === x, w, { timeout: 15000 }).catch(() => {});

    // The hero is the ready-made widget: the terminal script loads after the page, then real market data by default.
    {
      const { ctx, page, errs, external } = await liveCtx(false);
      const t0 = Date.now();
      await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
      const loadMs = Date.now() - t0;
      await heroReady(page);
      await waitWord(page, 'Live');
      const readyMs = Date.now() - t0;
      let h = await hero(page);
      ok(h.ready && h.mode === 'live' && h.status === 'live' && h.word === 'Live' && h.demo === 'false', `live hero: the widget loads lazily and connects by itself ("${h.word}", ${h.mode})`);
      ok(h.source === 'Real market data · Coinbase', `live hero: the label says "${h.source}"`);
      ok(/straight from the exchange/.test(h.note) && /not advice/.test(h.note), `live hero: the line under it says the prices come straight from the exchange and are not advice ("${h.note}")`);
      ok(h.requests.length > 0 && h.requests.every((u) => u.startsWith('https://api.exchange.coinbase.com/products/BTC-USD/candles')) && external.length === 0, `live hero: BTC-USD history from Coinbase only, through the stub (${h.requests.length} requests, ${external.length} real)`);
      ok(h.sockets.filter((x) => x.state === 1).length === 1 && h.sockets[0].url === 'wss://ws-feed.exchange.coinbase.com', 'live hero: one Coinbase stream');
      ok(h.n > 100 && h.title === 'BTC-USD' && h.posterHidden, `live hero: the widget shows the Coinbase bars and the poster is gone (${h.n} bars)`);
      const before = h.last;
      const price = +(before.close + 321.25).toFixed(2);
      const sent = await page.evaluate((p) => window.__stubTrade(p), price);
      await page.waitForFunction((p) => { const w = document.querySelector('[data-hero-widget]')._hero.widget; const d = w.chart.panes()[0].getSeries()[0].data(); return d[d.length - 1].close === p; }, price, { timeout: 4000 }).catch(() => {});
      h = await hero(page);
      ok(sent >= 1 && h.last.close === price && h.last.time >= before.time, `live hero: the last bar moves on a stubbed trade (close ${before.close} to ${h.last.close})`);
      const usable = await page.evaluate(() => { const w = document.querySelector('[data-hero-widget]')._hero.widget; const root = w.element.shadowRoot || w.element; return { buttons: root.querySelectorAll('button').length }; });
      ok(usable.buttons > 15, `live hero: the full toolbar is there (${usable.buttons} buttons in the widget)`);
      // "Use demo data": disconnects, is remembered, and after a reload nothing is requested.
      await page.click('[data-hero-demo]');
      await page.waitForTimeout(400);
      h = await hero(page);
      ok(h.demo === 'true' && h.mode === 'demo' && h.word === 'Demo data' && h.source === 'Invented demo data' && h.title === 'DEMO' && h.sockets.every((x) => x.state === 3), `live hero: "Use demo data" closes the stream and shows demo data (${h.title})`);
      external.length = 0;
      await page.reload({ waitUntil: 'load' });
      await heroReady(page);
      await page.waitForTimeout(1500);
      h = await hero(page);
      ok(h.mode === 'demo' && h.demo === 'true' && h.requests.length === 0 && h.sockets.length === 0 && external.length === 0, `live hero: the demo choice is remembered; after a reload no request goes to any other host (${h.requests.length}, ${h.sockets.length}, ${external.length})`);
      await page.click('[data-hero-demo]');
      await waitWord(page, 'Live');
      ok((await hero(page)).status === 'live' && await page.evaluate(() => localStorage.getItem('cl-hero-data') === null), 'live hero: switching demo data off connects again and forgets the choice');
      ok(errs.length === 0, 'live hero: no console errors ' + errs.join(' | '));
      console.log(`  hero timing (local server, stubbed feed): load event ${loadMs} ms, widget live ${readyMs} ms after navigation`);
      await ctx.close();
    }
    // When no exchange answers: invented demo data, quietly; nothing remembered.
    {
      const { ctx, page, errs } = await liveCtx(true);
      await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
      await heroReady(page);
      await page.waitForFunction(() => /No exchange answered/.test(document.querySelector('[data-hero-live-note]').textContent), null, { timeout: 20000 }).catch(() => {});
      const h = await hero(page);
      ok(h.mode === 'demo' && h.word === 'Demo data' && /No exchange answered/.test(h.note) && h.title === 'DEMO' && h.requests.length > 0, `live hero: a failed connection falls back to demo data quietly ("${h.note}")`);
      ok(await page.evaluate(() => localStorage.getItem('cl-hero-data') === null), 'live hero: a failure is not remembered as a choice');
      ok(errs.length === 0, 'live hero fallback: no console errors ' + errs.join(' | '));
      await ctx.close();
    }
    // A browser that asks to save data: no connection at all.
    {
      const { ctx, page } = await liveCtx(false, () => { Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }); });
      await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
      await heroReady(page);
      await page.waitForTimeout(1200);
      const h = await hero(page);
      ok(h.mode === 'demo' && h.requests.length === 0 && h.sockets.length === 0 && /save data/.test(h.note), `live hero: with Save-Data on it does not connect ("${h.note}")`);
      await ctx.close();
    }
    // The one-tag element in the home chapter: off, connects on click, Live, a trade moves its last bar, Disconnect.
    // The hero is set to demo data here, so every request below is the chapter's own.
    const heroDemo = () => { try { localStorage.setItem('cl-hero-data', 'demo'); } catch (e) { /* none */ } };
    {
      const { ctx, page, errs, external } = await liveCtx(false, heroDemo);
      await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
      await settle(page);
      ok(await page.evaluate(() => !document.querySelector('#ch-live').closest('.chapter').querySelector('chartist-chart') && window.__stub.requests.length === 0) && external.length === 0, 'live chapter: off by default, no element and no request until Connect');
      await page.locator('#ch-live').scrollIntoViewIfNeeded();
      const sec = '.chapter:has(#ch-live)';
      await page.click(`${sec} [data-connect-go]`);
      await page.waitForFunction((q) => { const el = document.querySelector(`${q} chartist-chart`); const st = el && el.shadowRoot && el.shadowRoot.querySelector('.st'); return st && /^Live/.test(st.textContent); }, sec, { timeout: 8000 }).catch(() => {});
      const st = await page.evaluate((q) => { const el = document.querySelector(`${q} chartist-chart`); return { st: el ? el.shadowRoot.querySelector('.st').textContent : '', bar: document.querySelector(`${q} .live-word`).textContent, n: el && el.series ? el.series.data().length : 0, last: el && el.series ? el.series.data().at(-1) : null }; }, sec);
      ok(/^Live/.test(st.st) && /^Live/.test(st.bar) && st.n === 500, `live chapter: the element connects on click and shows Live (${st.st}, bar "${st.bar}", ${st.n} bars)`);
      const price = st.last ? +(st.last.close - 211.5).toFixed(2) : 1;
      await page.evaluate((p) => window.__stubTrade(p), price);
      await page.waitForFunction(([q, p]) => document.querySelector(`${q} chartist-chart`).series.data().at(-1).close === p, [sec, price], { timeout: 3000 }).catch(() => {});
      ok(await page.evaluate(([q, p]) => document.querySelector(`${q} chartist-chart`).series.data().at(-1).close === p, [sec, price]), 'live chapter: a stubbed trade moves the element\'s last bar');
      await page.click(`${sec} [data-connect-stop]`);
      ok(await page.evaluate((q) => !document.querySelector(`${q} chartist-chart`) && !document.querySelector(`${q} .connect-card`).hidden && document.querySelector(`${q} .live-word`).textContent === 'Off' && window.__stub.sockets.every((x) => x.readyState === 3), sec), 'live chapter: Disconnect removes the element, closes the stream and shows the card again');
      ok(errs.length === 0, 'live chapter: no console errors ' + errs.join(' | '));
      await ctx.close();
    }
    {
      const { ctx, page } = await liveCtx(true, heroDemo);
      await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
      const sec = '.chapter:has(#ch-live)';
      await page.locator('#ch-live').scrollIntoViewIfNeeded();
      await page.click(`${sec} [data-connect-go]`);
      await page.waitForFunction((q) => !document.querySelector(`${q} .connect-msg`).hidden, sec, { timeout: 12000 }).catch(() => {});
      const r = await page.evaluate((q) => ({ msg: document.querySelector(`${q} .connect-msg`).textContent, el: !!document.querySelector(`${q} chartist-chart`), word: document.querySelector(`${q} .live-word`).textContent, hosts: [...new Set(window.__stub.requests.map((u) => new URL(u).hostname))] }), sec);
      ok(/Could not reach/.test(r.msg) && !r.el && r.word === 'Off', `live chapter: when no exchange answers, the card comes back with one quiet line ("${r.msg}")`);
      ok(r.hosts.length === 3, `live chapter: the element tried Coinbase, then Binance and Kraken (${r.hosts.join(', ')})`);
      await ctx.close();
    }
    // The guide: the offline provider runs on load with no request; Connect starts a demo; the interval switch reloads.
    {
      const { ctx, page, errs, external } = await liveCtx(false);
      await page.goto(`${origin}/guide/live-data.html`, { waitUntil: 'load' });
      await settle(page);
      await waitCharts(page, 'live guide');
      ok(await page.evaluate(() => window.__stub.requests.length === 0 && window.__stub.sockets.length === 0) && external.length === 0, 'live guide: the page opens with no request to an exchange (the made-up provider needs none)');
      const fig = page.locator('figure.live:has([data-live-interval])');
      await fig.scrollIntoViewIfNeeded();
      await fig.locator('[data-connect-go]').click();
      await page.waitForFunction(() => /^Live/.test(document.querySelector('figure.live:has([data-live-interval]) .live-word').textContent), null, { timeout: 8000 }).catch(() => {});
      ok(/^Live, Coinbase$/.test(await fig.locator('.live-word').textContent()), `live guide: Connect starts the example and the bar reads "${await fig.locator('.live-word').textContent()}"`);
      const n0 = await page.evaluate(() => window.__stub.requests.length);
      await fig.locator('[data-live-interval="5m"]').click();
      await page.waitForFunction((n) => window.__stub.requests.slice(n).some((u) => /granularity=300/.test(u)), n0, { timeout: 5000 }).catch(() => {});
      ok(await page.evaluate((n) => window.__stub.requests.slice(n).some((u) => /granularity=300/.test(u)), n0), 'live guide: the 5m button switches the stream to five-minute history');
      await fig.locator('[data-connect-stop]').click();
      ok((await fig.locator('.live-word').textContent()) === 'Off' && await page.evaluate(() => window.__stub.sockets.every((x) => x.readyState === 3)), 'live guide: Disconnect closes every stream');
      ok(errs.length === 0, 'live guide: no console errors ' + errs.join(' | '));
      await ctx.close();
    }
  }

  // The feature gallery: every tab of every card draws, and "Get this code" shows exactly the code that ran.
  if (fs.existsSync(path.join(dist, 'assets', 'live', 'examples.js'))) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(`${origin}/examples.html`, { waitUntil: 'load' });
    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.fx-card')).map((c) => ({ id: c.id, tabs: c.querySelectorAll('[data-fx-tab]').length })));
    ok(cards.length >= 15, `gallery: ${cards.length} feature cards`);
    let tabs = 0; const blank = []; const mismatch = [];
    for (const card of cards) {
      for (let k = 0; k < card.tabs; k++) {
        const sel = `#${card.id}`;
        await page.locator(`${sel} [data-fx]`).scrollIntoViewIfNeeded();
        if (k > 0) await page.click(`${sel} [data-fx-tab="${k}"]`);
        const want = await page.evaluate(([s, i]) => document.querySelector(`${s} template[data-fx-src="${i}"]`).dataset.fxId, [sel, k]);
        await page.waitForFunction(([s, id]) => { const st = document.querySelector(`${s} [data-fx]`); return st.dataset.ready === '1' && (st.dataset.fxRan === id || st.querySelector('chartist-chart, chartist-terminal')); }, [sel, want], { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(250);
        const drawn = await page.evaluate((s) => {
          const st = document.querySelector(`${s} [data-fx]`);
          const all = (root) => { const l = Array.from(root.querySelectorAll('canvas')); for (const n of root.querySelectorAll('*')) if (n.shadowRoot) l.push(...all(n.shadowRoot)); return l; };
          let best = 0;
          for (const c of all(st)) { const w = c.width; const h = c.height; if (!w || !h) continue; const d = c.getContext('2d').getImageData(0, 0, w, h).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 24) n++; best = Math.max(best, n); }
          return best;
        }, sel);
        tabs++;
        if (drawn < 80) blank.push(`${card.id}#${k} (${drawn})`);
        // "Get this code": the dialog shows the tab's code; without its import lines it is the code that ran.
        await page.click(`${sel} [data-fx-code]`);
        const same = await page.evaluate((id) => {
          const shown = document.querySelector('#code-dialog-code pre').textContent;
          const ran = (window.__CL_LIVE_SRC || {})[id];
          const strip = shown.split('\n').filter((l) => !/^\s*import\s.*from\s+['"]/.test(l) && !/<script\s+src=/.test(l)).join('\n').trim();
          return document.getElementById('code-dialog').open && document.getElementById('code-dialog').dataset.fxId === id && typeof ran === 'string' && strip === ran.trim();
        }, want);
        if (!same) mismatch.push(`${card.id}#${k}`);
        if (tabs === 1) {
          await page.click('#code-dialog .copy');
          await page.waitForTimeout(150);
          const clip = await page.evaluate(() => navigator.clipboard.readText());
          ok(clip === await page.evaluate(() => document.querySelector('#code-dialog-code pre').textContent), 'gallery: "Get this code" copies the code exactly');
        }
        await page.keyboard.press('Escape');
      }
    }
    ok(blank.length === 0, `gallery: every one of ${tabs} tabs draws its chart ${blank.join(', ')}`);
    ok(mismatch.length === 0, `gallery: every "Get this code" shows the code that runs in the card ${mismatch.join(', ')}`);
    ok(await page.evaluate(() => window.__stub.requests.length === 0 && window.__stub.sockets.length === 0), 'gallery: no tab reaches an exchange');
    ok(errs.length === 0, 'gallery: no console errors ' + errs.slice(0, 3).join(' | '));
    // Smoothness while scrolling the gallery: no long task over 100 ms.
    await page.goto(`${origin}/examples.html`, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); });
    await page.evaluate(async () => { const end = document.getElementById('fx-gallery').getBoundingClientRect().bottom + scrollY; for (let y = 0; y < end; y += 120) { window.scrollTo(0, y); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); } });
    await page.waitForTimeout(600);
    const longs = await page.evaluate(() => window.__long);
    console.log(`  gallery scroll: long tasks ${longs.length ? longs.join(', ') + ' ms' : 'none'}`);
    ok(longs.every((d) => d <= 100), `gallery: no long task over 100 ms while scrolling the gallery (${longs.join(', ') || 'none'})`);
    await ctx.close();
  }

  // The indicator catalogue: filter, category, and a preview per row.
  if (fs.existsSync(path.join(dist, 'guide', 'indicator-catalogue.html'))) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(`${origin}/guide/indicator-catalogue.html`, { waitUntil: 'load' });
    const total = await page.evaluate(() => document.querySelectorAll('.cat-table tbody tr').length);
    await page.fill('#cat-filter', 'rsi');
    const shown = await page.evaluate(() => Array.from(document.querySelectorAll('.cat-table tbody tr')).filter((r) => !r.hidden).map((r) => r.querySelector('code').textContent));
    ok(total >= 80 && shown.length > 0 && shown.length < 10 && shown.includes('rsi'), `catalogue: "rsi" narrows ${total} rows to ${shown.length}`);
    await page.fill('#cat-filter', '');
    await page.click('[data-cat-filter="volume"]');
    const vol = await page.evaluate(() => Array.from(document.querySelectorAll('.cat-table tbody tr')).filter((r) => !r.hidden).map((r) => r.dataset.cat));
    ok(vol.length > 0 && vol.every((c) => c === 'volume'), `catalogue: the Volume switch shows only volume indicators (${vol.length})`);
    await page.click('[data-cat-filter="all"]');
    await page.click('[data-preview="macd"]');
    await page.waitForFunction(() => /MACD/.test(document.querySelector('[data-preview-title]').textContent), null, { timeout: 8000 }).catch(() => {});
    const pv = await page.evaluate(() => ({ title: document.querySelector('[data-preview-title]').textContent, panes: document.querySelector('[data-catalogue-chart]')._demo.chart.panes().length }));
    ok(/MACD/.test(pv.title) && pv.panes === 2, `catalogue: a row opens its live preview (${pv.title}, ${pv.panes} panes)`);
    ok(errs.length === 0, 'catalogue: no console errors ' + errs.join(' | '));
    await ctx.close();
  }

  // The comparison page: every figure about another project carries its source, or says "not stated".
  if (fs.existsSync(path.join(dist, 'guide', 'how-it-compares.html'))) {
    const html = fs.readFileSync(path.join(dist, 'guide', 'how-it-compares.html'), 'utf8');
    const table = (html.match(/<table>[\s\S]*?<\/table>/) || [''])[0];
    const rows = Array.from(table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)).slice(1).map((m) => Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]));
    const bad = [];
    for (const r of rows) for (const [k, cell] of [[2, r[2]], [3, r[3]]]) if (!cell || !(/>S[12]</.test(cell) || /not stated/.test(cell))) bad.push(`${r[0]} col ${k}`);
    ok(rows.length >= 15 && bad.length === 0, `compare: every one of ${rows.length * 2} third-party cells has a source footnote or says "not stated" ${bad.join(', ')}`);
    ok(/S1<\/td><td>TradingView Lightweight Charts page, https:\/\/www\.tradingview\.com\/lightweight-charts\/<\/td><td>2026-11-22/.test(html.replace(/\s+/g, ' ')) || (/tradingview\.com\/lightweight-charts/.test(html) && /openalgo\.in\/charts/.test(html) && /2026-11-22/.test(html)), 'compare: both sources are named with the date they were read');
    ok(/not affiliated/.test(html) && /trademarks/.test(html), 'compare: the trademark and no-affiliation line is there');
  }

  // Strict CSP: no inline script code and no style attributes in the output.
  {
    const files = listPages(dist);  // 404.html included
    let inline = 0; let styles = 0;
    for (const f of files) {
      const html = fs.readFileSync(path.join(dist, f), 'utf8');
      inline += (html.match(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/(ld\+)?json")[^>]*>/g) || []).length;
      styles += (html.match(/\sstyle="/g) || []).length;
    }
    ok(inline === 0, `csp: no inline executable scripts in ${files.length} pages (${inline})`);
    ok(styles === 0, `csp: no style attributes in the markup (${styles})`);
  }
}

// ---- final screenshots (SITE_SHOTS=1) ----
async function screenshots(browser, origin) {
  const shot = async (name, url, { width = 1440, height = 900, theme = 'dark', mobile = false, prep } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 }, null);
    await ctx.addInitScript((t) => { try { localStorage.setItem('cl-theme', t); } catch (e) { /* none */ } }, theme);
    const page = await ctx.newPage();
    await page.goto(`${origin}/${url}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    // The home hero connects to the real exchange by itself here: wait until it is live or has fallen back.
    if (url === 'index.html') await page.waitForFunction(() => { const w = document.querySelector('.hero-bar .live-word'); return w && w.textContent !== 'Connecting'; }, null, { timeout: 20000 }).catch(() => {});
    if (prep) await prep(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
    await ctx.close();
  };
  await shot('site-home-dark', 'index.html');
  await shot('site-home-light', 'index.html', { theme: 'light' });
  await shot('site-home-phone', 'index.html', { width: 390, height: 844, mobile: true });
  const guidePrep = async (page) => { await page.evaluate(() => { const h = document.querySelectorAll('.prose > h2')[1]; window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 150); }); };
  await shot('site-guide-dark', 'guide/series-types.html', { prep: guidePrep });
  await shot('site-guide-light', 'guide/series-types.html', { theme: 'light', prep: guidePrep });
  await shot('site-guide-phone', 'guide/indicators.html', { width: 390, height: 844, mobile: true, prep: guidePrep });
  await shot('site-examples-light', 'examples.html', { theme: 'light', prep: async (page) => { await page.evaluate(() => window.scrollTo(0, document.getElementById('ex-gallery').getBoundingClientRect().top + scrollY - 150)); } });
  await shot('site-api-light', 'guide/api-reference.html', { theme: 'light', prep: async (page) => { await page.fill('#api-filter', 'scale'); await page.evaluate(() => window.scrollTo(0, document.getElementById('api-filter').getBoundingClientRect().top + scrollY - 120)); } });
  await shot('site-drawings-dark', 'index.html', { prep: async (page) => { await page.evaluate(() => window.scrollTo(0, document.querySelector('.playground').getBoundingClientRect().top + scrollY - 150)); await page.waitForTimeout(600); } });
  await shot('site-search-light', 'guide/getting-started.html', { theme: 'light', prep: async (page) => { await page.keyboard.press('/'); await page.keyboard.type('price scale'); await page.waitForTimeout(300); await page.keyboard.press('ArrowDown'); } });
  await shot('site-gallery-dark', 'examples.html', { prep: async (page) => { await page.evaluate(() => window.scrollTo(0, document.getElementById('fx-gallery').getBoundingClientRect().top + scrollY - 120)); await page.waitForTimeout(1500); } });
  await shot('site-compare-light', 'guide/how-it-compares.html', { theme: 'light', prep: async (page) => { await page.evaluate(() => window.scrollTo(0, document.getElementById('side-by-side').getBoundingClientRect().top + scrollY - 100)); } });
  await shot('site-catalogue-dark', 'guide/indicator-catalogue.html', { prep: async (page) => { await page.evaluate(() => window.scrollTo(0, document.querySelector('.catalogue').getBoundingClientRect().top + scrollY - 100)); await page.waitForTimeout(1200); } });
  // The hero's posters: the widget in demo mode (invented data, so a poster never shows old prices as if current),
  // written to site/assets/img and copied into the built site.
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('cl-theme', t); localStorage.setItem('cl-hero-data', 'demo'); } catch (e) { /* none */ } }, theme);
    const page = await ctx.newPage();
    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const b = document.querySelector('[data-hero-widget]'); return b && b._hero && b._hero.widget; }, null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    const file = path.join(here, 'assets', 'img', `hero-poster-${theme}.jpg`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.locator('[data-hero-widget]').screenshot({ path: file, type: 'jpeg', quality: 72 });
    fs.copyFileSync(file, path.join(dist, 'assets', 'img', `hero-poster-${theme}.jpg`));
    await ctx.close();
  }
  // One real screenshot of the hero in live mode, only when the exchange can be reached from here. Not an assertion:
  // without network it says so and the check carries on.
  if (fs.existsSync(path.join(dist, 'assets', 'chartist-lite-live.iife.min.js'))) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }, null);
    await ctx.addInitScript(() => { try { localStorage.setItem('cl-theme', 'dark'); } catch (e) { /* none */ } });
    const page = await ctx.newPage();
    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    const reachable = await page.evaluate(async () => {
      try { return (await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60', { credentials: 'omit' })).ok; } catch (e) { return false; }
    });
    if (!reachable) console.log('site-live-dark.png skipped: Coinbase cannot be reached from here');
    else {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => { const el = document.querySelector('[data-demo="home"]'); return el && el._demo && el._demo.hero; }, null, { timeout: 8000 }).catch(() => {});
      const live = await page.waitForFunction(() => document.querySelector('.hero-bar .live-word').textContent === 'Live', null, { timeout: 25000 }).then(() => true).catch(() => false);
      if (!live) console.log('site-live-dark.png skipped: the hero did not reach Live with the real exchange');
      else {
        await page.waitForTimeout(5000);   // a few real trades
        await page.screenshot({ path: path.join(shots, 'site-live-dark.png') });
        console.log('site-live-dark.png written from the real Coinbase feed');
      }
    }
    await ctx.close();
  }
  // The README's hero pair: the ready-made chart on demo data, 1100 x 620 CSS px at device scale 2, no page around it,
  // small rounded corners on a transparent background (so it sits on GitHub's light and dark pages alike).
  if (fs.existsSync(path.join(dist, 'assets', 'chartist-lite.terminal.iife.min.js'))) {
    const tmp = path.join(dist, '_readme-hero.html');
    for (const theme of ['dark', 'light']) {
      fs.writeFileSync(tmp, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>hero</title><style>html,body{margin:0;background:transparent}#w{width:1100px;height:620px;border-radius:12px;overflow:hidden}</style></head><body><div id="w"></div><script src="assets/chartist-lite.terminal.iife.min.js" data-manual></script><script>window.__w=ChartistLiteTerminal.createWidget('w',{theme:'${theme}',data:ChartistLiteTerminal.demoBars('DEMO','1D',400),symbol:{symbol:'DEMO',description:'Demo data'},interval:'1D',indicators:['ema','rsi']});</script></body></html>`);
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 2 }, null);
      const page = await ctx.newPage();
      await page.goto(`${origin}/_readme-hero.html`, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      await page.locator('#w').screenshot({ path: path.join(shots, `readme-hero-${theme}.png`), omitBackground: true });
      await ctx.close();
    }
    fs.unlinkSync(tmp);
  }
  // The README tour's two site shots, from the plain site: the zone switch and the keyboard inspect mode.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }, null);
    await ctx.addInitScript(() => { try { localStorage.setItem('cl-theme', 'dark'); localStorage.setItem('cl-hero-data', 'demo'); } catch (e) { /* none */ } });
    const page = await ctx.newPage();
    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await page.locator('[data-demo="zone"]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('[data-demo="zone"]').dataset.ready === '1' && document.querySelector('[data-demo="keys"]').dataset.ready === '1', null, { timeout: 8000 }).catch(() => {});
    await page.click('button[data-zone="America/New_York"]');
    await page.waitForTimeout(400);
    await page.locator('.window:has([data-demo="zone"])').screenshot({ path: path.join(shots, 'site-tour-timezones.png') });
    await page.evaluate(() => document.querySelector('[data-demo="keys"]')._demo.charts[0].element().focus());
    await page.keyboard.press('Enter');
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    await page.locator('.window:has([data-demo="keys"])').screenshot({ path: path.join(shots, 'site-tour-keyboard.png') });
    await ctx.close();
  }
  // How the README reads on GitHub: its column is about 880 px; rendered here with this site's Markdown renderer (the
  // HTML subset GitHub allows) on GitHub's light and dark page colours. For review, not published.
  {
    const { renderMarkdown } = await import(require('node:url').pathToFileURL(path.join(here, 'markdown.mjs')).href);
    const pkgDir = path.join(here, '..');
    const html = renderMarkdown(fs.readFileSync(path.join(pkgDir, 'README.md'), 'utf8'), {
      html: true,
      resolveAsset: (src) => require('node:url').pathToFileURL(path.join(pkgDir, src)).href,
      resolveLink: (href) => ({ href }),
      imageSize: () => null,
    }).html;
    const outDir = scratch || path.join(dist, 'review');
    fs.mkdirSync(outDir, { recursive: true });
    for (const [theme, bg, fg, border] of [['dark', '#0d1117', '#e6edf3', '#30363d'], ['light', '#ffffff', '#1f2328', '#d1d9e0']]) {
      const file = path.join(outDir, `readme-github-${theme}.html`);
      fs.writeFileSync(file, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>README</title><style>body{margin:0;background:${bg};color:${fg};font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif}main{width:880px;box-sizing:border-box;padding:32px;margin:0 auto;border:1px solid ${border};border-radius:6px}img{max-width:100%;height:auto}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid ${border};padding:6px 13px}pre{background:${theme === 'dark' ? '#151b23' : '#f6f8fa'};padding:16px;overflow:auto;border-radius:6px}code{font-size:85%}a{color:${theme === 'dark' ? '#4493f8' : '#0969da'}}h1,h2{border-bottom:1px solid ${border};padding-bottom:.3em}</style></head><body><main>${html}</main></body></html>`);
      const ctx = await browser.newContext({ viewport: { width: 960, height: 1400 }, colorScheme: theme }, null);
      const page = await ctx.newPage();
      await page.goto(require('node:url').pathToFileURL(file).href, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(outDir, `readme-880-${theme}.png`) });
      await page.screenshot({ path: path.join(outDir, `readme-880-${theme}-full.png`), fullPage: true });
      await ctx.close();
    }
    console.log(`README rendered at 880 px for review: ${outDir}/readme-880-{dark,light}.png`);
  }
  console.log('screenshots written to docs/screenshots/site-*.png');
}

(async () => {
  console.log('building the site');
  execFileSync(process.execPath, [path.join(here, 'build.mjs')], { stdio: 'inherit' });
  // 404.html is checked on its own below: it carries a <base> at the public site address, so it is not visited here.
  const pages = listPages(dist).filter((p) => p !== '404.html');
  {
    const nf = fs.readFileSync(path.join(dist, '404.html'), 'utf8');
    ok(/<base href="https?:[^"]+\/">/.test(nf) && /<meta name="robots" content="noindex">/.test(nf) && (nf.match(/<h1\b/g) || []).length === 1, '404.html: one h1, noindex, and a <base> at the site address so it works at any depth');
    ok(!fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8').includes('404.html'), '404.html: not in the sitemap');
    ok(fs.existsSync(path.join(dist, '.nojekyll')), '.nojekyll is written for GitHub Pages');
  }
  console.log(`${pages.length} pages: ${pages.join(', ')}`);

  const sitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
  ok((sitemap.match(/<loc>/g) || []).length === pages.length, `sitemap.xml lists ${(sitemap.match(/<loc>/g) || []).length} URLs for ${pages.length} pages`);
  ok(/Sitemap: /.test(fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8')), 'robots.txt names the sitemap');

  const { server, port } = await serve('/');
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  // Every context works with no network: other hosts are blocked and the exchanges' fetch and WebSocket are stubbed in
  // the page (the home hero connects by itself). Pass { fail: true } for a failing exchange, or null for the real
  // network (the final screenshots only).
  const rawContext = browser.newContext.bind(browser);
  browser.newContext = async (opts = {}, live = { fail: false }) => {
    const ctx = await rawContext(opts);
    if (live === null) return ctx;
    await ctx.route((u) => isExternal(String(u)), (r) => r.abort());
    await ctx.addInitScript(liveStub, live);
    return ctx;
  };
  const titles = new Map(); const descs = new Map();
  const linkCache = new Map();
  const docIds = new Map();

  async function getIds(ctx, url) {
    if (docIds.has(url)) return docIds.get(url);
    const res = await ctx.request.get(url);
    const html = res.ok() ? await res.text() : '';
    const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g)).map((m) => m[1]));
    docIds.set(url, { status: res.status(), ids });
    return docIds.get(url);
  }

  const profiles = [
    { name: '1280', width: 1280, height: 900 },
    { name: '390', width: 390, height: 844, mobile: true },
  ];
  for (const prof of profiles) for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: prof.width, height: prof.height }, colorScheme: scheme, isMobile: !!prof.mobile, hasTouch: !!prof.mobile, deviceScaleFactor: prof.mobile ? 2 : 1 });
    await ctx.addInitScript((t) => { try { localStorage.setItem('cl-theme', t); } catch (e) { /* none */ } }, scheme);
    for (const pg of pages) {
      const label = `${pg} @${prof.name} ${scheme}`;
      const page = await ctx.newPage();
      const problems = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text()}`); });
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
      // Nothing may reach another host while a page opens and scrolls: live demos connect only on a click.
      const external = [];
      page.on('request', (r) => { if (isExternal(r.url())) external.push(r.url()); });
      page.on('websocket', (w) => external.push(w.url()));
      await page.goto(`${origin}/${pg}`, { waitUntil: 'load' });
      await settle(page);
      const d = await page.evaluate(inPagePassive);
      if (d.hasCharts) await waitCharts(page, label);
      ok(problems.length === 0, `${label}: console and network clean ${problems.join(' | ')}`);
      ok(external.length === 0, `${label}: no request to another host on load ${external.slice(0, 3).join(' | ')}`);
      if (pg !== 'index.html') {
        const used = await page.evaluate(() => window.__stub ? window.__stub.requests.length + window.__stub.sockets.length : 0);
        ok(used === 0, `${label}: no live demo connects by itself (${used} exchange requests); only the home hero does`);
      }
      ok(d.h1 === 1, `${label}: exactly one h1 (found ${d.h1})`);
      ok(!!d.title && !!d.desc, `${label}: title and description present`);
      ok(d.overflow <= 0, `${label}: no horizontal overflow (${d.overflow}px)`);
      ok(d.lang === 'en' && d.skip && d.main === 1, `${label}: lang, skip link and one main landmark`);
      ok(!!d.canonical && !!d.ogTitle && !!d.ogImage && d.twCard === 'summary_large_image', `${label}: canonical, Open Graph and Twitter tags`);
      ok(d.ldCount >= 1 && d.ldOk, `${label}: JSON-LD present and valid JSON (${d.ldCount} blocks)`);
      ok(d.dupIds.length === 0, `${label}: unique ids ${d.dupIds.join(',')}`);
      ok(d.headingsOk, `${label}: every h2 and h3 has an id`);
      ok(!d.emDash, `${label}: no em dash in visible text`);
      ok(d.grouped.length === 0, `${label}: no grouping commas in numbers ${d.grouped.join(',')}`);
      ok(d.hyphenNeg.length === 0, `${label}: no hyphen used as a minus ${d.hyphenNeg.join(',')}`);
      ok(d.minFont >= 12, `${label}: no text under 12px ${d.smallFonts.slice(0, 3).join(' ')}`);
      ok(d.lowContrast.length === 0, `${label}: text contrast at least 4.5:1 ${d.lowContrast.slice(0, 3).join(' | ')}`);
      ok(d.imgs.every((i) => i.alt && i.w && i.h), `${label}: images have alt, width and height`);
      ok(d.anchors.every((a) => d.ids.includes(a)), `${label}: in-page anchors resolve`);

      if (prof.name === '1280' && scheme === 'light') {
        ok(!titles.has(d.title), `title unique: ${d.title}`); titles.set(d.title, pg);
        ok(!descs.has(d.desc), `description unique: ${pg}`); descs.set(d.desc, pg);
        ok(d.title.length <= 75, `${pg}: title length ${d.title.length} is at most 75`);
        ok(d.desc.length >= 50 && d.desc.length <= 180, `${pg}: description length ${d.desc.length}`);
        // Internal links: the file exists and the fragment exists in it.
        for (const href of d.links) {
          const url = new URL(href, `${origin}/${pg}`).toString();
          const [base, frag] = url.split('#');
          if (!linkCache.has(base)) linkCache.set(base, await getIds(ctx, base));
          const target = linkCache.get(base);
          ok(target.status === 200, `${pg}: link ${href} resolves (HTTP ${target.status})`);
          if (frag && target.status === 200) ok(target.ids.has(frag), `${pg}: link ${href} fragment exists`);
        }
      }

      if (d.hasCharts) {
        const charts = await page.evaluate(inPageCharts);
        ok(charts.length > 0, `${label}: live charts found`);
        for (const c of charts) {
          ok(c.diff > 300, `${label}: ${c.kind} canvas is non-empty (${c.diff} drawn pixels)`);
          if (!c.themeFree) ok(c.bright >= 0 && (scheme === 'dark' ? c.bright < 80 : c.bright > 200), `${label}: ${c.kind} canvas background matches the ${scheme} theme (brightness ${c.bright})`);
          ok(c.w > 0 && c.w <= prof.width, `${label}: ${c.kind} fits the viewport (${Math.round(c.w)}px)`);
        }
      }

      if (prof.mobile) {
        const small = await page.evaluate(() => {
          const out = [];
          if (!matchMedia('(pointer: coarse)').matches) return ['pointer is not coarse in this context'];
          for (const el of document.querySelectorAll('.btn, .chip, .seg button, .copy, .icon-btn, .search-btn, .main-nav a, .footer-nav a, .nav-list a, .nav-step, .guide-menu, .page-toc a, .chapters a, .pager a, .crumb a, .related a, .skip')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)} "${el.textContent.trim().slice(0, 20)}"`);
          }
          return out;
        });
        ok(small.length === 0, `${label}: touch targets are at least 44px ${small.slice(0, 3).join(' | ')}`);
      }

      await page.close();
    }
    await ctx.close();
  }

  // Theme toggle: the page and the charts switch together.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(`${origin}/examples.html`, { waitUntil: 'load' });
    await settle(page); await waitCharts(page, 'examples toggle');
    const before = await page.evaluate(inPageCharts);
    ok(before.filter((c) => !c.themeFree).every((c) => c.bright > 200), 'toggle: with a light system and no choice, every chart starts light');
    await page.click('#theme-toggle');
    await page.waitForTimeout(500);
    const after = await page.evaluate(inPageCharts);
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'toggle: page switches to dark');
    ok(after.filter((c) => !c.themeFree).every((c) => c.bright < 80 && c.diff > 300), 'toggle: every chart repaints dark and stays non-empty ' + JSON.stringify(after.map((c) => c.bright)));
    ok(await page.evaluate(() => document.getElementById('theme-toggle').getAttribute('aria-pressed')) === 'true', 'toggle: aria-pressed follows (pressed means dark)');
    await page.reload({ waitUntil: 'load' });
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'toggle: the choice is remembered after a reload, before first paint');
    // Zone switch changes the axis labels without errors.
    await page.locator('button[data-zone="America/New_York"]').scrollIntoViewIfNeeded();
    await page.click('button[data-zone="America/New_York"]');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.querySelector('button[data-zone="America/New_York"]').getAttribute('aria-pressed')) === 'true', 'zone switch: pressed state follows');
    ok(problems.length === 0, 'toggle and zone switch: no console errors ' + problems.join(' | '));
    await ctx.close();
  }

  // Under a sub-path and from file://: relative URLs only.
  {
    const sub = await serve('/some/sub/path/');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    for (const [label, url] of [['sub-path', `http://127.0.0.1:${sub.port}/some/sub/path/index.html`], ['sub-path guide', `http://127.0.0.1:${sub.port}/some/sub/path/guide/indicators.html`], ['file://', 'file://' + path.join(dist, 'examples.html')], ['file:// guide', 'file://' + path.join(dist, 'guide', 'series-types.html')]]) {
      const page = await ctx.newPage();
      const problems = [];
      page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
      page.on('pageerror', (e) => problems.push(e.message));
      page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
      await page.goto(url, { waitUntil: 'load' });
      await settle(page); await waitCharts(page, label);
      const charts = await page.evaluate(inPageCharts);
      ok(charts.length > 0 && charts.every((c) => c.diff > 300), `${label}: live charts draw (${charts.length})`);
      ok(problems.length === 0, `${label}: no console or network errors ${problems.join(' | ')}`);
      await page.close();
    }
    await ctx.close(); sub.server.close();
  }

  await interactive(browser, origin);
  if (process.env.SITE_SHOTS) await screenshots(browser, origin);

  await browser.close(); server.close();
  console.log(`\n${assertions} assertions, ${failures.length} failed`);
  if (failures.length) { console.error(failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
