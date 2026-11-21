// Page script, deferred. Theme toggle, drawer, search, copy buttons, tabs, the chapter capsule (scroll-spy), the API
// filter, the examples gallery, the frame meter, and the live charts. Chart scripts load only when a chart nears the
// viewport. Every feature checks for its own elements, so one page script serves every page.
import { makeBars, makeBenchmark, makeIntraday } from './demo-data.js';

const root = document.documentElement;
const ASSETS = root.dataset.assets || 'assets/';
const ROOT = root.dataset.root || '';
const registry = [];
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

// ---------- theme: dark by default, light when chosen; remembered ----------
const currentTheme = () => (root.dataset.theme === 'light' ? 'light' : 'dark');
function applyTheme(name, store) {
  root.dataset.theme = name;
  const t = $('#theme-toggle');
  if (t) t.setAttribute('aria-pressed', String(name === 'dark'));
  for (const b of $$('[data-set-theme]')) b.setAttribute('aria-pressed', String(b.dataset.setTheme === name));
  for (const e of registry) { try { e.restyle(name); } catch (err) { /* a chart removed meanwhile */ } }
  for (const el of $$('chartist-chart')) el.setAttribute('theme', name);
  if (store) { try { localStorage.setItem('cl-theme', name); } catch (e) { /* storage blocked: this visit only */ } }
}

// ---------- scripts on demand ----------
const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => resolve(); s.onerror = () => reject(new Error(`could not load ${src}`));
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}
function chartLibs() {
  const list = [`${ASSETS}chartist-lite.iife.min.js`, `${ASSETS}chartist-lite-indicators.iife.min.js`];
  if (root.hasAttribute('data-demos')) list.push(`${ASSETS}demos.js`);
  if (root.dataset.live) list.push(`${ASSETS}${root.dataset.live}`);
  return Promise.all(list.map(loadScript));
}

// ---------- live charts ----------
function liveApi(el, charts) {
  const L = window.ChartistLite;
  const I = window.ChartistLiteIndicators || {};
  const bars = makeBars(220, 7);
  return {
    ...L, ...I, bars, intradayBars: makeIntraday(5, 37), benchmark: makeBenchmark(bars),
    // The example's own container is used whatever id the code names, and the site theme is applied.
    createChart(_container, options = {}) {
      const c = L.createChart(el, { ...options, theme: currentTheme(), ariaLabel: options.ariaLabel || el.dataset.label });
      charts.push(c);
      return c;
    },
  };
}
function create(el) {
  if (el.dataset.ready === '1' || !window.ChartistLite) return el._demo || null;
  try {
    let entry;
    el.textContent = '';
    if (el.dataset.demo === 'live') {
      const fn = (window.__CL_LIVE || {})[el.dataset.live];
      if (!fn) return null;
      const charts = [];
      fn(liveApi(el, charts));
      entry = { charts };
    } else {
      const make = (window.__CL_DEMOS || {})[el.dataset.demo];
      if (!make) return null;
      entry = make(el, window.ChartistLite, currentTheme());
    }
    if (!entry.restyle) entry.restyle = (t) => entry.charts.forEach((c) => c.applyOptions({ theme: t }));
    el._demo = entry;
    el.dataset.ready = '1';
    registry.push(entry);
    el.dispatchEvent(new CustomEvent('cl-ready', { bubbles: true }));
    return entry;
  } catch (err) {
    el.dataset.ready = '';
    el.textContent = 'This chart could not be drawn in this browser.';
    return null;
  }
}
async function createNow(el) { await chartLibs(); return create(el); }

function initCharts() {
  const demos = $$('[data-demo]');
  const elements = $$('chartist-chart');
  for (const el of elements) el.setAttribute('theme', currentTheme());
  const near = (el, fn) => {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '300px' });
    io.observe(el);
  };
  for (const el of demos) near(el, () => { chartLibs().then(() => create(el)).catch(() => { el.textContent = 'The chart script could not be loaded.'; }); });
  if (elements.length) {
    const load = () => loadScript(`${ASSETS}chartist-lite.element.iife.min.js`).catch(() => {});
    for (const el of elements) near(el, load);
  }
}

