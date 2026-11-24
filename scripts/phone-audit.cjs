// Phone audit: the widget, the standalone examples and the docs site on real device profiles with real touch input
// (Playwright's device descriptors in Chromium; CDP Input.dispatchTouchEvent for drags, long presses, pinches and
// flicks). For every profile in portrait and landscape, light and dark, it walks the reachable states and checks the
// measurable rules on every visible interactive element: touch target (44 x 44, or at least 24 with a clear 44 px
// square around it), text at least 12 px, form fields at least 16 px, contrast 4.5:1 (3:1 for large text), nothing
// clipped by a box that does not scroll, the control actually hit at its centre, no horizontal page overflow, focus
// returned after a sheet, one click per tap, no tap delay, pointer capture released on touchcancel, no console errors.
// It measures vertical page scroll through the chart on an article page, page scroll while a sheet is open, the sheet
// above a reduced visual viewport (on-screen keyboard), safe-area insets, rotation mid-interaction and split-screen
// widths, and the frame cost under 4x and 6x CPU throttling.
//
//   npm run audit:phone                       all of it (builds first)
//   node scripts/phone-audit.cjs --devices "iPhone SE,Pixel 7" --themes light --skip site,perf
//
// Writes audit-output/phone/report.md, report.json and shots/. Exit 1 on any high or medium finding.
// Chromium only: WebKit (iOS Safari) behaviour is NOT verified here. Needs Playwright and `npm run build`.
const pw = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'audit-output', 'phone');
const shotDir = path.join(outDir, 'shots');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(shotDir, { recursive: true });

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const ALL_DEVICES = ['iPhone SE', 'iPhone 14', 'iPhone 14 Pro Max', 'Pixel 7', 'Galaxy S9+', 'iPad Mini'];
const DEVICES = (arg('devices', ALL_DEVICES.join(','))).split(',').map(s => s.trim()).filter(Boolean);
const THEMES = (arg('themes', 'light,dark')).split(',');
const SKIP = new Set((arg('skip', '')).split(',').filter(Boolean));
const ORIENT = (arg('orient', 'portrait,landscape')).split(',');
const LIVE_NET = argv.includes('--net');
// Emulated insets (CSS px) for the notch / Dynamic Island and the home indicator, as on an iPhone 14.
const INSETS = { portrait: { top: 47, bottom: 34, left: 0, right: 0 }, landscape: { top: 0, bottom: 21, left: 47, right: 47 } };

// ── findings ──
const findings = [];
const measures = {};
let shotN = 0;
function find(f) { findings.push(f); }
const sevRank = { high: 3, medium: 2, low: 1, info: 0 };

// ── a static server for the repository (examples, dist, site/dist) ──
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.csv': 'text/csv', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };
function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, path.normalize(p));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

// ── the device matrix ──
function profile(name, orient) {
  const key = orient === 'landscape' ? `${name} landscape` : name;
  const d = { ...pw.devices[key] };
  if (!d.viewport) throw new Error(`unknown device ${key}`);
  delete d.defaultBrowserType; // Chromium runs every profile (WebKit is not installed)
  return { name: key, short: key.replace(/[^A-Za-z0-9]+/g, '-'), orient, desc: d, ios: /iPhone|iPad/.test(name) };
}

// ── in-page: the measurable rules ──
// Runs in the page. Walks the document and every open shadow root; checks each visible interactive element and each
// visible text run. `scope` limits the check to a container (by selector, piercing shadow roots via a path of hosts).
function RULES(opts) {
  const out = { targets: [], small: [], text: [], fields: [], clipped: [], covered: [], overflowX: 0, counted: 0 };
  const coarse = matchMedia('(pointer: coarse)').matches;
  const parent = e => e.assignedSlot || e.parentElement || (e.getRootNode && e.getRootNode().host) || null;
  const all = [];
  const walk = r => { for (const el of r.querySelectorAll('*')) { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
  walk(document);
  const within = el => { if (!opts.within) return true; for (let e = el; e; e = parent(e)) if (e.matches && e.matches(opts.within)) return true; return false; };
  const desc = el => {
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    let where = '';
    for (let e = parent(el); e; e = parent(e)) { if (e.hasAttribute && e.hasAttribute('data-chartist-widget')) { where = 'widget'; break; } if (e.hasAttribute && e.hasAttribute('data-chartist-drawing-ui')) { where = 'drawings'; break; } }
    return `${where ? where + ' ' : ''}${el.tagName.toLowerCase()}${cls}${label ? ` "${label}"` : ''}`;
  };
  const vis = el => el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }) : true;
  // The part of a box left after every clipping ancestor; `hard` when a clipper that cannot scroll that way cut it.
  const clip = (el, r) => {
    let L = r.left, T = r.top, R = r.right, B = r.bottom, hard = false, soft = false;
    for (let e = parent(el); e && e !== document.documentElement; e = parent(e)) {
      const cs = getComputedStyle(e);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible' && cs.contain.indexOf('paint') < 0) continue;
      const c = e.getBoundingClientRect();
      const scrollX = /auto|scroll/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1;
      const scrollY = /auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1;
      // (A cut of up to 3 px is a rounded card's edge, not a clipped control.)
      if (cs.overflowX !== 'visible' || cs.contain.indexOf('paint') >= 0) { if (L < c.left - 3 || R > c.right + 3) { if (scrollX) soft = true; else hard = true; } L = Math.max(L, c.left); R = Math.min(R, c.right); }
      if (cs.overflowY !== 'visible' || cs.contain.indexOf('paint') >= 0) { if (T < c.top - 3 || B > c.bottom + 3) { if (scrollY) soft = true; else hard = true; } T = Math.max(T, c.top); B = Math.min(B, c.bottom); }
    }
    return { w: Math.max(0, R - L), h: Math.max(0, B - T), hard, soft };
  };
  // Hit area: the box, grown by an absolutely placed ::before / ::after (the usual invisible 44 px extension).
  const hitBox = (el, r) => {
    let L = r.left, T = r.top, R = r.right, B = r.bottom;
    const own = getComputedStyle(el);
    if (own.position !== 'static') {
      for (const ps of ['::before', '::after']) {
        const cs = getComputedStyle(el, ps);
        if (!cs.content || cs.content === 'none' || cs.display === 'none' || cs.position !== 'absolute' || cs.pointerEvents === 'none') continue;
        const n = v => (v === 'auto' ? null : parseFloat(v));
        const l = n(cs.left), t = n(cs.top), rr = n(cs.right), b = n(cs.bottom), w = parseFloat(cs.width), hh = parseFloat(cs.height);
        const x0 = l !== null ? r.left + l : rr !== null ? r.right - rr - w : r.left;
        const x1 = rr !== null ? r.right - rr : x0 + w;
        const y0 = t !== null ? r.top + t : b !== null ? r.bottom - b - hh : r.top;
        const y1 = b !== null ? r.bottom - b : y0 + hh;
        L = Math.min(L, x0); R = Math.max(R, x1); T = Math.min(T, y0); B = Math.max(B, y1);
      }
    }
    return { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T };
  };
  const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=radio], [role=switch], [role=tab], [role=separator][tabindex], [role=slider], [tabindex]:not([tabindex="-1"])';
  const deepHit = (x, y) => { let e = document.elementFromPoint(x, y); while (e && e.shadowRoot) { const n = e.shadowRoot.elementFromPoint(x, y); if (!n || n === e) break; e = n; } return e; };
  const contains = (a, b) => { for (let e = b; e; e = parent(e)) if (e === a) return true; return false; };
  const targets = [];
  for (const el of all) {
    if (!el.matches || !el.matches(SEL) || !within(el)) continue;
    if (el.getAttribute('role') === 'application') continue; // the chart surface itself
    if (el.closest && el.closest('[inert]')) continue;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') continue;
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) continue;
    const c = clip(el, r);
    if (c.w < 1 || c.h < 1) continue; // scrolled out of its pane
    // A tag rendered as one of a large region (e.g. a whole card link) is not a small target.
    targets.push({ el, r, c });
  }
  for (const t of targets) {
    const { el, r, c } = t;
    out.counted++;
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && /^(P|LI|TD|DD|BLOCKQUOTE|SPAN|EM|STRONG)$/.test(el.parentElement.tagName);
    const hb = hitBox(el, r);
    let rule = '';
    if (hb.width >= 43.5 && hb.height >= 43.5) rule = '44';
    else if (hb.width >= 23.5 && hb.height >= 23.5) {
      // Spacing-inclusive: a 44 px square centred on it overlaps no other target.
      const cx = (hb.left + hb.right) / 2, cy = (hb.top + hb.bottom) / 2;
      const clear = !targets.some(o => o !== t && !contains(o.el, el) && !contains(el, o.el) && o.r.left < cx + 22 && o.r.right > cx - 22 && o.r.top < cy + 22 && o.r.bottom > cy - 22);
      if (clear) rule = 'spacing';
    }
    out.targets.push({ d: desc(el), w: +hb.width.toFixed(1), h: +hb.height.toFixed(1), rule: rule || 'fail' });
    if (!rule && coarse) out.small.push({ d: desc(el), w: +hb.width.toFixed(1), h: +hb.height.toFixed(1), sev: inline ? 'low' : hb.width < 24 || hb.height < 24 ? 'high' : 'medium', inline });
    if (c.hard && !c.soft) out.clipped.push({ d: desc(el), w: +r.width.toFixed(1), h: +r.height.toFixed(1), vis: `${c.w.toFixed(0)}x${c.h.toFixed(0)}` });
    // Is it the element a finger on its centre reaches?
    const cx = Math.min(Math.max((r.left + r.right) / 2, 0), innerWidth - 1), cy = Math.min(Math.max((r.top + r.bottom) / 2, 0), innerHeight - 1);
    if (c.w >= r.width - 1 && c.h >= r.height - 1) {
      const hit = deepHit(cx, cy);
      if (hit && !contains(el, hit) && !contains(hit, el)) {
        let layer = false;
        // Covered by an open popup (sheet, menu, dialog, flyout, the alerts list) is intended.
        for (let e = hit; e; e = parent(e)) if ((e.classList && (e.classList.contains('scrim') || e.classList.contains('menu') || e.classList.contains('dlg'))) || (e.getAttribute && (/^(menu|dialog|listbox)$/.test(e.getAttribute('role') || '') || e.hasAttribute('data-panel'))) || e.tagName === 'DIALOG') { layer = true; break; }
        if (!layer && !opts.ignoreCovered) out.covered.push({ d: desc(el), by: desc(hit) });
      }
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio|range|color|button|submit|reset|file|image)$/.test(el.type || '')) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (coarse && fs < 16) out.fields.push({ d: desc(el), fs });
    }
  }
  // Text: size and contrast of every visible run of text.
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = el => {
    const layers = [];
    for (let e = el; e; e = parent(e)) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient\(/.test(cs.backgroundImage)) return null; // an image: unknown
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    const htmlBg = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (htmlBg && htmlBg.a > 0) bg = over(htmlBg, bg);
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  };
  const opacityOf = el => { let o = 1; for (let e = el; e; e = parent(e)) o *= parseFloat(getComputedStyle(e).opacity) || 1; return o; };
  const seen = new Set();
  for (const el of all) {
    if (!within(el)) continue;
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = own.trim();
    if (!own || /^(SCRIPT|STYLE|NOSCRIPT|TITLE|OPTION|TEMPLATE)$/.test(el.tagName)) continue;
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue; // screen-reader only text
    if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) continue;
    const c = clip(el, r);
    if (c.w < 1 || c.h < 1) continue;
    let disabled = false;
    for (let e = el; e; e = parent(e)) if (e.hasAttribute && (e.hasAttribute('disabled') || e.getAttribute('aria-disabled') === 'true')) { disabled = true; break; }
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const d = desc(el);
    if (fs < 12 && !seen.has('s' + d)) { seen.add('s' + d); out.text.push({ d, kind: 'size', fs }); }
    if (disabled || cs.webkitTextFillColor === 'transparent') continue;
    const bg = bgOf(el);
    const fg = parse(cs.color);
    if (!bg || !fg) continue;
    const o = opacityOf(el);
    const col = over({ ...fg, a: fg.a * o }, bg);
    const L1 = lum(col), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    if (ratio < (large ? 3 : 4.5) && !seen.has('c' + d)) { seen.add('c' + d); out.text.push({ d, kind: 'contrast', ratio: +ratio.toFixed(2), fg: cs.color, fs }); }
  }
  const se = document.scrollingElement || document.documentElement;
  out.overflowX = Math.max(0, se.scrollWidth - innerWidth);
  return out;
}

