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

const OBSERVED = ['type', 'theme', 'height', 'time-zone', 'volume', 'attribution', 'src', 'aria-label'] as const;

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
`;

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
    private heightStyle!: HTMLStyleElement;
    private chartApi: ChartApi | null = null;
    private mainSeries: SeriesApi<AnySeriesDefinition> | null = null;
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
      const style = this.ownerDocument.createElement('style');
      style.textContent = STYLE;
      this.heightStyle = this.ownerDocument.createElement('style');
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
      wrap.append(fb, frame, msg);
      root.append(style, this.heightStyle, wrap);
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
        if (this.chartApi) this.showRows(rows);
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

    private syncHeight(): void {
      const { height } = this.config().config;
      this.heightStyle.textContent = `:host{height:${height}}`;
    }

    private start(): void {
      this.started = true;
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
        // TODO(volume): needs HistogramSeries from the core; until it exists `volume` is quietly ignored.
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
