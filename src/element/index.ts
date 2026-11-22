// `<chartist-chart>`: the chart as a custom element, for pages with no build step.
//
//   import { defineChartistElement } from '@mrchartist/chartist-lite/element';
//   defineChartistElement();               // nothing registers until this is called
//
//   <chartist-chart type="candlestick" src="/data/prices.json" height="360"></chartist-chart>
//
// Data: the `.data` property, else the `src` attribute (JSON or CSV), else a child
// `<script type="application/json">` (or `text/csv`). Attributes: type, theme, height, time-zone, volume, attribution,
// src, loading, aria-label. Events: `chartist-ready` (detail.chart), `chartist-error` (detail.message).
// Children of the element other than the data script are a fallback for crawlers and screen readers; they are hidden
// when the chart draws. Importing this module touches no DOM.

import { createChart } from '../index';
import type { ChartApi, SeriesApi } from '../api';
import type { AnySeriesDefinition } from '../api';
import { canonicalRows, parseElementConfig, parseRows, shapeRowsForType, sortRows, volumeRows } from './parse';
import type { ElementConfig, Row } from './parse';
import { resolveSeriesDefinition } from './series-map';
import type { SeriesTypeName } from './series-map';

export type { ElementConfig, Row } from './parse';
export { parseElementConfig, parseRows, canonicalRows, shapeRowsForType, volumeRows, splitCsv, parseTime, DEFAULT_HEIGHT } from './parse';
export type { SeriesTypeName } from './series-map';

export interface ChartistReadyDetail { chart: ChartApi }
export interface ChartistErrorDetail { message: string; error: unknown }

const OBSERVED = ['type', 'theme', 'height', 'time-zone', 'volume', 'attribution', 'src', 'aria-label', 'live', 'symbol', 'interval', 'provider'] as const;

/** The live connector, registered by the element-live build (`auto-live.ts`); absent in the plain element build. */
type LiveConnect = (series: SeriesApi<AnySeriesDefinition>, options: Record<string, unknown>) => {
  disconnect(): void; setInterval(i: string): void; setSymbol(s: string): void; status(): string;
};
let liveConnect: LiveConnect | null = null;
/** Called by the element-live build so `<chartist-chart live>` can stream. */
export function setElementLive(fn: LiveConnect): void { liveConnect = fn; }

