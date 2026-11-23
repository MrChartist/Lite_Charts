// `<chartist-terminal>`: the whole widget as a custom element, for pages with no JavaScript of their own.
//
//   <chartist-terminal live symbol="BTC-USD" interval="1h" indicators="rsi,bb" drawings></chartist-terminal>
//   <chartist-terminal src="/prices.json" symbol="ACME" theme="dark" height="560"></chartist-terminal>
//
// Attributes: symbol, description, interval, intervals (comma list), chart-type, theme, time-zone, live, provider,
// indicators (comma list of catalog ids), drawings (empty, or 'basic' / 'all' for the tool set), src (JSON or CSV rows), height, persist (a storage key), and
// toolbar-off (comma list of parts to hide). A change of any attribute rebuilds the widget, except symbol, interval,
// chart-type and theme, which switch in place. Events: `chartist-ready` (detail.widget, detail.chart),
// `chartist-error` (detail.message). Nothing registers until `defineTerminalElement()` is called; the one-tag build
// (`chartist-lite.terminal.iife.min.js`) calls it on load with live data and drawings bundled and the extras loaded
// on first use from its own folder.

import { parseRows, sortRows } from '../element/parse';
import { createWidget } from './widget';
import type { Widget, WidgetModules, WidgetOptions, ToolbarPart } from './types';

let defaults: WidgetModules = {};
let loadDefaults: NonNullable<WidgetOptions['load']> = {};
/** Modules every terminal element gets (the one-tag build passes live and drawings here). */
export function setTerminalModules(m: WidgetModules): void { defaults = { ...defaults, ...m }; }
/** Loaders every terminal element gets (the one-tag build passes the extras' loader here: loaded on first use). */
export function setTerminalLoad(l: WidgetOptions['load']): void { loadDefaults = { ...loadDefaults, ...(l ?? {}) }; }

const OBSERVED = ['symbol', 'description', 'interval', 'intervals', 'chart-type', 'theme', 'time-zone', 'live', 'provider', 'indicators', 'drawings', 'src', 'height', 'persist', 'toolbar-off'];
const IN_PLACE = new Set(['symbol', 'interval', 'chart-type', 'theme']);

const list = (v: string | null): string[] => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** Widget options from the element's attributes (pure apart from the getter). */
export function terminalOptions(get: (name: string) => string | null, has: (name: string) => boolean): WidgetOptions {
  const o: WidgetOptions = {};
  const sym = get('symbol');
  if (sym) o.symbol = get('description') ? { symbol: sym, description: get('description') as string } : sym;
  if (get('interval')) o.interval = get('interval') as string;
  if (list(get('intervals')).length) o.intervals = list(get('intervals'));
  if (get('chart-type')) o.chartType = get('chart-type') as string;
  const th = get('theme');
  if (th === 'light' || th === 'dark' || th === 'auto') o.theme = th;
  if (get('time-zone')) o.timeZone = get('time-zone') as string;
  if (has('live')) o.live = { symbol: sym ?? 'BTC-USD', ...(get('provider') ? { provider: get('provider') as string } : {}) };
  if (list(get('indicators')).length) o.indicators = list(get('indicators'));
  if (has('drawings')) { const d = get('drawings'); o.drawings = d === 'basic' || d === 'all' ? { open: true, tools: d } : true; }
  const h = Number(get('height'));
  if (get('height') && h > 0) o.height = h;
  if (get('persist')) o.persist = { key: get('persist') as string };
  const off = list(get('toolbar-off'));
  if (off.length) o.toolbar = Object.fromEntries(off.map(p => [p as ToolbarPart, false]));
  return o;
}

export function defineTerminalElement(tagName = 'chartist-terminal'): CustomElementConstructor | null {
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return null;
  const existing = customElements.get(tagName);
  if (existing) return existing;

  class ChartistTerminalElement extends HTMLElement {
    static get observedAttributes(): readonly string[] { return OBSERVED; }
    private w: Widget | null = null;
    private abort: AbortController | null = null;
    private token = 0;
    private rows: unknown[] | null = null;

    get widget(): Widget | null { return this.w; }
    get chart(): Widget['chart'] | null { return this.w ? this.w.chart : null; }
    set data(v: unknown) { this.rows = Array.isArray(v) ? v : null; if (this.isConnected) this.build(); }

    connectedCallback(): void {
      if (!this.style.display) this.style.setProperty('display', 'block');
      this.syncHeight();
      this.build();
    }
    disconnectedCallback(): void { this.teardown(); }
    attributeChangedCallback(name: string, old: string | null, value: string | null): void {
      if (old === value || !this.isConnected) return;
      if (name === 'height') { this.syncHeight(); return; }
      if (this.w && IN_PLACE.has(name) && value) {
        if (name === 'symbol') void this.w.setSymbol(value);
        else if (name === 'interval') void this.w.setInterval(value);
        else if (name === 'chart-type') this.w.setChartType(value);
        else if (name === 'theme' && (value === 'light' || value === 'dark' || value === 'auto')) this.w.setTheme(value);
        return;
      }
      this.build();
    }

    private syncHeight(): void {
      const h = Number(this.getAttribute('height'));
      if (h > 0) this.style.setProperty('height', `${h}px`);
      else if (!this.style.height) this.style.setProperty('height', '560px');
    }

    private teardown(): void {
      this.token++;
      this.abort?.abort();
      this.abort = null;
      this.w?.destroy();
      this.w = null;
    }

    private build(): void {
      this.teardown();
      const token = this.token;
      const opts = terminalOptions(n => this.getAttribute(n), n => this.hasAttribute(n));
      opts.modules = { ...defaults };
      opts.load = { ...loadDefaults };
      const start = (data?: unknown[]): void => {
        if (token !== this.token) return;
        try {
          this.w = createWidget(this, { ...opts, ...(data ? { data: data as never } : {}) });
          this.w.on('ready', () => this.dispatchEvent(new CustomEvent('chartist-ready', { bubbles: true, composed: true, detail: { widget: this.w, chart: this.w?.chart } })));
          this.w.on('error', e => this.dispatchEvent(new CustomEvent('chartist-error', { bubbles: true, composed: true, detail: { message: e instanceof Error ? e.message : String(e), error: e } })));
        } catch (e) {
          this.dispatchEvent(new CustomEvent('chartist-error', { bubbles: true, composed: true, detail: { message: e instanceof Error ? e.message : String(e), error: e } }));
        }
      };
      const src = this.getAttribute('src');
      if (this.rows) start(this.rows);
      else if (src && !opts.live) {
        const ac = typeof AbortController === 'undefined' ? null : new AbortController();
        this.abort = ac;
        fetch(src, { signal: ac?.signal, credentials: 'same-origin' })
          .then(r => { if (!r.ok) throw new Error(`Chartist Lite: could not load ${src} (HTTP ${r.status})`); return r.text(); })
          .then(t => start(sortRows(parseRows(t)) as unknown[]))
          .catch(e => { if ((e as { name?: string })?.name !== 'AbortError') { start([]); this.dispatchEvent(new CustomEvent('chartist-error', { bubbles: true, composed: true, detail: { message: String(e?.message ?? e), error: e } })); } });
      } else start();
    }
  }

  customElements.define(tagName, ChartistTerminalElement);
  return ChartistTerminalElement;
}
