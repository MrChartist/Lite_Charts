// Phone-layout smoke check in every engine Playwright drives (Chromium, Firefox, WebKit). WebKit is the engine behind
// every browser on an iPhone, and it is the one the Chromium-only phone audit (scripts/phone-audit.cjs) cannot show.
// Only cross-engine APIs are used: page.touchscreen.tap, evaluate, waitForFunction (no CDP).
//
// For `iPhone SE` and `iPhone 14` (Playwright's device profiles) it opens examples/phone-article.html and checks:
//   - the widget loads with no page error and a non-empty canvas;
//   - the page does not scroll sideways (documentElement.scrollWidth <= innerWidth), at load and after each step;
//   - the top bar's More button is fully inside the viewport;
//   - symbol search opened by tap: the input's font-size is at least 16px (iOS zooms the page on focus otherwise);
//   - a sheet (indicators) closes on a tap on the dimmed scrim, and that tap reaches nothing underneath it
//     (the widget's saved state, the legend and the page scroll are unchanged);
//   - full screen by tap, as an iPhone gets it (the fallback path): the widget box covers the viewport, the page's
//     scroll is locked, and exiting gives the scroll and the overflow back;
//   - env(safe-area-inset-*) padding (full screen, bottom sheets) parses to real, non-negative sizes.
//
// Usage: node scripts/smoke-phone.cjs [chromium firefox webkit]      (needs `npm run build` first)
// Firefox has no isMobile: it runs with the profile's viewport, scale, user agent and hasTouch only.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const pw = require('playwright');

const root = path.join(__dirname, '..');
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];
const DEVICES = ['iPhone SE', 'iPhone 14'];
const PAGE = 'examples/phone-article.html';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, path.normalize(p));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

/** A device profile in a form the engine accepts. */
function profile(name, engine) {
  const d = { ...pw.devices[name] };
  if (!d.viewport) throw new Error(`unknown device ${name}`);
  delete d.defaultBrowserType; // the engine is chosen by the caller
  if (engine === 'firefox') { delete d.isMobile; d.hasTouch = true; }
  return d;
}

const failures = [];
let checks = 0;
/** Record one check: `ok` or a failure with its message. */
function check(ctx, ok, message) {
  checks++;
  if (!ok) failures.push(`${ctx}: ${message}`);
  return ok;
}

// ── in-page helpers (run inside the page; they pierce the widget's shadow roots) ──

/** Centre of a visible control by aria-label (exact, or the label then " (" or ":"), inside a scope selector. */
function findControl([label, scope]) {
  const s = document.querySelector('[data-chartist-widget]').shadowRoot;
  for (const el of s.querySelectorAll(`${scope} button, ${scope} [role^=menuitem], ${scope} .mi`)) {
    const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
    if (!(name === label || name.startsWith(label + ' (') || name.startsWith(label + ':'))) continue;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    // A long sheet scrolls: bring the item into view first, as a finger would.
    if (el.closest('.menu, .dlg')) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
  }
  return null;
}

