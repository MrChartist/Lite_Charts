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
  const best = (root) => Array.from(root.querySelectorAll('canvas')).map(info).sort((a, b) => b.diff - a.diff)[0] || { diff: 0, bright: -1 };
  const out = [];
  for (const el of document.querySelectorAll('[data-demo]')) out.push({ kind: 'demo:' + el.dataset.demo, ...best(el), w: el.getBoundingClientRect().width });
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
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-demo]')).every((e) => e.dataset.ready === '1' && e.querySelector('canvas'))
      && Array.from(document.querySelectorAll('chartist-chart')).every((e) => e.chart && e.shadowRoot && e.shadowRoot.querySelector('canvas')), null, { timeout: 8000 });
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
    // Scroll-spy on the home chapters.
    await page.evaluate(() => document.getElementById('ch-panes').scrollIntoView());
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.querySelector('nav.chapters a[aria-current="true"]').getAttribute('href') === '#ch-panes'), 'scroll-spy: the home capsule marks the chapter in view');
    // Frame meter.
    await page.evaluate(() => document.getElementById('meter').scrollIntoView({ block: 'center' }));
    await page.waitForFunction(() => /Median/.test(document.getElementById('meter-read').textContent), null, { timeout: 15000 }).catch(() => {});
    const meter = await page.evaluate(() => document.getElementById('meter-read').textContent);
    ok(/Median [\d.]+ ms/.test(meter), `meter: it measures frames on this device ("${meter.slice(0, 80)}")`);
    ok(errs.length === 0, 'home interactions: no console errors ' + errs.join(' | '));
    // Scroll-spy on a guide page.
    await page.goto(`${origin}/guide/panes-and-scales.html`, { waitUntil: 'load' });
    const id = await page.evaluate(() => document.querySelectorAll('.prose > h2')[1].id);
    await page.evaluate((x) => document.getElementById(x).scrollIntoView(), id);
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.querySelector('nav.chapters a[aria-current="true"]').getAttribute('href')) === `#${id}`, `scroll-spy: a guide capsule marks the second chapter (#${id})`);
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
    ok(total > 60 && vis.length > 0 && vis.length < 8 && vis.includes('series.setdata'), `api filter: "setdata" narrows ${total} entries to ${vis.length}`);
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
    const chip = await page.evaluate(() => document.querySelector('.fc-2').textContent);
    ok(chip.includes(`${worst.toFixed(1)} ms of 8.33`), `120 Hz: the hero chip shows the measured worst p95 (${chip})`);
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
    await page.goto(`${origin}/guide/coming-from-lightweight-charts.html`, { waitUntil: 'load' });
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

  // Fonts: the brand faces load over http, and their arrival barely moves the layout.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
    await page.goto(`${origin}/guide/series-types.html`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    const fonts = await page.evaluate(() => Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
    ok(fonts.includes('Chartist Sans') && fonts.includes('Chartist Sans Flex'), `fonts: Chartist Sans and Chartist Sans Flex load (${[...new Set(fonts)].join(', ')})`);
    const cls = await page.evaluate(() => window.__cls);
    ok(cls < 0.05, `fonts: layout shift while fonts and charts arrive is ${cls.toFixed(4)} (under 0.05)`);
    await ctx.close();
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
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    await ctx.addInitScript((t) => { try { localStorage.setItem('cl-theme', t); } catch (e) { /* none */ } }, theme);
    const page = await ctx.newPage();
    await page.goto(`${origin}/${url}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    if (prep) await prep(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
    await ctx.close();
  };
  await shot('site-home-dark', 'index.html');
  await shot('site-home-light', 'index.html', { theme: 'light' });
  await shot('site-home-phone', 'index.html', { width: 390, height: 844, mobile: true });
  const guidePrep = async (page) => { await page.evaluate(() => { const h = document.querySelectorAll('.prose > .chapter-label')[1]; window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 150); }); };
  await shot('site-guide-dark', 'guide/series-types.html', { prep: guidePrep });
  await shot('site-guide-light', 'guide/series-types.html', { theme: 'light', prep: guidePrep });
  await shot('site-guide-phone', 'guide/indicators.html', { width: 390, height: 844, mobile: true, prep: guidePrep });
  await shot('site-examples-light', 'examples.html', { theme: 'light', prep: async (page) => { await page.evaluate(() => window.scrollTo(0, document.getElementById('ex-gallery').getBoundingClientRect().top + scrollY - 150)); } });
  await shot('site-api-light', 'guide/api-reference.html', { theme: 'light', prep: async (page) => { await page.fill('#api-filter', 'scale'); await page.evaluate(() => window.scrollTo(0, document.getElementById('api-filter').getBoundingClientRect().top + scrollY - 120)); } });
  await shot('site-drawings-dark', 'index.html', { prep: async (page) => { await page.evaluate(() => window.scrollTo(0, document.querySelector('.playground').getBoundingClientRect().top + scrollY - 150)); await page.waitForTimeout(600); } });
  await shot('site-search-light', 'guide/getting-started.html', { theme: 'light', prep: async (page) => { await page.keyboard.press('/'); await page.keyboard.type('price scale'); await page.waitForTimeout(300); await page.keyboard.press('ArrowDown'); } });
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
      await page.goto(`${origin}/${pg}`, { waitUntil: 'load' });
      await settle(page);
      const d = await page.evaluate(inPagePassive);
      if (d.hasCharts) await waitCharts(page, label);
      ok(problems.length === 0, `${label}: console and network clean ${problems.join(' | ')}`);
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
          ok(c.bright >= 0 && (scheme === 'dark' ? c.bright < 80 : c.bright > 200), `${label}: ${c.kind} canvas background matches the ${scheme} theme (brightness ${c.bright})`);
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
    ok(before.every((c) => c.bright >= 0 && c.bright < 80), 'toggle: dark is the default and every chart starts dark');
    await page.click('#theme-toggle');
    await page.waitForTimeout(500);
    const after = await page.evaluate(inPageCharts);
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'toggle: page switches to light');
    ok(after.every((c) => c.bright > 200 && c.diff > 300), 'toggle: every chart repaints light and stays non-empty ' + JSON.stringify(after.map((c) => c.bright)));
    ok(await page.evaluate(() => document.getElementById('theme-toggle').getAttribute('aria-pressed')) === 'false', 'toggle: aria-pressed follows (pressed means dark)');
    await page.reload({ waitUntil: 'load' });
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'toggle: the choice is remembered after a reload, before first paint');
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