const LIVE_TEXT: Record<string, string> = { connecting: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', offline: 'Offline', error: 'Error' };

// The shadow root's rules. Adopted as a constructable stylesheet (CSSOM), so a strict Content-Security-Policy
// (`style-src 'self'`, no 'unsafe-inline') does not block them the way it blocks a <style> element.
const STYLE = `
:host{display:block;position:relative;height:360px;min-width:0;overflow:hidden}
:host([hidden]){display:none}
.wrap{position:absolute;top:0;right:0;bottom:0;left:0}
.frame{position:absolute;top:0;right:0;bottom:0;left:0;visibility:hidden}
.ready .frame{visibility:visible}
.fb{position:absolute;top:0;right:0;bottom:0;left:0;overflow:auto}
.ready .fb{display:none}
.msg{position:absolute;left:8px;right:8px;bottom:6px;font:12px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:.75;pointer-events:none}
.msg[hidden]{display:none}
.st{position:absolute;top:6px;display:flex;align-items:center;gap:6px;padding:2px 8px;border-radius:10px;font:500 12px/16px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;pointer-events:none;z-index:2}
.st[hidden]{display:none}
.dot{width:8px;height:8px;border-radius:4px;flex:none}
`;

const sheets = new WeakMap<object, CSSStyleSheet>();

/** One shared constructable sheet per window, or null where the browser has none (Safari before 16.4). */
function sheetFor(win: (Window & typeof globalThis) | null): CSSStyleSheet | null {
  if (!win || typeof win.CSSStyleSheet !== 'function') return null;
  let sheet = sheets.get(win);
  if (!sheet) {
    try {
      sheet = new win.CSSStyleSheet();
      sheet.replaceSync(STYLE);
    } catch {
      return null;
    }
    sheets.set(win, sheet);
  }
  return sheet;
}

/**
 * Register the custom element. Returns the class, or null where there is no DOM (server rendering). Calling it twice
 * for one tag name returns the first class. Pass another tag name to register under it.
 */
export function defineChartistElement(tagName = 'chartist-chart'): CustomElementConstructor | null {
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return null;
  const existing = customElements.get(tagName);
  if (existing) return existing;

  class ChartistChartElement extends HTMLElement {
    static get observedAttributes(): readonly string[] { return OBSERVED; }

    private wrap!: HTMLDivElement;
    private frame!: HTMLDivElement;
    private msg!: HTMLDivElement;
    private chartApi: ChartApi | null = null;
    private mainSeries: SeriesApi<AnySeriesDefinition> | null = null;
    private liveHandle: ReturnType<LiveConnect> | null = null;
    private statusEl!: HTMLDivElement;
    private volSeries: SeriesApi<AnySeriesDefinition> | null = null;
    private seriesType: SeriesTypeName | null = null;
    private explicit: Row[] | null = null;
    private rows: Row[] = [];
    private io: IntersectionObserver | null = null;
    private abort: AbortController | null = null;
    private token = 0;
    private started = false;
    private waitDoc: (() => void) | null = null;

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      const sheet = sheetFor(this.ownerDocument.defaultView as (Window & typeof globalThis) | null);
      if (sheet && 'adoptedStyleSheets' in root) root.adoptedStyleSheets = [sheet];
      else {
        // Fallback for browsers without constructable sheets; blocked by a strict CSP (documented).
        const style = this.ownerDocument.createElement('style');
        style.textContent = STYLE;
        root.appendChild(style);
      }
      const wrap = this.ownerDocument.createElement('div');
      wrap.className = 'wrap';
      this.wrap = wrap;
      const fb = this.ownerDocument.createElement('div');
      fb.className = 'fb';
      fb.appendChild(this.ownerDocument.createElement('slot'));
      const frame = this.ownerDocument.createElement('div');
      frame.className = 'frame';
      frame.setAttribute('part', 'frame');
      this.frame = frame;
      const msg = this.ownerDocument.createElement('div');
      msg.className = 'msg';
      msg.setAttribute('role', 'status');
      msg.setAttribute('part', 'message');
      msg.hidden = true;
      this.msg = msg;
      // Live status: a dot and a word (never colour alone), top right of the plot.
      const st = this.ownerDocument.createElement('div');
      st.className = 'st';
      st.setAttribute('role', 'status');
      st.setAttribute('part', 'status');
      st.hidden = true;
      this.statusEl = st;
      wrap.append(fb, frame, msg, st);
      root.append(wrap);
      this.syncHeight();
    }

    // ── public surface ──

    /** The underlying chart API, or null until the chart has been created (and after disconnect). */
    get chart(): ChartApi | null { return this.chartApi; }
    /** The main series, or null. */
    get series(): SeriesApi<AnySeriesDefinition> | null { return this.mainSeries; }
    get ready(): boolean { return this.wrap.classList.contains('ready'); }

    /** The rows shown. Setting it takes the place of `src` and the inline script. */
    get data(): readonly Row[] { return this.rows; }
    set data(value: unknown) {
      if (value === null || value === undefined) { this.explicit = null; return; }
      try {
        const rows = sortRows(canonicalRows(value));
        this.explicit = rows;
        this.rows = rows;
        if (this.waitDoc || !this.started) return; // the first load reads `explicit`
        // `.data` wins over a `src` fetch in flight: abort it and make its answer stale.
        this.token++;
        this.abort?.abort();
        this.abort = null;
        this.showRows(rows);
      } catch (e) { this.fail(e); }
    }

    get type(): string { return this.getAttribute('type') ?? 'candlestick'; }
    set type(v: string) { this.setAttribute('type', v); }
    get theme(): string { return this.getAttribute('theme') ?? 'auto'; }
    set theme(v: string) { this.setAttribute('theme', v); }
    get height(): string { return this.getAttribute('height') ?? ''; }
    set height(v: string | number) { this.setAttribute('height', String(v)); }
    get timeZone(): string { return this.getAttribute('time-zone') ?? ''; }
    set timeZone(v: string) { this.setAttribute('time-zone', v); }
    get volume(): boolean { return this.hasAttribute('volume'); }
    set volume(v: boolean) { if (v) this.setAttribute('volume', ''); else this.removeAttribute('volume'); }
    get attribution(): boolean { return this.getAttribute('attribution') !== 'false'; }
    set attribution(v: boolean) { if (v) this.removeAttribute('attribution'); else this.setAttribute('attribution', 'false'); }
    get src(): string { return this.getAttribute('src') ?? ''; }
    set src(v: string) { this.setAttribute('src', v); }

    /** Fetch `src` again (or re-read the inline script) and redraw. */
    reload(): void { if (this.started) void this.load(); }

    // ── lifecycle ──

    connectedCallback(): void {
      // A property set before the element was upgraded sits on the instance and hides the accessor: move it over.
      for (const prop of ['data', 'type', 'theme', 'height', 'timeZone', 'volume', 'attribution', 'src']) {
        if (Object.prototype.hasOwnProperty.call(this, prop)) {
          const v = (this as unknown as Record<string, unknown>)[prop];
          delete (this as unknown as Record<string, unknown>)[prop];
          (this as unknown as Record<string, unknown>)[prop] = v;
        }
      }
      if (this.started || this.io || this.waitDoc) return;
      const IO = (this.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.IntersectionObserver;
      if (IO && this.getAttribute('loading') !== 'eager') {
        this.io = new IO(entries => {
          if (entries.some(e => e.isIntersecting)) { this.io?.disconnect(); this.io = null; this.start(); }
        }, { rootMargin: '200px' });
        this.io.observe(this);
      } else this.start();
    }

    disconnectedCallback(): void { this.teardown(); }

    attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
      if (oldValue === value) return;
      if (name === 'height') { this.syncHeight(); return; }
      if (!this.started) return;
      if (name === 'live') { this.teardown(); this.start(); return; }
      if (this.liveHandle) {
        if (name === 'symbol' && value) { this.liveHandle.setSymbol(value); return; }
        if (name === 'interval' && value) { this.liveHandle.setInterval(value); return; }
        if (name === 'provider' || name === 'type' || name === 'volume') { this.teardown(); this.start(); return; }
      }
      if (name === 'src') { this.explicit = null; void this.load(); return; }
      if (!this.chartApi) return;
      try {
        const { config, issues } = this.config();
        if (issues.length) throw new TypeError(`Chartist Lite: ${issues[0]}`);
        if (name === 'theme') this.chartApi.applyOptions({ theme: config.theme });
        else if (name === 'time-zone') this.chartApi.applyOptions({ timeScale: { timeZone: config.timeZone ?? 'UTC' } });
        else if (name === 'attribution') this.chartApi.applyOptions({ attribution: config.attribution });
        else if (name === 'aria-label') this.chartApi.applyOptions({ ariaLabel: config.ariaLabel ?? 'Price chart' });
        else if (name === 'type' || name === 'volume') this.showRows(this.rows);
      } catch (e) { this.fail(e); }
    }

    // ── internals ──

    private config(): { config: ElementConfig; issues: string[] } {
      return parseElementConfig(n => this.getAttribute(n));
    }

    /** The `height` attribute as a CSSOM write on the host (CSP-safe); without it the sheet's 360px applies. */
    private syncHeight(): void {
      if (!this.hasAttribute('height')) { this.style.removeProperty('height'); return; }
      const { height } = this.config().config;
      this.style.setProperty('height', height);
    }

    private start(): void {
      this.started = true;
      if (this.hasAttribute('live')) { this.startLive(); return; }
      const doc = this.ownerDocument;
      if (doc.readyState === 'loading') {
        // The element can be upgraded before its children are parsed: wait so an inline data script is seen.
        const token = this.token;
        const run = (): void => { this.waitDoc = null; if (token === this.token && this.started) void this.load(); };
        this.waitDoc = (): void => doc.removeEventListener('DOMContentLoaded', run);
        doc.addEventListener('DOMContentLoaded', run, { once: true });
      } else void this.load();
    }

    private teardown(): void {
      this.token++;
      this.started = false;
      this.io?.disconnect();
      this.io = null;
      this.waitDoc?.();
      this.waitDoc = null;
      this.abort?.abort();
      this.abort = null;
      this.liveHandle?.disconnect();
      this.liveHandle = null;
      if (this.statusEl) this.statusEl.hidden = true;
      this.mainSeries = null;
      this.volSeries = null;
      this.seriesType = null;
      this.chartApi?.remove();
      this.chartApi = null;
      this.wrap.classList.remove('ready');
      this.clearMessage();
    }

    private inlineText(): string | null {
      for (const child of Array.from(this.children)) {
        if (child.localName !== 'script') continue;
        const t = (child.getAttribute('type') ?? '').toLowerCase().split(';')[0].trim();
        if (t === 'application/json' || t === 'text/csv') return child.textContent ?? '';
      }
      return null;
    }

    private async load(): Promise<void> {
      const token = ++this.token;
      this.abort?.abort();
      this.abort = null;
      this.clearMessage();
      try {
        let rows: Row[] | null = this.explicit;
        if (!rows) {
          const src = this.getAttribute('src');
          let text: string | null = null;
          if (src) {
            const ac = typeof AbortController === 'undefined' ? null : new AbortController();
            this.abort = ac;
            const res = await fetch(src, { signal: ac?.signal, credentials: 'same-origin' });
            if (!res.ok) throw new Error(`Chartist Lite: could not load ${src} (HTTP ${res.status})`);
            text = await res.text();
            if (token !== this.token) return;
          } else text = this.inlineText();
          rows = text === null ? [] : sortRows(parseRows(text));
        }
        if (token !== this.token) return;
        this.rows = rows;
        this.showRows(rows);
      } catch (e) {
        if (token !== this.token || (e as { name?: string })?.name === 'AbortError') return;
        this.fail(e);
      }
    }

    /** Create the chart when needed, then (re)build the series for the current attributes and show `rows`. */
    private showRows(rows: Row[]): void {
      const { config, issues } = this.config();
      if (issues.length) throw new TypeError(`Chartist Lite: ${issues[0]}`);
      if (!this.chartApi) this.chartApi = this.makeChart(config);
      const chart = this.chartApi as ChartApi;
      if (this.seriesType !== config.type) {
        if (this.mainSeries) chart.removeSeries(this.mainSeries);
        const def = resolveSeriesDefinition(config.type);
        if (!def) throw new Error(`Chartist Lite: type="${config.type}" is not available in this build`);
        this.mainSeries = chart.addSeries(def);
        this.seriesType = config.type;
      }
      (this.mainSeries as SeriesApi<AnySeriesDefinition>).setData(shapeRowsForType(rows, config.type));
      this.syncVolume(chart, config, rows);
      chart.timeScale().fitContent();
      this.clearMessage();
      const firstDraw = !this.ready;
      this.wrap.classList.add('ready');
      if (firstDraw) this.dispatchEvent(new CustomEvent<ChartistReadyDetail>('chartist-ready', { bubbles: true, composed: true, detail: { chart } }));
    }

    /** `live`: history and a stream from a public exchange API, straight from the visitor's browser. */
    private startLive(): void {
      try {
        if (!liveConnect) throw new Error('Chartist Lite: live charts need the element-live build (chartist-lite.element-live.iife.min.js)');
        const { config, issues } = this.config();
        if (issues.length) throw new TypeError(`Chartist Lite: ${issues[0]}`);
        if (!this.chartApi) this.chartApi = this.makeChart(config);
        const chart = this.chartApi;
        const def = resolveSeriesDefinition(config.type);
        if (!def) throw new Error(`Chartist Lite: type="${config.type}" is not available in this build`);
        const symbol = this.getAttribute('symbol') || 'BTC-USD';
        this.mainSeries = chart.addSeries(def, { title: symbol });
        this.seriesType = config.type;
        let volumeSeries: SeriesApi<AnySeriesDefinition> | undefined;
        if (config.volume) {
          const h = resolveSeriesDefinition('histogram');
          if (h) {
            volumeSeries = chart.addSeries(h, { priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false, priceFormat: { precision: 4, minMove: 0.0001 } });
            chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
            chart.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.25 } });
            this.volSeries = volumeSeries;
          }
        }
        const token = this.token;
        this.liveHandle = liveConnect(this.mainSeries, {
          symbol, interval: this.getAttribute('interval') || '1m', provider: this.getAttribute('provider') || 'coinbase',
          volumeSeries, chart,
          onStatus: (s: string) => { if (token === this.token) this.showStatus(s); },
          onError: (e: Error) => { if (token === this.token) this.dispatchEvent(new CustomEvent<ChartistErrorDetail>('chartist-error', { bubbles: true, composed: true, detail: { message: e.message, error: e } })); },
          onBars: (kind: string) => {
            if (token !== this.token || kind !== 'history') return;
            const firstDraw = !this.ready;
            this.wrap.classList.add('ready');
            if (firstDraw) this.dispatchEvent(new CustomEvent<ChartistReadyDetail>('chartist-ready', { bubbles: true, composed: true, detail: { chart } }));
          },
        });
      } catch (e) { this.fail(e); }
    }

    private showStatus(s: string): void {
      const el = this.statusEl;
      const chart = this.chartApi;
      if (!el || !chart) return;
      const c = (chart.options().theme === 'dark' || (chart.options().theme === 'auto' && this.ownerDocument.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches));
      const ink = c ? '#F5F5F7' : '#1D1D1F';
      const dot = s === 'live' ? (c ? '#30D158' : '#1E7E37') : s === 'error' ? (c ? '#FF6961' : '#C8161F') : s === 'reconnecting' || s === 'connecting' ? (c ? '#FF9F0A' : '#C93400') : (c ? '#98989D' : '#6E6E73');
      el.textContent = '';
      const d = this.ownerDocument.createElement('span');
      d.className = 'dot';
      d.style.setProperty('background', dot);
      const t = this.ownerDocument.createElement('span');
      t.textContent = LIVE_TEXT[s] ?? s;
      el.append(d, t);
      el.style.setProperty('color', ink);
      el.style.setProperty('background', c ? 'rgba(20,20,20,0.86)' : 'rgba(255,255,255,0.86)');
      el.style.setProperty('right', `${chart.priceScale().width() + 8}px`);
      el.hidden = false;
    }

    private makeChart(config: ElementConfig): ChartApi {
      const opts: Record<string, unknown> = { theme: config.theme, attribution: config.attribution };
      if (config.timeZone) opts.timeScale = { timeZone: config.timeZone };
      if (config.ariaLabel) opts.ariaLabel = config.ariaLabel;
      return createChart(this.frame, opts);
    }

    private syncVolume(chart: ChartApi, config: ElementConfig, rows: Row[]): void {
      const wanted = config.volume && rows.some(r => r.volume !== undefined);
      const def = wanted ? resolveSeriesDefinition('histogram') : null;
      if (def && !this.volSeries) {
        this.volSeries = chart.addSeries(def, { priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false });
        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      } else if (!def && this.volSeries) {
        chart.removeSeries(this.volSeries);
        this.volSeries = null;
      }
      chart.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: this.volSeries ? 0.25 : 0.1 } });
      this.volSeries?.setData(volumeRows(rows));
    }

    private clearMessage(): void {
      this.msg.hidden = true;
      this.msg.textContent = '';
    }

    private fail(error: unknown): void {
      const message = error instanceof Error ? error.message : String(error);
      this.msg.textContent = message.replace(/^Chartist Lite: /, 'Chart: ');
      this.msg.hidden = false;
      this.dispatchEvent(new CustomEvent<ChartistErrorDetail>('chartist-error', { bubbles: true, composed: true, detail: { message, error } }));
    }
  }

  customElements.define(tagName, ChartistChartElement);
  return ChartistChartElement;
}
