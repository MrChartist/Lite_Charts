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
// Light by default; dark when the system asks; a choice made with the toggle is remembered and wins.
const systemDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
const currentTheme = () => (root.dataset.theme === 'light' || root.dataset.theme === 'dark' ? root.dataset.theme : systemDark() ? 'dark' : 'light');
function applyTheme(name, store) {
  if (store) root.dataset.theme = name;
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
      // The terminal bundle registers <chartist-chart> too, without the live connector; with data-manual it registers
      // nothing, so the element-live build keeps the tag on pages that use both. The site registers <chartist-terminal>
      // itself where it needs it.
      if (/chartist-lite\.terminal\./.test(src)) s.setAttribute('data-manual', '');
      s.onload = () => resolve(); s.onerror = () => reject(new Error(`could not load ${src}`));
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}
function chartLibs() {
  const list = [`${ASSETS}chartist-lite.iife.min.js`, `${ASSETS}chartist-lite-indicators.iife.min.js`];
  if (root.hasAttribute('data-drawings')) list.push(`${ASSETS}chartist-lite-drawings.iife.min.js`);
  if (root.hasAttribute('data-live-lib')) list.push(`${ASSETS}chartist-lite-live.iife.min.js`);
  const LIB_FILES = { extras: 'chartist-lite-extras.iife.min.js', transforms: 'chartist-lite-transforms.iife.min.js', widget: 'chartist-lite-widget.iife.min.js' };
  for (const l of (root.dataset.libs || '').split(' ').filter(Boolean)) if (LIB_FILES[l]) list.push(`${ASSETS}${LIB_FILES[l]}`);
  if (root.hasAttribute('data-demos')) list.push(`${ASSETS}demos.js`);
  if (root.dataset.live) list.push(`${ASSETS}${root.dataset.live}`);
  return Promise.all(list.map(loadScript));
}

// The live entry, loaded only when a reader asks for live data (a click), or on a page whose examples use it.
// Loading it makes no request to an exchange; connectLive does, and only the demos' Connect buttons call it.
function liveLib() { return loadScript(`${ASSETS}chartist-lite-live.iife.min.js`).then(() => window.ChartistLiteLive); }
window.__CL_LIVE_LIB = liveLib;
const elementScript = () => `${ASSETS}${root.hasAttribute('data-element-live') ? 'chartist-lite.element-live.iife.min.js' : 'chartist-lite.element.iife.min.js'}`;