// Control strips: buttons act on the chart in the same [data-stage].
function pressIn(btn, attr) {
  const group = btn.closest('[role="group"]') || btn.parentElement;
  for (const b of group.querySelectorAll(`[${attr}]`)) b.setAttribute('aria-pressed', String(b === btn));
}
function initControls() {
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-set-theme]');
    if (t) { applyTheme(t.dataset.setTheme, true); return; }
    const btn = e.target.closest('[data-zone], [data-chart-theme], [data-scale], [data-focus-chart]');
    if (!btn) return;
    const stage = btn.closest('[data-stage]');
    const el = stage && stage.querySelector('[data-demo]');
    if (!el) return;
    const entry = await createNow(el);
    if (!entry) return;
    const chart = entry.charts[0];
    if (btn.dataset.zone) { pressIn(btn, 'data-zone'); for (const c of entry.charts) c.applyOptions({ timeScale: { timeZone: btn.dataset.zone } }); }
    else if (btn.dataset.chartTheme) { pressIn(btn, 'data-chart-theme'); for (const c of entry.charts) c.applyOptions({ theme: btn.dataset.chartTheme }); }
    else if (btn.dataset.scale) { pressIn(btn, 'data-scale'); for (const c of entry.charts) c.priceScale('right').applyOptions({ mode: btn.dataset.scale }); }
    else if ('focusChart' in btn.dataset && chart) chart.element().focus();
  });
}

// ---------- copy buttons ----------
const status = document.createElement('div');
status.className = 'visually-hidden'; status.setAttribute('role', 'status');
function initCopy() {
  document.body.appendChild(status);
  for (const b of $$('.copy')) b.hidden = false;
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('.copy');
    if (!b) return;
    const pre = b.closest('.code').querySelector('pre');
    const text = pre.textContent;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'visually-hidden';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
    }
    b.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    if (ok) b.dataset.copied = '';
    status.textContent = ok ? 'Code copied' : 'Copy is blocked here: select the code and copy it';
    if (!ok) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    clearTimeout(b._t);
    b._t = setTimeout(() => { b.textContent = 'Copy'; delete b.dataset.copied; }, 1600);
  });
}

// ---------- tabs (ARIA tabs with arrow keys) ----------
function initTabs() {
  for (const box of $$('[data-tabs]')) {
    const tabs = $$('[role="tab"]', box);
    const select = (tab, focus) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      }
      if (focus) tab.focus();
    };
    box.addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) select(t, false); });
    box.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let n = -1;
      if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabs.length - 1;
      if (n >= 0) { e.preventDefault(); select(tabs[n], true); }
    });
  }
}

// ---------- chapters: scroll-spy on the capsule ----------
function initChapters() {
  for (const nav of $$('nav.chapters')) {
    const links = $$('a', nav);
    const targets = links.map((a) => document.getElementById(a.getAttribute('href').slice(1)));
    let current = -1;
    const update = () => {
      const line = nav.getBoundingClientRect().bottom + 120;
      let idx = 0;
      targets.forEach((t, i) => { if (t && t.getBoundingClientRect().top <= line) idx = i; });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        // At the very end the last chapter may never reach the line: mark it once its heading is on screen.
        const last = targets.length - 1;
        if (targets[last] && targets[last].getBoundingClientRect().top < window.innerHeight) idx = last;
      }
      if (idx === current) return;
      current = idx;
      links.forEach((a, i) => { if (i === idx) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      const a = links[idx];
      const l = a.offsetLeft - 8; const r = a.offsetLeft + a.offsetWidth + 8;
      if (l < nav.scrollLeft) nav.scrollLeft = l; else if (r > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = r - nav.clientWidth;
    };
    let ticking = false;
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); } }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }
}

// ---------- dialogs: drawer, search and the example view share one focus trap ----------
function trap(dialog) {
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = $$('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])', dialog).filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!f.length) return;
    const first = f[0]; const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  for (const b of $$('[data-close]', dialog)) b.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}
function openDialog(dialog, opener, focusEl) {
  dialog._opener = opener || document.activeElement;
  dialog.showModal();
  (focusEl || $('[data-close]', dialog)).focus();
}
function initDialogs() {
  for (const d of $$('dialog')) {
    trap(d);
    d.addEventListener('close', () => { if (d._opener && d._opener.focus) d._opener.focus(); });
  }
  const drawer = $('#drawer');
  const menu = $('#menu-open');
  if (drawer && menu) {
    menu.addEventListener('click', () => openDialog(drawer, menu, $('[aria-current="page"]', drawer) || $('[data-close]', drawer)));
    drawer.addEventListener('click', (e) => { if (e.target.closest('a')) drawer.close(); });
  }
}