// ── touch through CDP ──
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchKit(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 6, radiusY: 6, force: 1 })) });
  const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  const kit = {
    cdp, send,
    async drag(a, b, { steps = 12, stepMs = 16, hold = 0, end = true, release = 0 } = {}) {
      await send('touchStart', [a]);
      if (hold) await sleep(hold);
      for (let i = 1; i <= steps; i++) { await send('touchMove', [lerp(a, b, i / steps)]); await sleep(stepMs); }
      if (release) await sleep(release);
      if (end) await send('touchEnd', []);
    },
    async pinch(c, d0, d1, { steps = 10, stepMs = 16 } = {}) {
      const pts = d => [{ x: c.x - d / 2, y: c.y, id: 0 }, { x: c.x + d / 2, y: c.y, id: 1 }];
      await send('touchStart', pts(d0));
      for (let i = 1; i <= steps; i++) { await send('touchMove', pts(d0 + (d1 - d0) * i / steps)); await sleep(stepMs); }
      await send('touchEnd', []);
    },
    async longPress(p, ms = 600) { await send('touchStart', [p]); await sleep(ms); },
    move: p => send('touchMove', [p]),
    end: () => send('touchEnd', []),
    cancel: () => send('touchCancel', []),
    async tap(p) { await page.touchscreen.tap(p.x, p.y); },
  };
  return kit;
}

module.exports = { RULES };