// ---------- live charts ----------
function liveApi(el, charts, tools, timers = [], widgets = []) {
  const L = window.ChartistLite;
  const I = window.ChartistLiteIndicators || {};
  const D = window.ChartistLiteDrawings || {};
  const W = window.ChartistLiteWidget || {};
  const bars = makeBars(220, 7);
  const longBars = makeBars(900, 23);
  const out = el.closest('[data-stage]') && el.closest('[data-stage]').querySelector('[data-out]');
  return {
    ...L, ...I, bars, intradayBars: makeIntraday(5, 37), benchmark: makeBenchmark(bars),
    ...(window.ChartistLiteTransforms || {}), ...(window.ChartistLiteExtras || {}), ...(window.ChartistLiteLive || {}),
    heikinAshi: I.heikinAshi,
    TOOLS: D.TOOLS, ALL_TOOLS: D.ALL_TOOLS, BASIC_TOOLS: D.BASIC_TOOLS, drawingsToJSON: D.drawingsToJSON,
    longBars, compareRows: [31, 47, 59, 71].map((seed, k) => makeBars(220, seed, [60, 240, 140, 30][k]).map((b) => ({ time: b.time, value: b.close }))),
    demoBars: W.demoBars, CRYPTO_SYMBOLS: W.CRYPTO_SYMBOLS,
    // A helper of this site: a repeating timer that stops when the example is removed.
    every(ms, fn) { const id = setInterval(() => { try { fn(); } catch (e) { clearInterval(id); } }, ms); timers.push(id); return id; },
    // The widget, in the example's own container and the site theme.
    createWidget(_container, options = {}) {
      const w = W.createWidget(el, { theme: currentTheme(), ...options });
      widgets.push(w); charts.push(w.chart);
      return w;
    },
    createDrawingTools(...args) { const t = D.createDrawingTools(...args); tools.push(t); return t; },
    // A helper of this site: write a line to the example's output panel.
    output(text) { if (!out) return; if (!out.dataset.used) { out.textContent = ''; out.dataset.used = '1'; } out.textContent = `${String(text)}\n${out.textContent}`.slice(0, 4000); },
    // The example's own container is used whatever id the code names, and the site theme is applied.
    createChart(_container, options = {}) {
      // The site theme, except where an example is about themes (data-theme-free) and sets its own.
      const theme = el.hasAttribute('data-theme-free') && options.theme ? options.theme : currentTheme();
      const c = L.createChart(el, { ...options, theme, ariaLabel: options.ariaLabel || el.dataset.label });
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
      const charts = []; const tools = [];
      fn(liveApi(el, charts, tools));
      entry = { charts, tools };
    } else {
      const make = (window.__CL_DEMOS || {})[el.dataset.demo];
      if (!make) return null;
      entry = make(el, window.ChartistLite, currentTheme());
    }
    if (!entry.tools) entry.tools = [];
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
    const load = () => loadScript(elementScript()).catch(() => {});
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
    const btn = e.target.closest('[data-zone], [data-chart-theme], [data-scale], [data-focus-chart], [data-draw]');
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
    else if (btn.dataset.draw && entry.tools[0]) {
      const t = entry.tools[0];
      const out = stage.querySelector('[data-out]');
      const say = (text) => { if (out) out.textContent = text; };
      const act = btn.dataset.draw;
      if (act === 'undo') say(t.undo() ? `Undone. ${t.drawings().length} drawings.` : 'Nothing to undo.');
      else if (act === 'redo') say(t.redo() ? `Redone. ${t.drawings().length} drawings.` : 'Nothing to redo.');
      else if (act === 'clear') { t.clear(); say('Cleared. Undo brings them back.'); }
      else if (act === 'export') { stage._saved = t.exportJSON(); say(JSON.stringify(JSON.parse(stage._saved), null, 1)); }
      else if (act === 'import') { if (!stage._saved) say('Export first, then import that text back.'); else say(`Imported ${t.importJSON(stage._saved)} drawings from the exported text, replacing what was there.`); }
    }
  });
}