// ---------- search ----------
function initSearch() {
  const dialog = $('#search');
  const input = $('#search-input');
  const list = $('#search-results');
  const statusEl = $('#search-status');
  const openBtn = $('#search-open');
  if (!dialog || !input) return;
  let index = null;
  let active = -1;
  let items = [];
  const norm = (s) => s.toLowerCase();
  const mark = (text, terms) => {
    let out = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    for (const t of terms) if (t) out = out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>');
    return out;
  };
  function search(q) {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length || !index) return [];
    const out = [];
    for (const doc of index) {
      const entries = [[doc.t, '', doc.d, 3], ...doc.s.map(([h, id, lead]) => [h, id, lead, 2])];
      entries.forEach(([h, id, lead, weight], k) => {
        const hay = norm(`${h} ${lead} ${k === 0 ? '' : doc.t}`);
        if (!terms.every((t) => hay.includes(t))) return;
        let score = weight;
        for (const t of terms) { if (norm(h).includes(t)) score += 4; if (norm(h).startsWith(t)) score += 2; }
        out.push({ score, title: h, page: doc.t, href: `${ROOT}${doc.u}${id ? `#${id}` : ''}`, text: lead || '', top: k === 0 });
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 12);
  }
  function select(i) {
    active = i;
    $$('li', list).forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) { const li = list.children[i]; input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }
  function render() {
    const q = input.value.trim();
    items = search(q);
    const terms = norm(q).split(/\s+/).filter(Boolean);
    list.innerHTML = items.map((r, i) => `<li role="option" id="sr-${i}" aria-selected="false"><a href="${r.href}" tabindex="-1"><span class="r-path">${r.top ? 'Page' : mark(r.page, [])}</span><span class="r-title">${mark(r.title, terms)}</span>${r.text ? `<span class="r-text">${mark(r.text, terms)}</span>` : ''}</a></li>`).join('');
    input.setAttribute('aria-expanded', String(items.length > 0));
    statusEl.hidden = items.length > 0 && q !== '';
    statusEl.textContent = !q ? 'Type to search every page and heading.' : items.length ? `${items.length} results` : `Nothing matches "${q}". Try a shorter word.`;
    if (items.length) statusEl.hidden = true;
    select(items.length ? 0 : -1);
  }
  async function open(opener) {
    if (!dialog.open) openDialog(dialog, opener, input);
    input.select();
    if (!index) {
      statusEl.textContent = 'Loading the index';
      try { await loadScript(`${ASSETS}search-index.js`); index = window.__CL_SEARCH || []; } catch (e) { statusEl.textContent = 'The search index could not be loaded.'; return; }
      render();
    }
  }
  if (openBtn) openBtn.addEventListener('click', () => open(openBtn));
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); select((active + 1) % items.length); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); select((active - 1 + items.length) % items.length); }
    else if (e.key === 'Escape') { e.preventDefault(); dialog.close(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); const a = $('a', list.children[active]); dialog.close(); location.href = a.href; }
  });
  list.addEventListener('mousemove', (e) => { const li = e.target.closest('li'); if (li) { const i = Array.from(list.children).indexOf(li); if (i !== active) select(i); } });
  list.addEventListener('click', () => dialog.close());
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      if (document.querySelector('dialog[open]:not(#search)')) return;
      e.preventDefault();
      open(document.activeElement);
    }
  });
}

// ---------- API filter ----------
function initApiFilter() {
  const input = $('#api-filter');
  if (!input) return;
  const prose = input.closest('.prose');
  const count = $('#api-count');
  const nodes = Array.from(prose.children);
  // Groups: each chapter label starts one; entries belong to the group above them.
  const groups = [];
  let g = null;
  for (const n of nodes) {
    if (n.classList.contains('chapter-label')) { g = { head: [n], rest: [], entries: [] }; groups.push(g); continue; }
    if (!g || n.matches('.api-filter, .doc-head, .chapters, .pager, .onward, .related')) continue;
    if (n.tagName === 'H2') g.head.push(n);
    else if (n.classList.contains('entry')) { n._text = `${n.dataset.entry} ${n.textContent}`.toLowerCase(); g.entries.push(n); }
    else g.rest.push(n);
  }
  const total = groups.reduce((a, x) => a + x.entries.length, 0);
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const grp of groups) {
      let any = 0;
      for (const en of grp.entries) { const ok = !q || en._text.includes(q); en.hidden = !ok; if (ok) any++; }
      shown += any;
      for (const n of grp.head) n.hidden = !!q && any === 0;
      for (const n of grp.rest) n.hidden = !!q;
    }
    count.textContent = q ? (shown ? `${shown} of ${total} entries match` : 'No entry matches. Try part of a name, such as "scale".') : '';
  });
}

