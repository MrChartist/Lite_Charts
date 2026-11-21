// Verifies the built site in real Chromium (Playwright must be importable; it is not a dependency of this package).
//   node site/check.cjs
// Builds the site, serves site/dist, visits every page at 1280 and 390 wide in light and dark and asserts the list in
// the CHECKS table below. Also loads the home page from file:// and under a sub-path. Writes the home screenshots to
// docs/screenshots/site-*.png. Exit code 1 when anything fails.
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

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain' };
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

(async () => {
  console.log('building the site');
  execFileSync(process.execPath, [path.join(here, 'build.mjs')], { stdio: 'inherit' });
  const pages = listPages(dist);
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
          for (const el of document.querySelectorAll('.btn, .main-nav a, .footer-nav a, .toc a, .pager a, .side-nav a, .crumbs a, details.mobile-nav summary, .skip')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)} "${el.textContent.trim().slice(0, 20)}"`);
          }
          return out;
        });
        ok(small.length === 0, `${label}: touch targets are at least 44px ${small.slice(0, 3).join(' | ')}`);
      }

      if (pg === 'index.html') {
        const name = `site-home-${prof.mobile ? 'phone' : scheme}`;
        if (!prof.mobile || scheme === 'light') {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: path.join(shots, `${name}.png`) });
          if (scratch) await page.screenshot({ path: path.join(scratch, `${name}-full.png`), fullPage: true });
        }
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
    ok(before.every((c) => c.bright > 200), 'toggle: every chart starts light');
    await page.click('#theme-toggle');
    await page.waitForTimeout(500);
    const after = await page.evaluate(inPageCharts);
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'toggle: page switches to dark');
    ok(after.every((c) => c.bright >= 0 && c.bright < 80 && c.diff > 300), 'toggle: every chart repaints dark and stays non-empty ' + JSON.stringify(after.map((c) => c.bright)));
    ok(await page.evaluate(() => document.getElementById('theme-toggle').getAttribute('aria-pressed')) === 'true', 'toggle: aria-pressed follows');
    await page.reload({ waitUntil: 'load' });
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'toggle: the choice is remembered after a reload');
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
    for (const [label, url] of [['sub-path', `http://127.0.0.1:${sub.port}/some/sub/path/index.html`], ['file://', 'file://' + path.join(dist, 'examples.html')]]) {
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

  await browser.close(); server.close();
  console.log(`\n${assertions} assertions, ${failures.length} failed`);
  if (failures.length) { console.error(failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