// ---------- click-to-connect live demos ----------
// A connect panel holds a card until the reader presses Connect; then the chart is made and connects to the exchange.
// The bar under it shows the state as a dot and a word. When the exchange cannot be reached (status error, or not
// live within 15 s) the chart is removed and the card comes back with one quiet line. Disconnect does the same.
const LIVE_WORDS = { off: 'Off', connecting: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', offline: 'Offline', error: 'Error' };
function showLiveState(box, s, extra) {
  const st = box._bar && $('.live-state', box._bar);
  if (!st) return;
  st.dataset.s = s;
  $('.live-word', st).textContent = `${LIVE_WORDS[s] || s}${extra ? `, ${extra}` : ''}`;
}
function connectParts(box) {
  if (!box._card) {
    box._card = $('.connect-card', box);
    const host = box.closest('[data-stage]') || box.parentElement;
    box._bar = $('.connect-bar', host);
  }
  return box;
}
function stopConnect(box, message) {
  const c = box._conn;
  box._conn = null;
  if (c) {
    clearTimeout(c.timer);
    for (const l of c.lives) { try { l.disconnect(); } catch (e) { /* already closed */ } }
    if (c.observer) c.observer.disconnect();
    if (c.entry) { for (const ch of c.entry.charts) ch.remove(); const i = registry.indexOf(c.entry); if (i >= 0) registry.splice(i, 1); }
    if (c.node) c.node.remove();
  }
  box.classList.remove('is-on');
  if (box.dataset.connect === 'code') { box.replaceChildren(box._card); delete box.dataset.ready; }
  box._card.hidden = false;
  const msg = $('.connect-msg', box._card);
  msg.textContent = message || '';
  msg.hidden = !message;
  if (box._bar) {
    showLiveState(box, 'off');
    $('.live-state', box._bar).hidden = false;
    const stop = $('[data-connect-stop]', box._bar); if (stop) stop.hidden = true;
    const ctl = $('.connect-ctl', box._bar);
    if (ctl) { ctl.hidden = true; for (const g of $$('[role="group"]', ctl)) $$('button', g).forEach((x, i) => x.setAttribute('aria-pressed', String(i === 0))); }
  }
}
const FAIL_TEXT = 'Could not reach the exchange from this browser, so nothing was loaded. You can try again later.';
async function startConnect(box) {
  connectParts(box);
  if (box._conn) return;
  const c = { lives: [], timer: 0, entry: null, node: null, observer: null, live: false };
  box._conn = c;
  const fail = () => { if (box._conn === c) stopConnect(box, FAIL_TEXT); };
  const onState = (s, provider) => {
    if (box._conn !== c) return;
    if (s === 'live') c.live = true;
    showLiveState(box, s, s === 'live' && provider ? provider : '');
    if (s === 'error' && !c.live) fail();
  };
  $('.connect-msg', box._card).hidden = true;
  showLiveState(box, 'connecting');
  c.timer = setTimeout(() => { if (!c.live) fail(); }, 15000);
  try {
    if (box.dataset.connect === 'element') {
      await loadScript(elementScript());
      if (box._conn !== c) return;
      const tpl = $('template[data-connect-tpl]', box);
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.setAttribute('theme', currentTheme());
      node.setAttribute('loading', 'eager');
      c.node = node;
      box._card.hidden = true;
      box.appendChild(node);
      // The element shows its own dot and word on the plot; the bar mirrors it, read from its status line.
      const read = () => { const st = node.shadowRoot && node.shadowRoot.querySelector('.st'); const t = st && !st.hidden ? st.textContent.trim() : ''; if (t) { const [word, ...rest] = t.split(' · '); onState(word.toLowerCase(), rest.join(' · ')); } };
      if (node.shadowRoot) { c.observer = new MutationObserver(read); c.observer.observe(node.shadowRoot, { subtree: true, childList: true, characterData: true, attributes: true }); }
      read();
      c.lives.push({ disconnect() { /* removing the element disconnects it */ } });
    } else {
      await chartLibs();
      const LV = await liveLib();
      const fn = (window.__CL_LIVE || {})[box.dataset.connectLive];
      if (box._conn !== c || !fn || !LV) { if (box._conn === c) fail(); return; }
      box._card.remove();
      const charts = []; const tools = [];
      const api = liveApi(box, charts, tools);
      api.connectLive = (series, options = {}) => {
        const h = LV.connectLive(series, { ...options, onStatus(s, info) { onState(s, info && (info.providerLabel || info.provider)); if (options.onStatus) options.onStatus(s, info); } });
        c.lives.push(h);
        return h;
      };
      fn(api);
      c.entry = { charts, tools, restyle: (t) => charts.forEach((ch) => ch.applyOptions({ theme: t })) };
      registry.push(c.entry);
      box.dataset.ready = '1';
    }
    box.classList.add('is-on');
    if (box._bar) {
      const stop = $('[data-connect-stop]', box._bar); if (stop) stop.hidden = false;
      const ctl = $('.connect-ctl', box._bar); if (ctl) ctl.hidden = false;
    }
  } catch (err) { fail(); }
}
function initConnect() {
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-connect-go]');
    if (go) { const box = go.closest('[data-connect]'); if (box) startConnect(box); return; }
    const stage = e.target.closest('[data-stage]') || document;
    const box = $('[data-connect]', stage) || (e.target.closest('.ex-card') && $('[data-connect]', e.target.closest('.ex-card')));
    if (!box) return;
    const stop = e.target.closest('[data-connect-stop]');
    if (stop) { connectParts(box); stopConnect(box, 'Disconnected. Nothing more is requested.'); return; }
    const iv = e.target.closest('[data-live-interval]');
    const sy = e.target.closest('[data-live-symbol]');
    if ((iv || sy) && box._conn) {
      pressIn(iv || sy, iv ? 'data-live-interval' : 'data-live-symbol');
      for (const l of box._conn.lives) { if (iv) l.setInterval(iv.dataset.liveInterval); else l.setSymbol(sy.dataset.liveSymbol); }
    }
  });
}