async function main() {
  if (!fs.existsSync(path.join(root, 'dist', 'chartist-lite-widget.iife.min.js'))) throw new Error('run `npm run build` first');
  const { server, base } = await serve();
  let launchFailed = false;

  for (const engine of wanted) {
    if (!pw[engine]) { console.log(`${engine}: unknown engine`); launchFailed = true; continue; }
    let browser;
    try { browser = await pw[engine].launch(); } catch (e) { console.log(`${engine}: could not start (${String(e.message).split('\n')[0]})`); launchFailed = true; continue; }
    for (const device of DEVICES) {
      const ctxName = `${engine} / ${device}`;
      const before = failures.length;
      const context = await browser.newContext({ ...profile(device, engine), reducedMotion: 'no-preference' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
      // No live ticks while the checks compare states.
      await page.addInitScript(() => { window.__noTicks = true; });
      try {
        await runDevice(page, base, ctxName, errors);
      } catch (e) {
        failures.push(`${ctxName}: the check itself threw: ${String(e.message).split('\n')[0]}`);
      }
      console.log(`${ctxName}: ${failures.length === before ? 'ok' : 'FAILED'}`);
      await context.close();
    }
    await browser.close();
  }
  server.close();
  console.log(`${checks} checks`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(launchFailed || failures.length ? 1 : 0);
}

async function runDevice(page, base, ctxName, errors) {
  const tap = async p => { await page.touchscreen.tap(p.x, p.y); };
  const settle = ms => page.waitForTimeout(ms);
  const ctl = (label, scope = '') => page.evaluate(findControl, [label, scope]);
  const layerOpen = () => page.evaluate(() => !!document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.menu, .dlg'));
  const closed = () => page.waitForFunction(() => !document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.menu, .dlg'), null, { timeout: 3000 }).then(() => true, () => false);
  const noSideScroll = async when => {
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check(ctxName, m.sw <= m.iw, `the page scrolls sideways ${when} (scrollWidth ${m.sw} > innerWidth ${m.iw})`);
  };
  /** Tap a control by label: in the bar, else through the top (then bottom) More sheet. */
  async function tapControl(label, beforeTap) {
    let b = await ctl(label, '.bar');
    if (b) { if (beforeTap) await beforeTap(); await tap(b); await settle(300); return true; }
    for (const which of ['.top', '.bot']) {
      const more = await ctl('More', which);
      if (!more) continue;
      await tap(more); await settle(350);
      b = await ctl(label, '.menu');
      if (b) { if (beforeTap) await beforeTap(); await tap(b); await settle(350); return true; }
      console.log(`  diag ${ctxName}: "${label}" not found after tapping ${which} More at ${JSON.stringify(more)}: ` + await page.evaluate(([mx, my]) => {
        const s = document.querySelector('[data-chartist-widget]').shadowRoot;
        const hit = s.elementFromPoint(mx, my), dh = document.elementFromPoint(mx, my);
        const names = sel => [...s.querySelectorAll(sel)].map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20) + (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ? '(hidden)' : ''));
        return JSON.stringify({ menu: !!s.querySelector('.menu'), dlg: !!s.querySelector('.dlg'), hit: hit && (hit.className + '|' + (hit.getAttribute('aria-label') || '')), docHit: dh && dh.tagName + '.' + dh.className, menuItems: names('.menu button, .menu [role^=menuitem], .menu .mi'), bar: names('.bar button'), vv: [innerWidth, innerHeight, scrollX, scrollY, visualViewport && visualViewport.scale], fs: document.querySelector('[data-chartist-widget]').hasAttribute('data-fs') });
      }, [more.x, more.y]));
      await page.keyboard.press('Escape'); await closed();
    }
    return false;
  }

  // 1. loads: no page errors, a non-empty canvas.
  await page.goto(`${base}/${PAGE}`, { waitUntil: 'load' });
  const ready = await page.waitForFunction(() => window.__widget && window.__widget.chart.panes()[0].getSeries()[0]?.data().length > 50, null, { timeout: 20000 }).then(() => true, () => false);
  if (!check(ctxName, ready, `${PAGE} did not load the widget with data`)) return;
  await settle(500);
  const canvas = await page.evaluate(() => {
    const cs = [...window.__widget.chart.element().querySelectorAll('canvas')];
    let colours = 0;
    for (const c of cs) {
      if (!c.width || !c.height) continue;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2] + ',' + d[i + 3]);
      colours = Math.max(colours, seen.size);
    }
    return { canvases: cs.length, colours };
  });
  check(ctxName, canvas.canvases > 0 && canvas.colours >= 3, `the chart canvas is empty (${canvas.canvases} canvases, ${canvas.colours} colours)`);
  check(ctxName, errors.length === 0, `page errors after load: ${errors.slice(0, 3).join(' | ')}`);

  // 2. no horizontal page scroll.
  await noSideScroll('after load');

  // 3. the top bar's More button is fully inside the viewport.
  const more = await page.evaluate(() => {
    const el = [...document.querySelector('[data-chartist-widget]').shadowRoot.querySelectorAll('.top button')].find(b => (b.getAttribute('aria-label') || '').trim() === 'More' && b.checkVisibility());
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, iw: window.innerWidth, ih: window.innerHeight };
  });
  if (check(ctxName, !!more, 'no visible More button in the top bar')) {
    check(ctxName, more.l >= -0.5 && more.r <= more.iw + 0.5 && more.t >= -0.5 && more.b <= more.ih + 0.5,
      `the top bar More button is outside the viewport (box ${Math.round(more.l)}..${Math.round(more.r)} x ${Math.round(more.t)}..${Math.round(more.b)} in ${more.iw}x${more.ih})`);
  }

  // 4. symbol search by tap: the input is at least 16px (the page zooms on focus below that).
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  const sym = await ctl('Search symbol', '.top');
  if (check(ctxName, !!sym, 'no Search symbol control in the top bar')) {
    await tap(sym); await settle(400);
    const field = await page.evaluate(() => {
      const i = [...document.querySelector('[data-chartist-widget]').shadowRoot.querySelectorAll('input')].find(x => x.checkVisibility && x.checkVisibility());
      return i ? { fs: parseFloat(getComputedStyle(i).fontSize) } : null;
    });
    if (check(ctxName, !!field, 'tapping Search symbol opened no input')) {
      // Firefox without isMobile reports a fine pointer, so the widget's coarse-pointer styles do not apply to it.
      if (coarse) check(ctxName, field.fs >= 16, `the symbol search input is ${field.fs}px (below 16px, iOS zooms the page on focus)`);
      else if (ctxName.startsWith('firefox')) console.log(`  ${ctxName}: pointer is not coarse in this engine, the 16px field rule is not applied`);
      else check(ctxName, false, 'the phone profile does not report a coarse pointer');
    }
    await page.keyboard.press('Escape'); await closed();
  }

  // 5. a sheet closes on a tap on the scrim, and the tap reaches nothing under it.
  const snapshot = () => page.evaluate(() => {
    const w = window.__widget, s = document.querySelector('[data-chartist-widget]').shadowRoot;
    return JSON.stringify({
      save: w.save(), n: w.indicators().length, interval: w.save().interval, sy: window.scrollY,
      legend: [...s.querySelectorAll('.lg .row')].map(r => r.textContent.trim()),
      range: w.chart.timeScale().getVisibleLogicalRange(),
    });
  });
  const openIndicators = async () => { if (!(await tapControl('Indicators'))) return false; await settle(450); return await layerOpen(); };
  const scrimPoints = () => page.evaluate(() => {
    const s = document.querySelector('[data-chartist-widget]').shadowRoot;
    const scrim = s.querySelector('.scrim');
    if (!scrim) return null;
    const sr = scrim.getBoundingClientRect();
    const hitsScrim = (x, y) => { const e = s.elementFromPoint(x, y); return !!e && e.classList.contains('scrim'); };
    const out = [];
    // Over a top bar control (a tap that fell through would press it) and over the chart (it would move the crosshair).
    for (const b of s.querySelectorAll('.top .b')) {
      if (b.classList.contains('hide') || !b.checkVisibility()) continue;
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (hitsScrim(x, y)) { out.push({ x, y, what: `the top bar "${(b.getAttribute('aria-label') || b.textContent).trim().slice(0, 24)}"` }); break; }
    }
    const card = s.querySelector('.card').getBoundingClientRect();
    for (const fy of [0.15, 0.25, 0.35]) {
      const x = card.left + card.width * 0.6, y = card.top + card.height * fy;
      if (x >= sr.left && x <= sr.right && hitsScrim(x, y)) { out.push({ x, y, what: 'the chart' }); break; }
    }
    return out;
  });
  const sheetOpen = await openIndicators();
  if (check(ctxName, sheetOpen, 'could not open the indicators sheet by tap')) {
    const probe = await scrimPoints();
    if (check(ctxName, !!probe && probe.length > 0, 'the open sheet has no dimmed scrim to tap')) {
      await page.keyboard.press('Escape'); await closed();
      for (const target of probe) {
        // Open again and measure the state with the sheet closed, so only the scrim tap can change it.
        const base0 = await snapshot();
        if (!(await openIndicators())) { check(ctxName, false, 'could not open the indicators sheet again'); continue; }
        const pts = (await scrimPoints()).find(p => p.what === target.what);
        if (!check(ctxName, !!pts, `no scrim over ${target.what} with the sheet open`)) { await page.keyboard.press('Escape'); await closed(); continue; }
        await tap(pts); await settle(400);
        check(ctxName, await closed(), `a tap on the scrim over ${target.what} did not close the sheet`);
        await settle(200);
        check(ctxName, (await snapshot()) === base0, `a tap on the scrim over ${target.what} changed the widget underneath it`);
      }
    }
  }
  await noSideScroll('after the sheet');

  // 6. full screen, the fallback path (an iPhone has no element full screen API).
  await page.evaluate(() => { Element.prototype.requestFullscreen = undefined; HTMLElement.prototype.requestFullscreen = undefined; });
  await page.evaluate(() => window.scrollTo(0, 120));
  await settle(200);
  // The page scroll the reader has at the moment of the tap (reaching a control inside a sheet may scroll the page to it).
  let pre = null;
  const readPage = () => page.evaluate(() => ({ sy: window.scrollY, inline: document.documentElement.style.overflow, computed: getComputedStyle(document.documentElement).overflowY }));
  if (check(ctxName, await tapControl('Full screen', async () => { pre = await readPage(); }), 'no Full screen control reachable by tap')) {
    check(ctxName, pre.sy > 0, `the article page cannot scroll (scrollY ${pre.sy}), so the scroll lock cannot be checked`);
    await settle(500);
    const fs1 = await page.evaluate(() => {
      const s = document.querySelector('[data-chartist-widget]').shadowRoot, w = s.querySelector('.w').getBoundingClientRect();
      const cs = getComputedStyle(s.querySelector('.w')), px = v => parseFloat(v);
      return {
        l: w.left, t: w.top, w: w.width, h: w.height, iw: window.innerWidth, ih: window.innerHeight,
        sy: window.scrollY, overflow: getComputedStyle(document.documentElement).overflowY, attr: document.querySelector('[data-chartist-widget]').hasAttribute('data-fs'),
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
        supports: CSS.supports('padding-top', 'env(safe-area-inset-top)'),
      };
    });
    check(ctxName, fs1.attr, 'full screen by tap did not enter the fallback (no data-fs on the widget)');
    check(ctxName, Math.abs(fs1.l) <= 1 && Math.abs(fs1.t) <= 1 && Math.abs(fs1.w - fs1.iw) <= 1 && Math.abs(fs1.h - fs1.ih) <= 1,
      `full screen box ${Math.round(fs1.l)},${Math.round(fs1.t)} ${Math.round(fs1.w)}x${Math.round(fs1.h)} does not cover the ${fs1.iw}x${fs1.ih} viewport`);
    check(ctxName, fs1.overflow === 'hidden', `the page scroll is not locked in full screen (overflow-y ${fs1.overflow})`);
    check(ctxName, fs1.sy === pre.sy, `the page scrolled when entering full screen (${pre.sy} -> ${fs1.sy})`);
    // 7. safe-area insets: real, non-negative numbers (0 where the engine has no inset).
    check(ctxName, fs1.supports, 'the engine does not accept env(safe-area-inset-top) in padding');
    check(ctxName, fs1.pad.every(v => Number.isFinite(v) && v >= 0), `full screen safe-area padding is not a size (${fs1.pad.join(', ')})`);
    check(ctxName, [fs1.l, fs1.t, fs1.w, fs1.h].every(Number.isFinite), 'full screen box has a non-finite size');
    const exitAt = await ctl('Exit full screen', '.bar');
    const exitTapped = await tapControl('Exit full screen');
    await settle(400);
    if (await page.evaluate(() => document.querySelector('[data-chartist-widget]').hasAttribute('data-fs'))) {
      console.log(`  diag ${ctxName}: exit tapped=${exitTapped} barControl=${JSON.stringify(exitAt)} ` + await page.evaluate(at => {
        const s = document.querySelector('[data-chartist-widget]').shadowRoot;
        const hit = at && s.elementFromPoint(at.x, at.y), dh = at && document.elementFromPoint(at.x, at.y);
        return JSON.stringify({ hit: hit && (hit.tagName + '.' + hit.className + '|' + (hit.getAttribute('aria-label') || '')), docHit: dh && dh.tagName + '.' + dh.className, layer: !!s.querySelector('.menu, .dlg'), vv: [innerWidth, innerHeight, scrollX, scrollY, visualViewport && visualViewport.scale] });
      }, exitAt));
    }
    const post = await page.evaluate(() => ({ sy: window.scrollY, inline: document.documentElement.style.overflow, computed: getComputedStyle(document.documentElement).overflowY, attr: document.querySelector('[data-chartist-widget]').hasAttribute('data-fs') }));
    check(ctxName, !post.attr, 'tapping Exit full screen did not leave full screen');
    check(ctxName, post.inline === pre.inline && post.computed === pre.computed, `exiting full screen did not restore the page overflow (was "${pre.inline}"/${pre.computed}, now "${post.inline}"/${post.computed})`);
    check(ctxName, Math.abs(post.sy - pre.sy) <= 1, `exiting full screen did not restore the page scroll (${pre.sy} -> ${post.sy})`);
  }
  // Bottom sheets pad by max(10px, env(safe-area-inset-bottom)).
  await page.evaluate(() => window.scrollTo(0, 0));
  if (await openIndicators()) {
    const pad = await page.evaluate(() => { const d = document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.dlg, .menu'); return parseFloat(getComputedStyle(d).paddingBottom); });
    check(ctxName, Number.isFinite(pad) && pad >= 10, `the sheet's bottom padding is not a size of at least 10px (${pad})`);
    await page.keyboard.press('Escape'); await closed();
  }
  await noSideScroll('after full screen');
  check(ctxName, errors.length === 0, `page errors during the run: ${errors.slice(0, 3).join(' | ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