// ---------- examples gallery ----------
function initGallery() {
  const gallery = $('#ex-gallery');
  if (!gallery || !$('#ex-dialog')) return;
  document.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (!f) return;
    pressIn(f, 'data-filter');
    for (const card of $$('.ex-card', gallery)) card.hidden = f.dataset.filter !== 'all' && card.dataset.kind !== f.dataset.filter;
  });
  const dialog = $('#ex-dialog');
  const stage = $('#ex-dialog-stage');
  let entry = null;
  gallery.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-open]');
    if (!b) return;
    const card = b.closest('.ex-card');
    $('#ex-dialog-title').textContent = $('h2', card).textContent;
    $('#ex-dialog-text').innerHTML = $('.ex-body p', card).innerHTML;
    const guide = $('.ex-actions a', card);
    const gl = $('#ex-dialog-guide');
    gl.href = guide.getAttribute('href'); gl.textContent = guide.textContent;
    $('#ex-dialog-code').replaceChildren($('.ex-source .code', card).cloneNode(true));
    for (const c of $$('.copy', $('#ex-dialog-code'))) c.hidden = false;
    stage.replaceChildren();
    const tpl = $('template[data-large]', card);
    if (tpl) {
      stage.appendChild(tpl.content.cloneNode(true));
      for (const el of $$('chartist-chart', stage)) el.setAttribute('theme', currentTheme());
    } else {
      const el = document.createElement('div');
      el.className = 'chart';
      el.dataset.demo = b.dataset.open;
      el.dataset.label = $('[data-demo]', card).dataset.label;
      const bar = $('.demo-bar', card);
      if (bar) stage.appendChild(bar.cloneNode(true));
      stage.appendChild(el);
    }
    openDialog(dialog, b);
    const el = $('[data-demo]', stage);
    if (el) entry = await createNow(el);
  });
  dialog.addEventListener('close', () => {
    if (entry) { for (const c of entry.charts) c.remove(); const i = registry.indexOf(entry); if (i >= 0) registry.splice(i, 1); entry = null; }
    stage.replaceChildren();
  });
}

// ---------- frame meter: times pan and zoom frames on this device ----------
function initMeter() {
  const canvas = $('#meter-canvas');
  const read = $('#meter-read');
  if (!canvas) return;
  const el = $('[data-demo="meter"]');
  const BUDGET = 1000 / 120;
  let running = false;
  async function run() {
    if (running) return;
    const entry = await createNow(el);
    if (!entry) return;
    running = true;
    const chart = entry.charts[0];
    const ts = chart.timeScale();
    const start = ts.getVisibleLogicalRange() || { from: 4800, to: 5000 };
    const samples = [];
    const FRAMES = 120;
    read.textContent = 'Measuring';
    await new Promise((done) => {
      let i = 0;
      const step = () => {
        const span = i < 60 ? 200 : 200 + (i - 60) * 30;          // 60 pan frames, then 60 zoom-out frames
        const to = (i < 60 ? start.to - i * 6 : start.to - 360);
        const t0 = performance.now();
        ts.setVisibleLogicalRange({ from: to - span, to });
        chart.paint();
        samples.push(performance.now() - t0);
        i++;
        draw(samples);
        if (i < FRAMES) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    ts.setVisibleLogicalRange(start);
    const sorted = samples.slice().sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const med = q(0.5); const p95 = q(0.95);
    const pan = samples.slice(0, 60).sort((a, b) => a - b)[30];
    read.innerHTML = `<span>Median <b>${med.toFixed(2)} ms</b></span><span>p95 <b>${p95.toFixed(2)} ms</b></span><span>Pan median <b>${pan.toFixed(2)} ms</b></span><span>${p95 <= BUDGET ? 'Within' : 'Over'} the 8.33 ms budget at p95 on this device</span>`;
    running = false;
  }
  function draw(samples) {
    const css = getComputedStyle(root);
    const ratio = window.devicePixelRatio || 1;
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(BUDGET * 1.5, ...samples);
    const bw = w / 120;
    for (let i = 0; i < samples.length; i++) {
      const bh = Math.max(1, (samples[i] / max) * (h - 4));
      ctx.fillStyle = samples[i] > BUDGET ? css.getPropertyValue('--d2').trim() : css.getPropertyValue('--muted').trim();
      ctx.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1.5), bh);
    }
    const y = Math.round(h - (BUDGET / max) * (h - 4)) + 0.5;
    ctx.strokeStyle = css.getPropertyValue('--pink').trim();
    ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
  }
  const btn = $('#meter-run');
  if (btn) btn.addEventListener('click', run);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); run(); } }, { threshold: 0.4 });
    io.observe(canvas);
  }
}

// ---------- start ----------
function start() {
  const toggle = $('#theme-toggle');
  if (toggle) toggle.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true));
  applyTheme(currentTheme(), false);
  initCopy(); initTabs(); initDialogs(); initSearch(); initChapters(); initApiFilter(); initGallery(); initControls(); initCharts(); initMeter();
}
start();