// ---------- the hero: the real widget on real crypto ----------
// The terminal bundle (the widget with live data and drawing tools) loads after the page has loaded, behind a static
// poster. It connects to the exchange's public feed (BTC-USD) unless the reader chose demo data (remembered), the
// browser asks to save data, or it is offline; if no exchange answers it shows invented demo data with a quiet line.
const HERO_PREF = 'cl-hero-data';
const HERO_WORDS = { off: 'Demo data', loading: 'Loading', connecting: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', offline: 'Offline', error: 'Error' };
const PROVIDER_NAMES = { coinbase: 'Coinbase', binance: 'Binance', kraken: 'Kraken' };
function heroHold() {
  try { if (localStorage.getItem(HERO_PREF) === 'demo') return 'pref'; } catch (e) { /* storage blocked */ }
  const c = navigator.connection;
  if ((c && c.saveData) || (window.matchMedia && matchMedia('(prefers-reduced-data: reduce)').matches)) return 'save';
  if (navigator.onLine === false) return 'offline';
  return '';
}
function initHero() {
  const box = $('[data-hero-widget]');
  if (!box) return;
  const mount = $('[data-hero-mount]', box);
  const stage = box.closest('[data-stage]');
  const word = $('.live-word', stage); const st = $('.live-state', stage);
  const label = $('[data-hero-source]', stage); const note = $('[data-hero-live-note]', stage); const demoBtn = $('[data-hero-demo]', stage);
  const liveNote = note.textContent;
  const state = { widget: null, mode: '', status: 'loading', provider: '', ready: false };
  const show = (s, message) => {
    state.status = s;
    st.dataset.s = s;
    word.textContent = HERO_WORDS[s] || s;
    const live = state.mode === 'live';
    label.textContent = live ? `Real market data · ${PROVIDER_NAMES[state.provider] || 'Coinbase'}` : 'Invented demo data';
    demoBtn.setAttribute('aria-pressed', String(!live));
    note.textContent = message || (live ? liveNote : 'Invented prices. Switch off "Use demo data" to load real prices from the exchange, straight to your browser.');
  };
  const entry = { charts: [], tools: [], hero: state, restyle(t) { if (state.widget) state.widget.setTheme(t); } };
  box._hero = state;
  registry.push(entry);
  function build(mode, message) {
    const T = window.ChartistLiteTerminal;
    if (state.widget) { try { state.widget.destroy(); } catch (e) { /* gone */ } state.widget = null; }
    state.mode = mode; state.provider = 'coinbase'; state.ready = false;
    const opts = {
      theme: currentTheme(), interval: '1h', indicators: ['ema'], timeZone: 'local',
      load: { extras: () => loadScript(`${ASSETS}chartist-lite-extras.iife.min.js`).then(() => window.ChartistLiteExtras) },
      strings: {},
    };
    if (mode === 'live') Object.assign(opts, { live: { provider: 'coinbase', symbol: 'BTC-USD' }, symbol: 'BTC-USD' });
    else Object.assign(opts, { data: T.demoBars('DEMO', '1h', 600), symbol: { symbol: 'DEMO', description: 'Invented demo data' } });
    const w = T.createWidget(mount, opts);
    state.widget = w;
    entry.charts = [w.chart];
    w.on('ready', () => { state.ready = true; box.classList.add('is-ready'); });
    w.on('theme', (t) => { if (t !== currentTheme() && (t === 'dark' || t === 'light')) applyTheme(t, true); });
    w.on('status', (d) => {
      if (!d || d.alert || state.widget !== w) return;
      if (d.demo) { build('demo', 'No exchange answered from this browser, so this is invented demo data.'); return; }
      if (d.provider) state.provider = d.provider;
      if (d.status) show(d.status);
    });
    show(mode === 'live' ? 'connecting' : 'off', message);
    // The data arrives with the first frame; the poster stays until then.
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('is-ready')));
  }
  demoBtn.addEventListener('click', () => {
    if (!window.ChartistLiteTerminal) return;
    const toDemo = state.mode === 'live';
    try { if (toDemo) localStorage.setItem(HERO_PREF, 'demo'); else localStorage.removeItem(HERO_PREF); } catch (e) { /* storage blocked */ }
    build(toDemo ? 'demo' : 'live');
  });
  const start = () => loadScript(`${ASSETS}chartist-lite.terminal.iife.min.js`).then(() => {
    const hold = heroHold();
    build(hold ? 'demo' : 'live', hold === 'save' ? 'Invented demo data, because your browser asks to save data. Switch off "Use demo data" to load real prices.' : hold === 'offline' ? 'Invented demo data: this browser is offline.' : '');
  }).catch(() => { $('[data-hero-loading]', box).textContent = 'The chart script could not be loaded.'; });
  // After the page itself has loaded, so the poster and the text come first.
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
  window.addEventListener('pagehide', () => { if (state.widget) state.widget.destroy(); });
}