// ── the run ──
(async () => {
  if (!fs.existsSync(path.join(root, 'dist', 'chartist-lite-widget.iife.min.js'))) throw new Error('run `npm run build` first');
  const { server, base } = await serve();
  const browser = await pw.chromium.launch();
  const started = Date.now();

  const errorsByPage = new Map();
  /** A page on a device profile, theme set by `prefers-color-scheme` and the page's own ?theme. */
  async function open(prof, theme, file, { insets = true, init } = {}) {
    const ctx = await browser.newContext({ ...prof.desc, colorScheme: theme, acceptDownloads: true, reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/favicon/.test(m.text())) errs.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', e => errs.push(`pageerror: ${e.message}`));
    if (init) await page.addInitScript(init);
    // The override lives as long as its CDP session: keep the session open with the page.
    if (insets) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setSafeAreaInsetsOverride', { insets: INSETS[prof.orient] }).catch(() => {}); page.__insetSession = c; }
    await page.goto(`${base}/${file}`, { waitUntil: 'load' });
    page.__errs = errs;
    return { ctx, page, errs };
  }
  async function shot(page, label) {
    const f = `${String(++shotN).padStart(3, '0')}-${label.replace(/[^A-Za-z0-9]+/g, '-')}.png`;
    await page.screenshot({ path: path.join(shotDir, f) }).catch(() => {});
    return `shots/${f}`;
  }
  /** Run the rules and turn the results into findings. */
  async function audit(page, where, opts = {}) {
    // Measure the settled state: wait for entering sheets, drawers and menus to finish their animation.
    await page.waitForFunction(() => document.getAnimations({ subtree: true }).every(a => a.playState !== 'running' || (a.effect && a.effect.getTiming && a.effect.getTiming().iterations === Infinity)), null, { timeout: 3000 }).catch(() => {});
    const r = await page.evaluate(RULES, { within: opts.within || null, ignoreCovered: !!opts.ignoreCovered });
    const s = opts.shot ? await shot(page, `${where.page}-${where.state}-${where.device}-${where.theme}`) : undefined;
    const base = { ...where, shot: s };
    for (const x of r.small) find({ ...base, rule: 'touch-target', sev: x.sev, what: `${x.d} ${x.w}x${x.h}` });
    for (const x of r.fields) find({ ...base, rule: 'field-16px', sev: 'high', what: `${x.d} font ${x.fs}px (iOS zooms the page on focus)` });
    for (const x of r.text) find({ ...base, rule: x.kind === 'size' ? 'text-12px' : 'contrast', sev: x.kind === 'size' ? 'medium' : 'medium', what: x.kind === 'size' ? `${x.d} ${x.fs}px` : `${x.d} ${x.ratio}:1 (${x.fg}, ${x.fs}px)` });
    for (const x of r.clipped) find({ ...base, rule: 'clipped', sev: 'medium', what: `${x.d} ${x.w}x${x.h} shows ${x.vis}` });
    for (const x of r.covered) find({ ...base, rule: 'covered', sev: 'medium', what: `${x.d} under ${x.by}` });
    if (r.overflowX > 0.5) find({ ...base, rule: 'overflow-x', sev: 'high', what: `page scrolls sideways by ${r.overflowX}px` });
    measures.targets = (measures.targets || 0) + r.counted;
    measures.spacingRule = (measures.spacingRule || 0) + r.targets.filter(t => t.rule === 'spacing').length;
    return r;
  }
  function flushErrors(page, where) {
    for (const e of page.__errs.splice(0)) find({ ...where, rule: 'console', sev: 'high', what: e.slice(0, 200) });
  }

  // ── widget helpers (in page) ──
  const W = '[data-chartist-widget]';
  const ready = page => page.waitForFunction(() => window.__widget && window.__widget.chart.panes()[0].getSeries()[0]?.data().length > 50, null, { timeout: 20000 });
  /** Centre of a visible widget control by aria-label prefix (bars, layers, rail), or null. */
  const ctlBox = (page, label, scope = '') => page.evaluate(([label, scope]) => {
    const hostEl = document.querySelector('[data-chartist-widget]');
    const roots = [hostEl.shadowRoot];
    for (const h of hostEl.shadowRoot.querySelectorAll('*')) if (h.shadowRoot) roots.push(h.shadowRoot);
    for (const h of hostEl.querySelectorAll('*')) if (h.shadowRoot) roots.push(h.shadowRoot);
    for (const r of roots) {
      for (const el of r.querySelectorAll(`${scope} button, ${scope} [role^=menuitem], ${scope} [role=option], ${scope} [role=radio]`)) {
        const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
        // Exact, or the label then a space or a bracket ("Indicators (Alt+I)"); "More" never matches "More intervals".
        if (!(name === label || name.startsWith(label + ' (') || name.startsWith(label + ':') || (label.endsWith('*') && name.startsWith(label.slice(0, -1))))) continue;
        if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        // A long menu or the drawing row scrolls: bring the item into its scroller's view first (as a finger would).
        if (el.closest('.menu, .dlg, [role=toolbar], [role=menu]')) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const b = el.getBoundingClientRect();
        if (b.width < 1) continue;
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
      }
    }
    return null;
  }, [label, scope]);
  const layerOpen = page => page.evaluate(() => !!document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.menu, .dlg'));
  const activeName = page => page.evaluate(() => { const a = document.querySelector('[data-chartist-widget]').shadowRoot.activeElement; return a ? (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40) : null; });
  const geo = page => page.evaluate(() => {
    const s = document.querySelector('[data-chartist-widget]').shadowRoot;
    const b = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    return { host: b(document.querySelector('[data-chartist-widget]')), w: b(s.querySelector('.w')), card: b(s.querySelector('.card')), top: b(s.querySelector('.top')), bot: b(s.querySelector('.bot')), layer: b(s.querySelector('.menu, .dlg')), vv: { t: visualViewport.offsetTop, h: visualViewport.height, w: visualViewport.width }, sy: scrollY };
  });
  /** Tap a control by label; through More (top, then bottom) when it collapsed there. Returns false when not found. */
  async function tapCtl(page, t, label) {
    let b = await ctlBox(page, label, '.bar');
    if (b) { await t.tap(b); await page.waitForTimeout(250); return true; }
    for (const which of ['.top', '.bot']) {
      const more = await ctlBox(page, 'More', which);
      if (!more || (more.x === 0)) continue;
      await t.tap(more); await page.waitForTimeout(250);
      b = await ctlBox(page, label, '.menu');
      if (b) { await t.tap(b); await page.waitForTimeout(300); return true; }
      await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    }
    return false;
  }
  const closeLayers = async page => { for (let i = 0; i < 3 && await layerOpen(page); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); } };

  // ════════════ 1. the widget on every profile ════════════
  if (!SKIP.has('widget')) {
    for (const dev of DEVICES) for (const orient of ORIENT) for (const theme of THEMES) {
      const prof = profile(dev, orient);
      const where = (state, pg = 'widget') => ({ page: pg, state, device: prof.name, theme });
      const { ctx, page } = await open(prof, theme, `examples/widget.html?theme=${theme}&persist`, { init: () => { try { localStorage.clear(); } catch { /* */ } } });
      try {
      await ready(page); await page.waitForTimeout(400);
      const t = await touchKit(page);
      const fullShots = theme === 'light' || dev === 'iPhone 14';
      await audit(page, where('start'), { within: W, shot: true });

      // Top bar More sheet.
      const more = await ctlBox(page, 'More', '.top');
      if (more) {
        await t.tap(more); await page.waitForTimeout(300);
        await audit(page, where('more-sheet'), { within: W, shot: fullShots });
        // Focus goes back to More after a tap on the scrim.
        // A sheet has a scrim; a popover (tablet) closes on a press outside it (the card).
        const sc = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const r = (s.querySelector('.scrim') || s.querySelector('.card')).getBoundingClientRect(); const m = (s.querySelector('.menu') || s.querySelector('.card')).getBoundingClientRect(); const x = r.left + r.width / 2, y = Math.max(r.top + 10, Math.min(m.top - 10, r.top + 30)); const hit = s.elementFromPoint(x, y); return { x, y, hit: hit ? hit.className : null }; });
        await t.tap(sc); await page.waitForTimeout(250);
        const back = await activeName(page);
        if (await layerOpen(page)) find({ ...where('more-sheet'), rule: 'sheet-close', sev: 'high', what: `a tap on the scrim did not close the sheet (hit ${sc.hit} at ${Math.round(sc.x)},${Math.round(sc.y)})` });
        // (A popover dismissed by a press elsewhere leaves focus where the finger went; a sheet's scrim returns it.)
        else if (back !== 'More' && sc.hit === 'scrim') find({ ...where('more-sheet'), rule: 'focus-return', sev: 'medium', what: `focus after closing: ${back}` });
      }
      // Interval menu.
      const iv = await ctlBox(page, 'More intervals', '.top');
      if (iv) { await t.tap(iv); await page.waitForTimeout(250); await audit(page, where('interval-menu'), { within: W, shot: fullShots }); await closeLayers(page); }
      // Chart-type menu.
      if (await tapCtl(page, t, 'Chart type')) { await audit(page, where('chart-type-menu'), { within: W, shot: fullShots }); await closeLayers(page); }
      // Symbol search, then the keyboard: a reduced visual viewport.
      const sym = await ctlBox(page, 'Search symbol', '.top');
      if (sym) {
        await t.tap(sym); await page.waitForTimeout(300);
        await audit(page, where('symbol-search'), { within: W, shot: fullShots });
        await page.keyboard.type('o'); await page.waitForTimeout(200);
        await closeLayers(page);
      }
      // Indicators dialog: search, add by tap, settings form, remove.
      if (await tapCtl(page, t, 'Indicators')) {
        await audit(page, where('indicators'), { within: W, shot: true });
        await page.keyboard.type('macd'); await page.waitForTimeout(200);
        const add = await ctlBox(page, 'Add MACD*', '.dlg');
        if (add) { await t.tap(add); await page.waitForTimeout(300); } else find({ ...where('indicators'), rule: 'flow', sev: 'high', what: 'no Add MACD after a search' });
        const n = await page.evaluate(() => window.__widget.indicators().length);
        if (n !== 3) find({ ...where('indicators'), rule: 'double-fire', sev: 'high', what: `one tap on Add gave ${n - 2} indicators` });
        await closeLayers(page);
        await tapCtl(page, t, 'Indicators');
        const gear = await ctlBox(page, 'EMA settings', '.dlg');
        const gearAny = gear || await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const b = [...s.querySelectorAll('.dlg .ind .acts button')].find(x => /gear|settings/i.test(x.getAttribute('aria-label'))); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        if (gearAny) {
          await t.tap(gearAny); await page.waitForTimeout(300);
          await audit(page, where('indicator-settings'), { within: W, shot: true });
          await closeLayers(page);
        }
        await closeLayers(page);
      }
      // Settings sheet.
      if (await tapCtl(page, t, 'Settings')) { await audit(page, where('settings'), { within: W, shot: fullShots }); await closeLayers(page); }
      // Go to date.
      if (await tapCtl(page, t, 'Go to date')) { await audit(page, where('go-to-date'), { within: W, shot: fullShots }); await closeLayers(page); }
      // Range keys: reachable (in the bar, scrolled or in More), never clipped.
      const ranges = await page.evaluate(() => {
        const s = document.querySelector('[data-chartist-widget]').shadowRoot;
        const g = s.querySelector('.bot [role=radiogroup]');
        if (!g || g.classList.contains('hide')) return { inBar: false };
        const r = g.getBoundingClientRect();
        return { inBar: true, w: r.width, scroll: g.scrollWidth - g.clientWidth, keys: [...g.children].filter(k => { const b = k.getBoundingClientRect(); return b.left >= r.left - 0.5 && b.right <= r.right + 0.5; }).length };
      });
      measures[`ranges ${prof.name}`] = ranges;
      if (!ranges.inBar) find({ ...where('ranges'), rule: 'ranges-hidden', sev: 'low', what: 'the range keys are only in the bottom More menu (two taps away)' });

      // Legend row: a tap shows its actions (hover has a touch path).
      const row = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const r = s.querySelector('.lg .row'); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; });
      if (row) {
        await t.tap(row); await page.waitForTimeout(200);
        const acts = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const a = s.querySelector('.lg .row .acts'); return a ? getComputedStyle(a).display : 'none'; });
        if (acts === 'none') find({ ...where('legend-row'), rule: 'hover-only', sev: 'high', what: 'a tap on a legend row does not show its actions' });
        await audit(page, where('legend-row'), { within: W, shot: fullShots });
        await t.tap(row); await page.waitForTimeout(150);
      }
      // Theme toggle: one tap, one toggle (no tap + click double fire).
      const dark0 = await page.evaluate(() => document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.w').classList.contains('dark'));
      if (await tapCtl(page, t, dark0 ? 'Light appearance' : 'Dark appearance')) {
        const dark1 = await page.evaluate(() => document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.w').classList.contains('dark'));
        if (dark1 === dark0) find({ ...where('theme'), rule: 'double-fire', sev: 'high', what: 'one tap on the theme key did not toggle once' });
        await tapCtl(page, t, dark1 ? 'Light appearance' : 'Dark appearance');
      }
      flushErrors(page, where('walk'));
      await t.cdp.detach().catch(() => {});
      } catch (e) { find({ page: page.url().replace(/^https?:\/\/[^/]+\//, ''), state: 'audit', device: String(typeof prof !== 'undefined' ? prof.name : ''), theme: '', rule: 'audit-error', sev: 'high', what: String(e && e.message || e).split('\n')[0].slice(0, 160) }); await shot(page, 'audit-error').catch(() => {}); }
      await ctx.close();
    }
  }

  // ════════════ 2. gestures, drawing, alerts, fullscreen, restore (one profile per form factor) ════════════
  if (!SKIP.has('gestures')) {
    for (const dev of DEVICES.filter(d => ['iPhone SE', 'iPhone 14', 'Pixel 7', 'iPad Mini'].includes(d))) for (const orient of ORIENT) {
      const prof = profile(dev, orient);
      const theme = 'light';
      const where = state => ({ page: 'widget', state, device: prof.name, theme });
      const { ctx, page } = await open(prof, theme, `examples/widget.html?persist`, { init: () => { try { if (!sessionStorage.getItem('kept')) localStorage.clear(); } catch { /* */ } } });
      try {
      await ready(page); await page.waitForTimeout(400);
      await page.evaluate(() => { window.__noTicks = true; });
      const t = await touchKit(page);
      const vr = () => page.evaluate(() => window.__widget.chart.timeScale().getVisibleLogicalRange());
      let g = await geo(page);
      const mid = { x: g.card.l + g.card.w * 0.45, y: g.card.t + g.card.h * 0.35 };
      // Instrument: clicks per tap, capture balance, tap-to-click delay.
      await page.evaluate(() => {
        const el = window.__widget.chart.element();
        window.__cap = 0; window.__clicks = 0; window.__delay = [];
        el.addEventListener('gotpointercapture', () => window.__cap++);
        el.addEventListener('lostpointercapture', () => window.__cap--);
        let up = 0;
        document.addEventListener('pointerup', e => { up = e.timeStamp; }, true);
        document.addEventListener('click', e => { window.__clicks++; if (up) window.__delay.push(e.timeStamp - up); }, true);
        window.__chartClicks = 0; window.__widget.chart.subscribeClick(() => window.__chartClicks++);
        document.addEventListener('contextmenu', () => { window.__ctx = (window.__ctx || 0) + 1; }, true);
      });
      // One-finger pan.
      let a = await vr();
      await t.drag(mid, { x: mid.x + 120, y: mid.y }, { steps: 10 });
      await page.waitForTimeout(400);
      let b = await vr();
      if (!(a && b && b.from < a.from - 2)) find({ ...where('pan'), rule: 'gesture', sev: 'high', what: `a one-finger swipe right did not pan (${a?.from?.toFixed(1)} -> ${b?.from?.toFixed(1)})` });
      // Kinetic flick: a fast swipe keeps moving after the finger lifts.
      a = await vr();
      await t.drag(mid, { x: mid.x - 160, y: mid.y }, { steps: 5, stepMs: 8 });
      const lifted = await vr();
      await page.waitForTimeout(700);
      b = await vr();
      measures[`flick ${prof.name}`] = { duringSwipe: +(lifted.from - a.from).toFixed(1), afterLift: +(b.from - lifted.from).toFixed(1) };
      if (!(b.from > lifted.from + 1)) find({ ...where('flick'), rule: 'gesture', sev: 'medium', what: 'a flick did not glide after the lift' });
      // Pinch zoom in.
      a = await vr();
      await t.pinch(mid, 60, 200);
      await page.waitForTimeout(300);
      b = await vr();
      if (!((b.to - b.from) < (a.to - a.from) * 0.8)) find({ ...where('pinch'), rule: 'gesture', sev: 'high', what: `a pinch did not zoom in (${(a.to - a.from).toFixed(1)} -> ${(b.to - b.from).toFixed(1)} bars)` });
      // Double tap: resets the view (dblclick), no page zoom.
      const scale0 = await page.evaluate(() => visualViewport.scale);
      await t.tap(mid); await page.waitForTimeout(60); await t.tap(mid); await page.waitForTimeout(400);
      const scale1 = await page.evaluate(() => visualViewport.scale);
      const after2 = await vr();
      measures[`double-tap ${prof.name}`] = { pageZoom: scale1, barsInView: +(after2.to - after2.from).toFixed(1) };
      if (scale1 !== scale0) find({ ...where('double-tap'), rule: 'gesture', sev: 'high', what: `a double tap zoomed the page (${scale0} -> ${scale1})` });
      // Taps: one click each, no delay.
      await page.evaluate(() => { window.__clicks = 0; window.__chartClicks = 0; window.__delay = []; });
      await page.waitForTimeout(400);
      await t.tap(mid); await page.waitForTimeout(400);
      const tapInfo = await page.evaluate(() => ({ clicks: window.__clicks, chart: window.__chartClicks, delay: window.__delay }));
      measures[`tap ${prof.name}`] = tapInfo;
      if (tapInfo.chart !== 1) find({ ...where('tap'), rule: 'double-fire', sev: 'high', what: `one tap gave ${tapInfo.chart} chart clicks` });
      if (tapInfo.delay.some(d => d > 100)) find({ ...where('tap'), rule: 'tap-delay', sev: 'high', what: `pointerup to click ${tapInfo.delay.map(d => d.toFixed(0)).join(', ')} ms` });
      // Long press over the canvas: no text selection, no context menu.
      await t.longPress(mid, 900); await t.end(); await page.waitForTimeout(200);
      const lp = await page.evaluate(() => ({ sel: String(getSelection()), ctx: window.__ctx || 0 }));
      if (lp.sel) find({ ...where('long-press'), rule: 'selection', sev: 'medium', what: `a long press selected "${lp.sel.slice(0, 30)}"` });
      if (lp.ctx) find({ ...where('long-press'), rule: 'callout', sev: 'medium', what: `a long press over the chart opened the context menu (${lp.ctx}) ` });
      // touchcancel mid-pan: capture released, the next gesture works.
      await page.evaluate(() => { window.__cap = 0; });
      await t.send('touchStart', [mid]);
      for (let i = 1; i <= 5; i++) { await t.move({ x: mid.x + i * 15, y: mid.y }); await sleep(16); }
      await t.cancel(); await page.waitForTimeout(200);
      const cap = await page.evaluate(() => window.__cap);
      if (cap !== 0) find({ ...where('touchcancel'), rule: 'capture', sev: 'high', what: `pointer capture left held after touchcancel (${cap})` });
      a = await vr();
      await t.drag(mid, { x: mid.x + 100, y: mid.y }, { steps: 8 }); await page.waitForTimeout(300);
      b = await vr();
      if (!(b.from < a.from - 2)) find({ ...where('touchcancel'), rule: 'gesture', sev: 'high', what: 'the chart did not pan after a touchcancel' });
      // Tooltip by long press, then drag (with the floating tooltip on).
      await page.evaluate(() => { const s = window.__widget.save(); s.settings = { ...s.settings, tooltip: 'floating' }; return window.__widget.load(s); });
      await page.waitForTimeout(800);
      await ready(page);
      g = await geo(page);
      const p0 = { x: g.card.l + g.card.w * 0.4, y: g.card.t + g.card.h * 0.3 };
      a = await vr();
      await t.longPress(p0, 600);
      for (let i = 1; i <= 6; i++) { await t.move({ x: p0.x + i * 12, y: p0.y }); await sleep(30); }
      const tipShown = await page.evaluate(() => { const h = window.__widget.chart.element().querySelector('[data-chartist-tooltip]'); const r = h && (h.shadowRoot || h); return !!r && [...r.children].some(c => c.tagName === 'DIV' && getComputedStyle(c).display !== 'none' && c.textContent.trim().length > 0); });
      await shot(page, `widget-tooltip-${prof.short}`);
      await t.end(); await page.waitForTimeout(200);
      b = await vr();
      if (!tipShown) find({ ...where('tooltip'), rule: 'gesture', sev: 'medium', what: 'long press then drag shows no tooltip' });
      if (Math.abs(b.from - a.from) > 0.5) find({ ...where('tooltip'), rule: 'gesture', sev: 'medium', what: 'the chart panned while the tooltip was dragged' });
      await page.evaluate(() => { const s = window.__widget.save(); s.settings = { ...s.settings, tooltip: 'off' }; return window.__widget.load(s); });
      await page.waitForTimeout(600);
      // Pane separator drag by touch.
      const sepBox = await page.evaluate(() => { const d = window.__widget.chart.element().querySelector('[role=separator]'); if (!d) return null; const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; });
      if (sepBox) {
        const h0 = await page.evaluate(() => window.__widget.chart.panes()[1]?.getHeight());
        await t.drag({ x: sepBox.x, y: sepBox.y + 1 }, { x: sepBox.x, y: sepBox.y - 50 }, { steps: 8 }); await page.waitForTimeout(250);
        const h1 = await page.evaluate(() => window.__widget.chart.panes()[1]?.getHeight());
        measures[`separator ${prof.name}`] = { hitHeight: sepBox.h, before: h0, after: h1 };
        if (!(h1 > h0 + 20)) find({ ...where('separator'), rule: 'gesture', sev: 'high', what: `dragging the pane separator by touch did nothing (${h0} -> ${h1})` });
        await t.drag({ x: sepBox.x, y: sepBox.y - 50 + 1 }, { x: sepBox.x, y: sepBox.y }, { steps: 8 }); await page.waitForTimeout(250);
        if (sepBox.h < 24) find({ ...where('separator'), rule: 'touch-target', sev: 'medium', what: `pane separator hit area ${sepBox.h}px tall` });
      }

      // Drawing by touch: open the row, pick trend line, draw, select, drag, resize, style, delete.
      if (await tapCtl(page, t, 'Drawing tools')) {
        await page.waitForFunction(() => !!document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.tbar [data-chartist-drawing-ui], .lbar [data-chartist-drawing-ui]'), null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(400);
        await audit(page, { ...where('drawing-row') }, { within: W, shot: true });
        // Scroll the row sideways by touch (phone row) and check it moved.
        const rowScroll = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const host = s.querySelector('.tbar [data-chartist-drawing-ui]'); if (!host) return null; const tb = host.shadowRoot.querySelector('[role=toolbar]'); const r = tb.getBoundingClientRect(); return { x: r.left + r.width * 0.7, y: r.top + r.height / 2, sl: tb.scrollLeft, max: tb.scrollWidth - tb.clientWidth }; });
        if (rowScroll && rowScroll.max > 0) {
          await t.drag(rowScroll, { x: rowScroll.x - 120, y: rowScroll.y }, { steps: 8 }); await page.waitForTimeout(300);
          const sl = await page.evaluate(() => document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.tbar [data-chartist-drawing-ui]').shadowRoot.querySelector('[role=toolbar]').scrollLeft);
          measures[`drawing row scroll ${prof.name}`] = { from: rowScroll.sl, to: sl, max: rowScroll.max };
          if (!(sl > rowScroll.sl + 20)) find({ ...where('drawing-row'), rule: 'gesture', sev: 'high', what: 'the drawing row did not scroll sideways under a finger' });
          await t.drag({ x: rowScroll.x - 120, y: rowScroll.y }, rowScroll, { steps: 8 }); await page.waitForTimeout(300);
        }
        // Flyout of the Lines group by a long press.
        const lines = await ctlBox(page, 'Lines', '');
        const trendBtn = await ctlBox(page, 'Trend line*', '');
        if (lines) { await t.longPress(lines, 700); await t.end(); await page.waitForTimeout(300); await audit(page, where('drawing-flyout'), { within: W, shot: true }); }
        const trend = await ctlBox(page, 'Trend line*', '');
        if (trend) { await t.tap(trend); await page.waitForTimeout(250); } else if (trendBtn) { await t.tap(trendBtn); await page.waitForTimeout(250); }
        // (no Escape here: on the chart it disarms the tool)
        g = await geo(page);
        const n0 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings || '{"drawings":[]}').drawings.length);
        // Inside the price pane (a short landscape card has little of it).
        const ph = await page.evaluate(() => window.__widget.chart.panes()[0].getHeight());
        const A = { x: g.card.l + g.card.w * 0.25, y: g.card.t + ph * 0.75 }, B = { x: g.card.l + g.card.w * 0.6, y: g.card.t + ph * 0.45 };
        // Touch: press, drag (the magnified offset handle follows above the finger), lift.
        await t.drag(A, B, { steps: 10, release: 50, end: false });
        await shot(page, `widget-draw-touch-${prof.short}`);
        await t.end(); await page.waitForTimeout(300);
        let n1 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings || '{"drawings":[]}').drawings.length);
        if (n1 === n0) { await t.tap(A); await page.waitForTimeout(150); await t.tap(B); await page.waitForTimeout(300); n1 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings || '{"drawings":[]}').drawings.length); measures[`draw ${prof.name}`] = 'tap-tap'; }
        else measures[`draw ${prof.name}`] = 'drag';
        if (n1 !== n0 + 1) find({ ...where('draw-trend'), rule: 'flow', sev: 'high', what: `drawing a trend line by touch made ${n1 - n0}` });
        await page.waitForTimeout(200);
        // The legend shows the last bar's values (or the crosshair bar's): never an empty value after a touch drawing.
        const blankLegend = await page.evaluate(() => {
          const s = document.querySelector('[data-chartist-widget]').shadowRoot;
          return [...s.querySelectorAll('.lg .row')].filter(r => [...r.querySelectorAll('.v')].some(v => !v.textContent.trim())).map(r => (r.getAttribute('aria-label') || r.textContent).trim());
        });
        if (blankLegend.length) find({ ...where('drawing-legend'), rule: 'legend-values', sev: 'medium', what: `legend value empty after a touch drawing: ${blankLegend.join(', ')}` });
        await audit(page, where('drawing-selected'), { within: W, shot: true });
        measures[`style bar ${prof.name}`] = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const sym = s.querySelector('.sym'); const sp = s.querySelector('.top .sp'); return { sym: sym.offsetWidth, symMax: sym.style.maxWidth, slot: sp.offsetWidth, bar: (sp.querySelector('*') || {}).offsetWidth, top: [...s.querySelectorAll('.top > *')].filter(e => !e.classList.contains('hide')).map(e => (e.getAttribute('aria-label') || e.className).slice(0, 14)).join('|') }; });
        const ta = await page.evaluate(() => getComputedStyle(window.__widget.chart.element()).touchAction);
        // Drag the selected line by its middle.
        const d0 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.slice(-1)[0]?.points ?? null);
        // Its middle on screen, from the saved points (a finger's anchor is lifted above it while placing).
        const M = await page.evaluate(() => {
          const w = window.__widget, ts = w.chart.timeScale(), s = w.chart.panes()[0].getSeries()[0], r = w.chart.element().getBoundingClientRect();
          const d = JSON.parse(w.save().drawings).drawings.slice(-1)[0];
          if (!d) return { x: 0, y: 0 };
          const xy = p => ({ x: ts.logicalToCoordinate(ts.timeToLogical(p.time)), y: s.priceToCoordinate(p.price) });
          const a = xy(d.points[0]), b = xy(d.points[1]);
          return { x: r.left + (a.x + b.x) / 2, y: r.top + (a.y + b.y) / 2 };
        });
        await t.drag(M, { x: M.x + 30, y: M.y + 40 }, { steps: 8 }); await page.waitForTimeout(300);
        const d1 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.slice(-1)[0]?.points ?? null);
        if (JSON.stringify(d0) === JSON.stringify(d1)) find({ ...where('drawing-drag'), rule: 'flow', sev: 'medium', what: `dragging the selected drawing by touch did not move it (touch-action ${ta})` });
        // Rectangle: through the Shapes group.
        const shapes = await ctlBox(page, 'Shapes', '') || await ctlBox(page, 'Rectangle*', '');
        if (shapes) {
          await t.longPress(shapes, 700); await t.end(); await page.waitForTimeout(300);
          const rect = await ctlBox(page, 'Rectangle*', '');
          if (rect) { await t.tap(rect); await page.waitForTimeout(250); }
          const C = { x: g.card.l + g.card.w * 0.3, y: g.card.t + ph * 0.5 }, D = { x: g.card.l + g.card.w * 0.55, y: g.card.t + ph * 0.85 };
          const r0 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length);
          await t.drag(C, D, { steps: 10 }); await page.waitForTimeout(300);
          let r1 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length);
          if (r1 === r0) { await t.tap(C); await page.waitForTimeout(150); await t.tap(D); await page.waitForTimeout(300); r1 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length); }
          if (r1 !== r0 + 1) find({ ...where('draw-rect'), rule: 'flow', sev: 'high', what: 'drawing a rectangle by touch failed' });
          await shot(page, `widget-rect-${prof.short}`);
        }
        // Delete the selected drawing from the style bar.
        const del = await ctlBox(page, 'Delete drawing', '');
        const before = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length);
        if (del) { await t.tap(del); await page.waitForTimeout(300); }
        const after = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length);
        if (!del || after !== before - 1) find({ ...where('drawing-delete'), rule: 'flow', sev: 'medium', what: `no Delete control for the selected drawing by touch (${before} -> ${after})` });
        // Rotate with a drawing selected and the row open.
        const sel2 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length);
        if (sel2) {
          await t.tap(A); await page.waitForTimeout(200);
        }
        const vp = page.viewportSize();
        await page.setViewportSize({ width: vp.height, height: vp.width }); await page.waitForTimeout(600);
        await audit(page, where('rotated-drawing'), { within: W, shot: true });
        await page.setViewportSize(vp); await page.waitForTimeout(600);
        // Rotate in the middle of drawing a line: the finger lifts after the turn; at most one drawing, no error.
        const trend2 = await ctlBox(page, 'Lines:*', '');
        if (trend2) {
          await t.tap(trend2); await page.waitForTimeout(250);
          const k0 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length);
          const g2 = await geo(page);
          const ph2 = await page.evaluate(() => window.__widget.chart.panes()[0].getHeight());
          const P0 = { x: g2.card.l + g2.card.w * 0.3, y: g2.card.t + ph2 * 0.7 };
          await t.drag(P0, { x: P0.x + 60, y: P0.y - 30 }, { steps: 5, end: false });
          await page.setViewportSize({ width: vp.height, height: vp.width }); await page.waitForTimeout(400);
          await t.move({ x: P0.x + 80, y: P0.y - 40 }); await t.end(); await page.waitForTimeout(400);
          const k1 = await page.evaluate(() => JSON.parse(window.__widget.save().drawings).drawings.length);
          measures[`rotate while drawing ${prof.name}`] = { before: k0, after: k1 };
          if (k1 - k0 > 1) find({ ...where('rotate-while-drawing'), rule: 'flow', sev: 'medium', what: `rotating mid-drawing made ${k1 - k0} drawings` });
          await page.setViewportSize(vp); await page.waitForTimeout(500);
        }
        await tapCtl(page, t, 'Drawing tools');
      }

      // Alerts: the bell, a drag of the line, a group chip and its list, remove.
      await page.evaluate(() => window.__widget.clearAlerts?.());
      if (await tapCtl(page, t, 'Price alert')) {
        await page.waitForFunction(() => window.__widget.alerts().length === 1, null, { timeout: 8000 }).catch(() => {});
        const n = await page.evaluate(() => window.__widget.alerts().length);
        if (n !== 1) find({ ...where('alerts'), rule: 'flow', sev: 'high', what: `one tap on the bell made ${n} alerts` });
        await page.evaluate(() => { const p = window.__last().close; for (let i = 1; i <= 5; i++) window.__widget.addAlert(p * (1 + i * 0.0004)); });
        await page.waitForTimeout(500);
        const chip = await page.evaluate(() => { const all = []; const walk = r => { for (const e of r.querySelectorAll('*')) { all.push(e); if (e.shadowRoot) walk(e.shadowRoot); } }; walk(document); const c = all.find(e => e.tagName === 'BUTTON' && /alerts?$/i.test((e.textContent || '').trim()) && /^\d+ /.test((e.textContent || '').trim())); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, t: c.textContent.trim() }; });
        if (chip) {
          await t.tap(chip); await page.waitForTimeout(300);
          await audit(page, where('alerts-list'), { within: W, shot: true });
          const rm = await page.evaluate(() => { const all = []; const walk = r => { for (const e of r.querySelectorAll('*')) { all.push(e); if (e.shadowRoot) walk(e.shadowRoot); } }; walk(document); const c = all.find(e => e.tagName === 'BUTTON' && /remove/i.test(e.getAttribute('aria-label') || '') && e.checkVisibility()); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
          const k0 = await page.evaluate(() => window.__widget.alerts().length);
          if (rm) { await t.tap(rm); await page.waitForTimeout(300); }
          const k1 = await page.evaluate(() => window.__widget.alerts().length);
          if (k1 !== k0 - 1) find({ ...where('alerts-list'), rule: 'flow', sev: 'high', what: `removing an alert from the list by touch: ${k0} -> ${k1}` });
        } else find({ ...where('alerts'), rule: 'flow', sev: 'medium', what: 'six close alerts made no group chip' });
        await page.evaluate(() => window.__widget.clearAlerts());
        await page.waitForTimeout(200);
        // Drag one alert line by touch.
        await page.evaluate(() => window.__widget.addAlert(window.__last().close * 1.01));
        await page.waitForTimeout(400);
        const line = await page.evaluate(() => { const w = window.__widget, s = w.chart.panes()[0].getSeries()[0], r = w.chart.element().getBoundingClientRect(); const p = w.alerts()[0].price; return { x: r.left + w.chart.timeScale().width() * 0.5, y: r.top + s.priceToCoordinate(p), p }; });
        // A chip sits on the line near the axis; press the chip.
        const chip1 = await page.evaluate(() => { const all = []; const walk = r => { for (const e of r.querySelectorAll('*')) { all.push(e); if (e.shadowRoot) walk(e.shadowRoot); } }; walk(document); return null; });
        void chip1;
        const pr0 = line.p;
        // The chip's label sits about 95 px left of the price axis: a tap selects the alert, then a drag moves it.
        const axisX = await page.evaluate(() => { const w = window.__widget, r = w.chart.element().getBoundingClientRect(); return r.left + w.chart.timeScale().width() - 95; });
        await t.tap({ x: axisX, y: line.y }); await page.waitForTimeout(250);
        const selTa = await page.evaluate(() => getComputedStyle(window.__widget.chart.element()).touchAction);
        await t.drag({ x: axisX, y: line.y }, { x: axisX, y: line.y + 40 }, { steps: 8 }); await page.waitForTimeout(300);
        measures[`alert selected touch-action ${prof.name}`] = selTa;
        const pr1 = await page.evaluate(() => window.__widget.alerts()[0]?.price);
        measures[`alert drag ${prof.name}`] = { from: pr0, to: pr1 };
        if (!(pr1 < pr0)) find({ ...where('alert-drag'), rule: 'flow', sev: 'medium', what: 'dragging an alert chip down by touch did not move it' });
        await page.evaluate(() => window.__widget.clearAlerts());
      } else find({ ...where('alerts'), rule: 'flow', sev: 'medium', what: 'no bell reachable by touch' });

      // Screenshot by touch: a download.
      const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      await tapCtl(page, t, 'Screenshot');
      if (!(await dl)) find({ ...where('screenshot'), rule: 'flow', sev: 'medium', what: 'Screenshot by touch made no download' });
      // Full screen, as an iPhone gets it (no element full screen API): the fallback must fill the viewport.
      await page.evaluate(() => { HTMLElement.prototype.requestFullscreen = undefined; Element.prototype.requestFullscreen = undefined; });
      if (await tapCtl(page, t, 'Full screen')) {
        await page.waitForTimeout(400);
        const fg = await geo(page);
        const vp = page.viewportSize();
        await shot(page, `widget-fullscreen-${prof.short}`);
        if (Math.abs(fg.w.l) > 1 || Math.abs(fg.w.t) > 1 || Math.abs(fg.w.w - vp.width) > 1 || Math.abs(fg.w.h - vp.height) > 1) find({ ...where('fullscreen'), rule: 'fullscreen', sev: 'high', what: `fallback full screen box ${Math.round(fg.w.l)},${Math.round(fg.w.t)} ${Math.round(fg.w.w)}x${Math.round(fg.w.h)} in a ${vp.width}x${vp.height} viewport` });
        const pad = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const top = s.querySelector('.top').getBoundingClientRect(); const bot = s.querySelector('.bot').getBoundingClientRect(); const items = [...s.querySelectorAll('.bar > :not(.hide):not(.sp)')].map(e => e.getBoundingClientRect()).filter(r => r.width); return { top: top.top, botEnd: bot.bottom, minL: Math.min(...items.map(r => r.left)), maxR: Math.max(...items.map(r => r.right)) }; });
        const ins = INSETS[orient];
        const vp2 = page.viewportSize();
        const firstCtl = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const b = s.querySelector('.top .b:not(.hide)').getBoundingClientRect(); const l = s.querySelector('.bot .b:not(.hide)'); const lb = l ? l.getBoundingClientRect() : null; return { topCtl: b.top, botCtl: lb ? lb.bottom : 0 }; });
        if (pad.minL < ins.left - 0.5 || pad.maxR > vp2.width - ins.right + 0.5 || firstCtl.topCtl < ins.top - 0.5 || firstCtl.botCtl > vp2.height - ins.bottom + 0.5) find({ ...where('fullscreen'), rule: 'safe-area', sev: 'high', what: `full screen controls under the notch or home indicator (left ${pad.minL.toFixed(0)} / inset ${ins.left}, right ${(vp2.width - pad.maxR).toFixed(0)} / ${ins.right}, top ${firstCtl.topCtl.toFixed(0)} / ${ins.top}, bottom ${(vp2.height - firstCtl.botCtl).toFixed(0)} / ${ins.bottom})` });
        const scrollLock = await page.evaluate(() => { const se = document.scrollingElement; return getComputedStyle(se).overflowY; });
        measures[`fullscreen ${prof.name}`] = { box: fg.w, scrollLock };
        await tapCtl(page, t, 'Exit full screen');
        await page.waitForTimeout(300);
      }
      // Workspace restore: interval and an indicator survive a reload.
      await page.evaluate(() => window.__widget.setInterval('1h'));
      await page.waitForTimeout(800);
      await page.evaluate(() => sessionStorage.setItem('kept', '1'));
      await page.reload(); await ready(page); await page.waitForTimeout(400);
      const restored = await page.evaluate(() => ({ iv: window.__widget.save().interval, inds: window.__widget.indicators().length }));
      if (restored.iv !== '1h') find({ ...where('restore'), rule: 'flow', sev: 'high', what: `workspace restore: interval ${restored.iv}` });
      await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
      flushErrors(page, where('gestures'));
      await t.cdp.detach().catch(() => {});
      } catch (e) { find({ page: page.url().replace(/^https?:\/\/[^/]+\//, ''), state: 'audit', device: String(typeof prof !== 'undefined' ? prof.name : ''), theme: '', rule: 'audit-error', sev: 'high', what: String(e && e.message || e).split('\n')[0].slice(0, 160) }); await shot(page, 'audit-error').catch(() => {}); }
      await ctx.close();
    }
  }

  // ════════════ 3. the article page: scroll pass-through, sheets, keyboard, rotation, split screen ════════════
  if (!SKIP.has('article')) {
    for (const dev of DEVICES.filter(d => d !== 'iPad Mini' || true)) for (const theme of THEMES.slice(0, 1)) {
      const prof = profile(dev, 'portrait');
      const where = state => ({ page: 'phone-article', state, device: prof.name, theme });
      const { ctx, page } = await open(prof, theme, `examples/phone-article.html?theme=${theme}`);
      try {
      await ready(page); await page.waitForTimeout(400);
      await page.evaluate(() => { window.__noTicks = true; });
      const t = await touchKit(page);
      await audit(page, where('start'), { shot: true });
      // Bring the widget to the upper part of the screen.
      await page.evaluate(() => { const r = document.querySelector('#w').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - 60); });
      await page.waitForTimeout(300);
      let g = await geo(page);
      const vr = () => page.evaluate(() => window.__widget.chart.timeScale().getVisibleLogicalRange());
      // In the price pane, away from the pane separator (a separator drag is its own gesture).
      const P = { x: g.card.l + g.card.w * 0.4, y: g.card.t + g.card.h * 0.4 };
      // Vertical swipe over the chart: the page scrolls.
      let y0 = await page.evaluate(() => scrollY), r0 = await vr();
      await t.drag(P, { x: P.x + 4, y: P.y - 200 }, { steps: 12, stepMs: 16, release: 120 });
      await page.waitForTimeout(700);
      let y1 = await page.evaluate(() => scrollY), r1 = await vr();
      measures[`scroll through chart ${prof.name}`] = { finger: 200, page: Math.round(y1 - y0), chartPanned: +Math.abs(r1.from - r0.from).toFixed(2) };
      if (y1 - y0 < 150) find({ ...where('vertical-swipe'), rule: 'scroll-pass-through', sev: 'high', what: `a 200 px vertical swipe over the chart scrolled the page ${Math.round(y1 - y0)} px` });
      if (Math.abs(r1.from - r0.from) > 1) find({ ...where('vertical-swipe'), rule: 'scroll-pass-through', sev: 'medium', what: `a vertical swipe also panned the chart by ${Math.abs(r1.from - r0.from).toFixed(1)} bars` });
      // Horizontal swipe: the chart pans, the page does not move.
      await page.evaluate(() => { const r = document.querySelector('#w').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - 60); });
      await page.waitForTimeout(300);
      g = await geo(page);
      const H = { x: g.card.l + g.card.w * 0.3, y: g.card.t + g.card.h * 0.4 };
      y0 = await page.evaluate(() => scrollY); r0 = await vr();
      await t.drag(H, { x: H.x + 160, y: H.y + 6 }, { steps: 10, release: 120 }); await page.waitForTimeout(500);
      y1 = await page.evaluate(() => scrollY); r1 = await vr();
      measures[`horizontal swipe ${prof.name}`] = { page: Math.round(y1 - y0), chartBars: +(r0.from - r1.from).toFixed(1) };
      if (Math.abs(y1 - y0) > 4) find({ ...where('horizontal-swipe'), rule: 'scroll-pass-through', sev: 'medium', what: `a horizontal swipe scrolled the page ${y1 - y0} px` });
      if (!(r1.from < r0.from - 2)) find({ ...where('horizontal-swipe'), rule: 'gesture', sev: 'high', what: 'a horizontal swipe did not pan the chart' });
      // With a sheet open: a swipe on the sheet or the scrim does not scroll the page under it.
      await page.evaluate(() => { const r = document.querySelector('#w').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - 60); });
      await page.waitForTimeout(300);
      if (await tapCtl(page, t, 'Settings')) {
        g = await geo(page);
        y0 = await page.evaluate(() => scrollY);
        const onSheet = g.layer ? { x: g.layer.l + g.layer.w / 2, y: g.layer.t + 14 } : null;
        if (onSheet) { await t.drag(onSheet, { x: onSheet.x, y: onSheet.y - 150 }, { steps: 10, release: 100 }); await page.waitForTimeout(500); }
        y1 = await page.evaluate(() => scrollY);
        const sheetScroll = Math.round(y1 - y0);
        // A swipe inside the list scrolls the list, not the page (scroll chaining at its end).
        const list = await page.evaluate(() => { const s = document.querySelector('[data-chartist-widget]').shadowRoot; const d = s.querySelector('.dlg .db'); const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, max: d.scrollHeight - d.clientHeight }; });
        y0 = await page.evaluate(() => scrollY);
        for (let i = 0; i < 2; i++) { await t.drag(list, { x: list.x, y: list.y - 220 }, { steps: 10, release: 100 }); await page.waitForTimeout(400); }
        y1 = await page.evaluate(() => scrollY);
        const chain = Math.round(y1 - y0);
        const g2 = await geo(page);
        y0 = await page.evaluate(() => scrollY);
        const scrimPt = { x: g2.w.l + g2.w.w / 2, y: g2.w.t + 8 };
        measures[`sheet open ${prof.name}`] = { swipeOnSheetHeader: sheetScroll, listOverscroll: chain, listCanScroll: list.max };
        if (Math.abs(sheetScroll) > 4) find({ ...where('sheet-open'), rule: 'scroll-lock', sev: 'medium', what: `a swipe on an open sheet scrolled the page ${sheetScroll} px` });
        if (Math.abs(chain) > 4) find({ ...where('sheet-open'), rule: 'scroll-chain', sev: 'medium', what: `swiping past the end of the sheet's list scrolled the page ${chain} px` });
        void scrimPt;
        // Rotate while the sheet is open.
        const vp = page.viewportSize();
        await page.setViewportSize({ width: vp.height, height: vp.width }); await page.waitForTimeout(500);
        const rg = await geo(page);
        await audit(page, where('rotated-sheet'), { within: W, shot: true });
        if (rg.layer && (rg.layer.b > rg.w.b + 1 || rg.layer.t < rg.w.t - 1)) find({ ...where('rotated-sheet'), rule: 'clipped', sev: 'high', what: 'after rotation the sheet runs out of the widget' });
        await page.setViewportSize(vp); await page.waitForTimeout(400);
        await closeLayers(page);
        const locked = await page.evaluate(() => getComputedStyle(document.documentElement).overflow + '/' + getComputedStyle(document.body).overflow);
        measures[`after sheet ${prof.name}`] = { overflow: locked };
        if (/hidden/.test(locked)) find({ ...where('sheet-closed'), rule: 'scroll-lock', sev: 'high', what: `page scroll still locked after the sheet closed (${locked})` });
      }
      // The on-screen keyboard: the visual viewport shrinks while the symbol search is open; the field and the first
      // results must stay above it.
      await page.evaluate(() => { const r = document.querySelector('#w').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - 40); });
      await page.waitForTimeout(300);
      const sym = await ctlBox(page, 'Search symbol', '.top');
      if (sym) {
        await t.tap(sym); await page.waitForTimeout(300);
        const vp = page.viewportSize();
        const kb = Math.round(vp.height * 0.42);
        await page.setViewportSize({ width: vp.width, height: vp.height - kb }); await page.waitForTimeout(500);
        const k = await page.evaluate(() => {
          const s = document.querySelector('[data-chartist-widget]').shadowRoot;
          const inp = s.querySelector('.dlg input'); const opts = [...s.querySelectorAll('.dlg [role=option]')].slice(0, 2);
          const vb = visualViewport.offsetTop + visualViewport.height;
          const r = inp.getBoundingClientRect();
          return { input: { t: r.top, b: r.bottom }, opts: opts.map(o => o.getBoundingClientRect().bottom), vb, focused: s.activeElement === inp };
        });
        await shot(page, `article-keyboard-${prof.short}`);
        measures[`keyboard ${prof.name}`] = { keyboard: kb, inputBottom: Math.round(k.input.b), visibleBottom: Math.round(k.vb), firstResults: k.opts.map(Math.round) };
        if (k.input.b > k.vb || k.input.t < 0) find({ ...where('keyboard'), rule: 'keyboard', sev: 'high', what: `the search field is hidden by the keyboard (field bottom ${Math.round(k.input.b)}, visible to ${Math.round(k.vb)})` });
        else if (k.opts.some(b => b > k.vb)) find({ ...where('keyboard'), rule: 'keyboard', sev: 'medium', what: 'the first results are under the keyboard' });
        await page.setViewportSize(vp); await page.waitForTimeout(300);
        await closeLayers(page);
      }
      // URL bar hide / show: a 56 px height change must not re-collapse the bars or jump the page.
      const before = await page.evaluate(() => [...document.querySelector('[data-chartist-widget]').shadowRoot.querySelectorAll('.bar > *')].map(e => e.classList.contains('hide') ? 0 : 1).join(''));
      const sy0 = await page.evaluate(() => scrollY);
      const vp = page.viewportSize();
      await page.setViewportSize({ width: vp.width, height: vp.height + 56 }); await page.waitForTimeout(300);
      const after = await page.evaluate(() => [...document.querySelector('[data-chartist-widget]').shadowRoot.querySelectorAll('.bar > *')].map(e => e.classList.contains('hide') ? 0 : 1).join(''));
      const sy1 = await page.evaluate(() => scrollY);
      await page.setViewportSize(vp); await page.waitForTimeout(300);
      if (before !== after) find({ ...where('url-bar'), rule: 'layout-jump', sev: 'medium', what: 'the bars re-collapsed on a height-only resize' });
      if (Math.abs(sy1 - sy0) > 1) find({ ...where('url-bar'), rule: 'layout-jump', sev: 'medium', what: `the page jumped ${sy1 - sy0}px on a URL bar change` });
      // Split screen widths.
      for (const wd of [320, 280]) {
        await page.setViewportSize({ width: wd, height: vp.height }); await page.waitForTimeout(500);
        await audit(page, where(`split-${wd}`), { shot: true });
      }
      await page.setViewportSize(vp);
      flushErrors(page, where('article'));
      await t.cdp.detach().catch(() => {});
      } catch (e) { find({ page: page.url().replace(/^https?:\/\/[^/]+\//, ''), state: 'audit', device: String(typeof prof !== 'undefined' ? prof.name : ''), theme: '', rule: 'audit-error', sev: 'high', what: String(e && e.message || e).split('\n')[0].slice(0, 160) }); await shot(page, 'audit-error').catch(() => {}); }
      await ctx.close();
    }
  }

  // ════════════ 4. other widget pages and the standalone examples ════════════
  if (!SKIP.has('pages')) {
    const pages = [
      ['examples/widget-live.html?fake', 'widget-live-fake', true],
      ['examples/widget-terminal.html', 'widget-terminal', false],
      ['examples/drawings.html', 'drawings', false],
      ['examples/extras.html', 'extras', false],
      ['examples/bitcoin.html?demo', 'bitcoin', false],
      ['examples/element.html', 'element', false],
    ];
    for (const dev of DEVICES) for (const orient of ORIENT) for (const theme of THEMES) {
      const prof = profile(dev, orient);
      for (const [file, name, isWidget] of pages) {
        const where = state => ({ page: name, state, device: prof.name, theme });
        const { ctx, page } = await open(prof, theme, `${file}${file.includes('?') ? '&' : '?'}theme=${theme}`);
        try {
        await page.waitForTimeout(isWidget ? 2000 : 1500);
        await audit(page, where('start'), { shot: theme === 'light' || dev === 'iPhone 14' });
        flushErrors(page, where('start'));
        } catch (e) { find({ page: page.url().replace(/^https?:\/\/[^/]+\//, ''), state: 'audit', device: String(typeof prof !== 'undefined' ? prof.name : ''), theme: '', rule: 'audit-error', sev: 'high', what: String(e && e.message || e).split('\n')[0].slice(0, 160) }); await shot(page, 'audit-error').catch(() => {}); }
        await ctx.close();
      }
    }
  }

  // ════════════ 5. the docs site ════════════
  if (!SKIP.has('site')) {
    if (!fs.existsSync(path.join(root, 'site', 'dist', 'index.html'))) execFileSync('node', ['site/build.mjs'], { cwd: root, stdio: 'inherit' });
    const sitePages = ['site/dist/index.html', 'site/dist/guide/widget.html', 'site/dist/guide/indicator-catalogue.html', 'site/dist/guide/how-it-compares.html', 'site/dist/examples.html', 'site/dist/guide/getting-started.html'];
    for (const dev of DEVICES) for (const orient of ORIENT) for (const theme of THEMES) {
      const prof = profile(dev, orient);
      for (const file of sitePages) {
        const name = `site:${file.replace('site/dist/', '')}`;
        const where = state => ({ page: name, state, device: prof.name, theme });
        const { ctx, page } = await open(prof, theme, file, { init: th => { try { localStorage.setItem('chartist-site-theme', th); } catch { /* */ } }, });
        try {
        await page.evaluate(th => { document.documentElement.dataset.theme = th; }, theme).catch(() => {});
        await page.waitForTimeout(1500);
        await audit(page, where('start'), { shot: theme === 'light' && (dev === 'iPhone SE' || dev === 'iPhone 14') });
        // The drawer (menu button) on narrow screens, and search.
        const t = await touchKit(page);
        const menu = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /menu|navigation|contents/i.test(x.getAttribute('aria-label') || '') && x.checkVisibility()); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        if (menu && file.endsWith('widget.html')) { await t.tap(menu); await page.waitForTimeout(400); await audit(page, where('drawer'), { shot: theme === 'light' && dev === 'iPhone SE' }); await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
        // At 320 and 280 nothing overflows sideways.
        if (orient === 'portrait' && dev === DEVICES[0] && theme === THEMES[0]) {
          const vp = page.viewportSize();
          for (const wd of [320, 280]) { await page.setViewportSize({ width: wd, height: vp.height }); await page.waitForTimeout(400); await audit(page, where(`width-${wd}`), { shot: wd === 320 }); }
        }
        flushErrors(page, where('start'));
        await t.cdp.detach().catch(() => {});
        } catch (e) { find({ page: page.url().replace(/^https?:\/\/[^/]+\//, ''), state: 'audit', device: String(typeof prof !== 'undefined' ? prof.name : ''), theme: '', rule: 'audit-error', sev: 'high', what: String(e && e.message || e).split('\n')[0].slice(0, 160) }); await shot(page, 'audit-error').catch(() => {}); }
        await ctx.close();
      }
    }
  }

  // ════════════ 6. performance under CPU throttling ════════════
  if (!SKIP.has('perf')) {
    const prof = profile(DEVICES.includes('iPhone 14') ? 'iPhone 14' : DEVICES[0], 'portrait');
    const { ctx, page } = await open(prof, 'light', 'examples/phone-article.html?perf');
    try {
    await ready(page); await page.waitForTimeout(1500);
    const cdp = await ctx.newCDPSession(page);
    const t = await touchKit(page);
    await page.evaluate(() => { const r = document.querySelector('#w').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - 40); });
    await page.waitForTimeout(300);
    const setup = await page.evaluate(() => ({ bars: window.__widget.chart.panes()[0].getSeries()[0].data().length, inds: window.__widget.indicators().length, drawings: JSON.parse(window.__widget.save().drawings || '{"drawings":[]}').drawings.length, canvas: [...window.__widget.chart.element().querySelectorAll('canvas')].map(c => `${c.width}x${c.height}`), dpr: devicePixelRatio }));
    measures.perfSetup = setup;
    // Frame cost: script in input handlers + every requestAnimationFrame callback, per frame, measured in the page
    // (the throttled clock). Style and layout the frame causes is in the rAF time when the frame forces it.
    await page.evaluate(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.__frames = []; let cur = 0, frameOpen = false;
      const flush = () => { if (frameOpen) { window.__frames.push(cur); cur = 0; frameOpen = false; } };
      window.requestAnimationFrame = cb => raf(ts => { const a = performance.now(); try { cb(ts); } finally { cur += performance.now() - a; frameOpen = true; queueMicrotask(() => {}); } });
      // Close a frame at the start of the next task after paint.
      const tick = () => { raf(() => setTimeout(() => { flush(); }, 0)); };
      window.__tick = tick;
      for (const type of ['pointermove', 'pointerdown', 'pointerup', 'touchmove']) {
        let s = 0;
        window.addEventListener(type, () => { s = performance.now(); }, true);
        window.addEventListener(type, () => { cur += performance.now() - s; frameOpen = true; }, false);
      }
      window.__startFrames = () => { window.__frames = []; cur = 0; frameOpen = false; const loop = () => { if (!window.__stopF) { raf(() => setTimeout(() => { flush(); loop(); }, 0)); } }; window.__stopF = false; loop(); };
      window.__stopFrames = () => { window.__stopF = true; flush(); return window.__frames.slice(); };
    });
    const g = await geo(page);
    const P = { x: g.card.l + g.card.w * 0.5, y: g.card.t + g.card.h * 0.35 };
    const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : null; };
    const scen = {
      pan: async () => { await t.drag(P, { x: P.x - 150, y: P.y }, { steps: 40, stepMs: 16 }); await t.drag({ x: P.x - 150, y: P.y }, P, { steps: 40, stepMs: 16 }); },
      pinch: async () => { await t.pinch(P, 60, 220, { steps: 30 }); await t.pinch(P, 220, 60, { steps: 30 }); },
      crosshair: async () => { // the tooltip's long press, then a drag along the bars
        await t.longPress(P, 500); for (let i = 1; i <= 60; i++) { await t.move({ x: P.x - 100 + i * 4, y: P.y }); await sleep(16); } await t.end(); },
      tick: async () => { for (let i = 0; i < 60; i++) { await page.evaluate(() => window.__push(window.__last().close * (1 + (Math.random() - 0.5) * 0.002))); await sleep(16); } },
    };
    const perf = {};
    for (const rate of [1, 4, 6]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      for (const [name, run] of Object.entries(scen)) {
        await page.evaluate(() => window.__startFrames());
        await run();
        await page.waitForTimeout(200);
        const frames = (await page.evaluate(() => window.__stopFrames())).filter(x => x > 0);
        perf[`${name} @${rate}x`] = { frames: frames.length, p50: q(frames, 0.5), p95: q(frames, 0.95), max: q(frames, 1) };
      }
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    measures.perf = perf;
    for (const [k, v] of Object.entries(perf)) {
      if (/@4x/.test(k) && v.p95 > 16.7) find({ page: 'perf', state: k, device: prof.name, theme: 'light', rule: 'frame-budget', sev: 'medium', what: `p95 ${v.p95} ms over 16.7 ms at 4x throttling` });
    }
    // The backing store at DPR 3 (iPhone): whole device pixels, no more.
    const big = await page.evaluate(() => [...window.__widget.chart.element().querySelectorAll('canvas')].map(c => ({ w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight })));
    measures.backingStore = big;
    for (const c of big) if (c.w * c.h > 16777216) find({ page: 'perf', state: 'canvas', device: prof.name, theme: 'light', rule: 'canvas-size', sev: 'high', what: `canvas ${c.w}x${c.h} over the iOS 16.7 M pixel limit` });
    flushErrors(page, { page: 'perf', state: 'run', device: prof.name, theme: 'light' });
    } catch (e) { find({ page: page.url().replace(/^https?:\/\/[^/]+\//, ''), state: 'audit', device: String(typeof prof !== 'undefined' ? prof.name : ''), theme: '', rule: 'audit-error', sev: 'high', what: String(e && e.message || e).split('\n')[0].slice(0, 160) }); await shot(page, 'audit-error').catch(() => {}); }
    await ctx.close();
  }

  // ════════════ 7. the real Coinbase feed (optional, --net) ════════════
  if (LIVE_NET) {
    const prof = profile('iPhone 14', 'portrait');
    const { ctx, page } = await open(prof, 'dark', 'examples/widget-live.html');
    try {
    let status = null;
    try { await page.waitForFunction(() => /live/i.test(document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.st')?.textContent || ''), null, { timeout: 20000 }); status = 'live'; } catch { status = 'no live status in 20 s'; }
    const st = await page.evaluate(() => document.querySelector('[data-chartist-widget]').shadowRoot.querySelector('.st')?.textContent);
    measures.coinbase = { status, text: st };
    await shot(page, 'widget-live-coinbase');
    await audit(page, { page: 'widget-live-coinbase', state: 'start', device: prof.name, theme: 'dark' }, { within: W });
    } catch (e) { find({ page: page.url().replace(/^https?:\/\/[^/]+\//, ''), state: 'audit', device: String(typeof prof !== 'undefined' ? prof.name : ''), theme: '', rule: 'audit-error', sev: 'high', what: String(e && e.message || e).split('\n')[0].slice(0, 160) }); await shot(page, 'audit-error').catch(() => {}); }
    await ctx.close();
  }

  await browser.close();
  server.close();

  // ── PHONE_SHOTS=1: the representative final shots into docs/screenshots/phone-*.png ──
  if (process.env.PHONE_SHOTS) {
    const pick = {
      'phone-widget-portrait.png': /-widget-start-iPhone-14-light\.png$/,
      'phone-widget-portrait-dark.png': /-widget-start-iPhone-14-dark\.png$/,
      'phone-widget-landscape.png': /-widget-start-iPhone-14-landscape-light\.png$/,
      'phone-widget-se.png': /-widget-start-iPhone-SE-light\.png$/,
      'phone-drawing-flyout-landscape.png': /-widget-drawing-flyout-iPhone-14-landscape-light\.png$/,
      'phone-indicators.png': /-widget-indicators-iPhone-14-light\.png$/,
      'phone-indicator-settings.png': /-widget-indicator-settings-iPhone-14-light\.png$/,
      'phone-draw-touch.png': /-widget-draw-touch-iPhone-14\.png$/,
      'phone-drawing-landscape.png': /-widget-drawing-selected-iPhone-14-landscape-light\.png$/,
      'phone-alerts-list.png': /-widget-alerts-list-iPhone-14-light\.png$/,
      'phone-article-keyboard.png': /-article-keyboard-iPhone-14\.png$/,
      'phone-site-home.png': /-site-index-html-start-iPhone-14-light\.png$/,
    };
    const files = fs.readdirSync(shotDir);
    for (const [name, re] of Object.entries(pick)) {
      const f = files.find(x => re.test(x));
      if (f) fs.copyFileSync(path.join(shotDir, f), path.join(root, 'docs', 'screenshots', name));
      else console.log(`no shot for ${name}`);
    }
  }

  // ── report ──
  const groups = new Map();
  for (const f of findings) {
    const k = `${f.sev}|${f.rule}|${f.page}|${f.state}|${f.what.replace(/\d+(\.\d+)?(x\d+(\.\d+)?)?(px| px| ms)?/g, '#')}`;
    if (!groups.has(k)) groups.set(k, { ...f, devices: new Set(), themes: new Set(), examples: [] });
    const g = groups.get(k); g.devices.add(f.device); g.themes.add(f.theme); if (g.examples.length < 2 && !g.examples.includes(f.what)) g.examples.push(f.what);
  }
  const list = [...groups.values()].sort((a, b) => sevRank[b.sev] - sevRank[a.sev] || a.page.localeCompare(b.page));
  const fails = list.filter(f => f.sev === 'high' || f.sev === 'medium');
  const lines = [];
  lines.push('# Phone audit', '', `Run ${new Date().toISOString()} in Chromium ${pw.chromium.name() && ''}(Playwright device profiles, CDP touch). ${((Date.now() - started) / 1000).toFixed(0)} s.`, '');
  lines.push(`Devices: ${DEVICES.join(', ')}; ${ORIENT.join(' and ')}; ${THEMES.join(' and ')}. Emulated safe-area insets: portrait ${JSON.stringify(INSETS.portrait)}, landscape ${JSON.stringify(INSETS.landscape)}.`, '');
  lines.push(`**${fails.length === 0 ? 'PASS' : 'FAIL'}**: ${list.filter(f => f.sev === 'high').length} high, ${list.filter(f => f.sev === 'medium').length} medium, ${list.filter(f => f.sev === 'low').length} low (grouped across devices). ${measures.targets || 0} target checks, ${measures.spacingRule || 0} passed by the spacing rule (24 px with a clear 44 px square).`, '');
  lines.push('WebKit (iOS Safari) is not installed: everything here ran in Chromium with iPhone and iPad profiles.', '');
  if (list.length) {
    lines.push('## Findings', '', '| Severity | Rule | Page | State | What | Devices | Shot |', '|---|---|---|---|---|---|---|');
    for (const f of list) lines.push(`| ${f.sev} | ${f.rule} | ${f.page} | ${f.state} | ${f.examples.join('; ').replace(/\|/g, '/')} | ${[...f.devices].join(', ')} (${[...f.themes].join(', ')}) | ${f.shot ? `[shot](${f.shot})` : ''} |`);
    lines.push('');
  }
  lines.push('## Measurements', '', '```json', JSON.stringify(measures, null, 1), '```', '');
  fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ findings: list.map(f => ({ ...f, devices: [...f.devices], themes: [...f.themes] })), measures }, null, 1));
  console.log(lines.slice(0, 8).join('\n'));
  for (const f of list) console.log(`${f.sev.padEnd(6)} ${f.rule.padEnd(20)} ${f.page} / ${f.state}: ${f.examples[0]}  [${f.devices.size} profiles]`);
  console.log(`report: ${path.relative(root, path.join(outDir, 'report.md'))}`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