// ---------- the feature gallery: tabs, lazy charts, "Get this code" ----------
// Each card runs the code of its chosen tab (compiled into the page's live script) when it nears the viewport, and
// disposes of everything that code made (charts, widgets, timers, live connections) before running another tab.
function initFeatures() {
  const grid = $('#fx-gallery');
  if (!grid) return;
  const cleanup = (stage) => {
    const c = stage._fx;
    stage._fx = null;
    if (!c) return;
    for (const id of c.timers) clearInterval(id);
    for (const l of c.lives) { try { l.disconnect(); } catch (e) { /* closed */ } }
    for (const w of c.widgets) { try { w.destroy(); } catch (e) { /* gone */ } }
    for (const ch of c.charts) { if (!c.widgets.some((w) => w.chart === ch)) { try { ch.remove(); } catch (e) { /* gone */ } } }
    const i = registry.indexOf(c); if (i >= 0) registry.splice(i, 1);
    stage.textContent = '';
    delete stage.dataset.ready;
  };
  async function run(stage, id, lang) {
    cleanup(stage);
    const token = (stage._token || 0) + 1;
    stage._token = token;
    try {
      if (lang === 'html') {
        const markup = (window.__CL_LIVE_SRC || {})[id] || '';
        if (/<chartist-terminal/.test(markup)) { await loadScript(`${ASSETS}chartist-lite.terminal.iife.min.js`); window.ChartistLiteTerminal.defineTerminalElement(); }
        else await loadScript(elementScript());
        // A tag that reads a file cannot run from file:// (browsers refuse fetch there).
        if (location.protocol === 'file:' && / src="/.test(markup)) { stage.innerHTML = '<p class="chart-fallback">This example reads a JSON file, which browsers do not allow from file://. Serve the folder to see it.</p>'; stage._fx = { charts: [], tools: [], timers: [], lives: [], widgets: [] }; stage.dataset.ready = '1'; return; }
        if (stage._token !== token) return;
        stage.innerHTML = markup;
        for (const t of $$('chartist-chart, chartist-terminal', stage)) t.setAttribute('theme', currentTheme());
        const c = { charts: [], tools: [], timers: [], lives: [], widgets: [], restyle() { /* the tags follow the page */ } };
        stage._fx = c;
        stage.dataset.ready = '1';
        return;
      }
      await chartLibs();
      if (root.hasAttribute('data-live-lib')) await liveLib();
      if (stage._token !== token) return;
      const fn = (window.__CL_LIVE || {})[id];
      if (!fn) return;
      stage.textContent = '';
      const c = { charts: [], tools: [], timers: [], lives: [], widgets: [] };
      const api = liveApi(stage, c.charts, c.tools, c.timers, c.widgets);
      if (window.ChartistLiteLive) api.connectLive = (...a) => { const h = window.ChartistLiteLive.connectLive(...a); c.lives.push(h); return h; };
      fn(api);
      c.restyle = (t) => { if (!stage.hasAttribute('data-theme-free')) c.charts.forEach((ch) => ch.applyOptions({ theme: t })); };
      stage._fx = c;
      stage._demo = c;
      registry.push(c);
      stage.dataset.ready = '1';
      stage.dataset.fxRan = id;
    } catch (err) {
      stage.textContent = 'This example could not run in this browser.';
    }
  }
  const tabOf = (card) => { const b = $('[data-fx-tab][aria-pressed="true"]', card); return b ? Number(b.dataset.fxTab) : 0; };
  const tplOf = (card, k) => $(`template[data-fx-src="${k}"]`, card);
  const start = (card) => { const tpl = tplOf(card, tabOf(card)); run($('[data-fx]', card), tpl.dataset.fxId, tpl.dataset.fxLang); };
  const cards = $$('.fx-card', grid);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); start(e.target.closest('.fx-card')); } }, { rootMargin: '200px' });
    for (const card of cards) io.observe($('[data-fx]', card));
  } else cards.forEach(start);
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fx-tab]');
    const card = e.target.closest('.fx-card');
    if (b && card) { pressIn(b, 'data-fx-tab'); start(card); return; }
    const get = e.target.closest('[data-fx-code]');
    if (get && card) {
      const dialog = $('#code-dialog');
      const k = tabOf(card);
      const tpl = tplOf(card, k);
      $('#code-dialog-title').textContent = `${$('h2', card).textContent}: ${$(`[data-fx-tab="${k}"]`, card).textContent}`;
      $('#code-dialog-code').replaceChildren(tpl.content.cloneNode(true));
      for (const cp of $$('.copy', $('#code-dialog-code'))) cp.hidden = false;
      const guide = $('.fx-actions a', card); const gl = $('#code-dialog-guide');
      gl.href = guide.getAttribute('href'); gl.textContent = guide.textContent;
      dialog.dataset.fxId = tpl.dataset.fxId;
      openDialog(dialog, get);
    }
  });
}

// ---------- the indicator catalogue: filter, category, live preview ----------
function initCatalogue() {
  const box = $('[data-catalogue]');
  if (!box) return;
  const input = $('#cat-filter'); const count = $('#cat-count');
  const rows = $$('tbody tr', box);
  let cat = 'all';
  const apply = () => {
    const q = input.value.trim().toLowerCase();
    let n = 0;
    for (const r of rows) { const on = (cat === 'all' || r.dataset.cat === cat) && (!q || r.dataset.text.includes(q)); r.hidden = !on; if (on) n++; }
    count.textContent = n === rows.length ? '' : n ? `${n} of ${rows.length} indicators` : 'No indicator matches. Try part of a name, such as "average".';
  };
  input.addEventListener('input', apply);
  box.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat-filter]');
    if (c) { cat = c.dataset.catFilter; pressIn(c, 'data-cat-filter'); apply(); return; }
    const b = e.target.closest('[data-preview]');
    if (b) { preview(b.dataset.preview); $('.cat-preview', box).scrollIntoView({ block: 'nearest' }); }
  });
  const el = $('[data-catalogue-chart]', box);
  let entry = null;
  let series = [];
  function preview(id) {
    return chartLibs().then(() => {
      const L = window.ChartistLite; const I = window.ChartistLiteIndicators;
      const spec = I && I.getIndicator && I.getIndicator(id);
      if (!spec) return;
      if (!entry) {
        el.textContent = '';
        const chart = L.createChart(el, { theme: currentTheme(), ariaLabel: el.dataset.label });
        const bars = makeBars(220, 7);
        chart.addSeries(L.CandlestickSeries, { title: 'DEMO' }).setData(bars);
        entry = { charts: [chart], tools: [], chart, bars, id: '' };
        registry.push(entry);
        el._demo = entry;
        el.dataset.ready = '1';
      }
      const { chart, bars } = entry;
      for (const x of series) chart.removeSeries(x);
      series = [];
      const out = spec.compute(bars);
      const pane = spec.overlay ? 0 : 1;
      const accents = currentTheme() === 'dark' ? ['#64B5FF', '#FF9F0A', '#63D5C8', '#FF6961', '#B8C46A'] : ['#0062C4', '#B25000', '#0A6A64', '#C4141D', '#5F6B12'];
      spec.outputs.forEach((o, k) => {
        const color = accents[k % accents.length];
        const s = o.kind === 'histogram'
          ? chart.addSeries(L.HistogramSeries, { title: o.label, priceLineVisible: false, lastValueVisible: false, color }, pane)
          : chart.addSeries(L.LineSeries, { title: spec.outputs.length === 1 ? I.legendLabel(spec) : `${I.legendLabel(spec)} ${o.label}`, lineWidth: o.kind.startsWith('band') ? 1 : 2, color, priceLineVisible: false, lastValueVisible: false }, pane);
        s.setData(out[o.key]);
        series.push(s);
      });
      for (const g of spec.guides || []) if (series[0]) L.createPriceLine(series[0], { price: g, lineStyle: 'dotted', axisLabelVisible: false });
      entry.id = id;
      $('[data-preview-title]', box).textContent = `${spec.name} (${spec.id})`;
      for (const b of $$('[data-preview]', box)) b.setAttribute('aria-pressed', String(b.dataset.preview === id));
    });
  }
  const first = () => preview(rows[0].querySelector('[data-preview]').dataset.preview);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); first(); } }, { rootMargin: '300px' });
    io.observe(el);
  } else first();
  box._preview = preview;
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
  for (const nav of $$('nav.chapters, nav.page-toc')) {
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
  // Groups: each h2 starts one; entries belong to the group above them.
  const groups = [];
  let g = null;
  for (const n of nodes) {
    if (n.tagName === 'H2') { g = { head: [n], rest: [], entries: [] }; groups.push(g); continue; }
    if (!g || n.matches('.api-filter, .doc-head, .chapters, .pager, .onward, .related')) continue;
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
      el.dataset.demo = card.dataset.big || b.dataset.open;
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

// ---------- guide navigation: keep its scroll, current row in view, faded edges ----------
function initGuideNav() {
  for (const sc of $$('[data-nav-scroll]')) {
    const fades = () => {
      sc.classList.toggle('fade-top', sc.scrollTop > 2);
      sc.classList.toggle('fade-bottom', sc.scrollTop + sc.clientHeight < sc.scrollHeight - 2);
    };
    const inDrawer = !!sc.closest('dialog');
    if (!inDrawer) {
      let saved = 0;
      try { saved = Number(sessionStorage.getItem('cl-nav-scroll')) || 0; } catch (e) { saved = 0; }
      if (saved) sc.scrollTop = saved;
      sc._showCurrent = () => {
        const cur = $('[aria-current="page"]', sc);
        if (!cur) return;
        const top = cur.offsetTop - sc.offsetTop; const bottom = top + cur.offsetHeight;
        if (top < sc.scrollTop + 8 || bottom > sc.scrollTop + sc.clientHeight - 8) sc.scrollTop = Math.max(0, top - sc.clientHeight / 2 + cur.offsetHeight / 2);
      };
      sc._showCurrent();
      window.addEventListener('pagehide', () => { try { sessionStorage.setItem('cl-nav-scroll', String(sc.scrollTop)); } catch (e) { /* storage blocked */ } });
    }
    sc.addEventListener('scroll', fades, { passive: true });
    window.addEventListener('resize', fades);
    fades();
  }
  // Near the end of a page the sticky panel would be carried up under the top bar by the end of its column; it
  // shrinks instead (its own scroll keeps working), so it never slides under the bar.
  const side = $('.docs-nav .nav-panel');
  const docs = side && side.closest('.docs');
  if (side && docs) {
    let queued = false;
    const fit = () => {
      queued = false;
      const top = parseFloat(getComputedStyle(side.parentElement).top) || 0;
      const room = Math.min(window.innerHeight - top - 20, docs.getBoundingClientRect().bottom - top - 20);
      side.style.setProperty('--nav-max', `${Math.max(160, Math.floor(room))}px`);
      const sc = $('[data-nav-scroll]', side);
      if (sc) sc.dispatchEvent(new Event('scroll'));
    };
    const ask = () => { if (!queued) { queued = true; requestAnimationFrame(fit); } };
    window.addEventListener('scroll', ask, { passive: true });
    window.addEventListener('resize', ask);
    fit();
    const sc0 = $('[data-nav-scroll]', side);
    if (sc0 && sc0._showCurrent) {
      sc0._showCurrent();
      // Rows change height when the web fonts arrive: check once more then.
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fit(); sc0._showCurrent(); });
      // The font sheet is added by boot.js, so `fonts.ready` can settle before it arrives: check again when the
      // faces finish loading and when the page has loaded.
      if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { fit(); sc0._showCurrent(); });
      window.addEventListener('load', () => { fit(); sc0._showCurrent(); }, { once: true });
    }
  }
  const drawer = $('#drawer');
  for (const b of $$('[data-open-drawer]')) {
    b.addEventListener('click', () => {
      openDialog(drawer, b, $('[data-nav-scroll] [aria-current="page"]', drawer) || $('[data-close]', drawer));
      const sc = $('[data-nav-scroll]', drawer); const cur = sc && $('[aria-current="page"]', sc);
      if (cur) cur.scrollIntoView({ block: 'center' });
      if (sc) sc.dispatchEvent(new Event('scroll'));
    });
  }
}

// ---------- start ----------
function start() {
  const toggle = $('#theme-toggle');
  if (toggle) toggle.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true));
  applyTheme(currentTheme(), false);
  // Follow the system while nothing was chosen.
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!root.dataset.theme) applyTheme(currentTheme(), false); });
  initCopy(); initTabs(); initDialogs(); initGuideNav(); initSearch(); initChapters(); initApiFilter(); initGallery(); initControls(); initConnect(); initCharts(); initMeter(); initHero(); initCatalogue(); initFeatures();
}
start();
