// createWidget: a complete chart workspace around one chart (symbol, intervals, chart types, indicators, drawings,
// range keys, go to date, clock, scale keys, screenshot, full screen, settings), all DOM in one shadow root, styled by
// one constructable sheet (CSP-safe). See ARCHITECTURE.md "Widget".
//
// Lazy by design: this module imports the core, the indicator catalog and the chart types. Drawings, live data and
// the extras come in only through `modules` (handed in) or `load` (dynamic importers called the first time a part
// is needed), so a page that never draws never downloads the drawing code.

import { createChart } from '../index';
import type { AnySeriesDefinition, ChartApi, MouseEventParams, SeriesApi } from '../api';
import { formatPrice, MINUS_SIGN } from '../core/format';
import { darkTheme, lightTheme, type ThemeColors } from '../core/theme';
import { localMidnight, parseSpan } from '../core/span';
import { daysFromCivil, isValidTimeZone, localTimeZone, zoneDayNumber, zoneOffsetMs } from '../core/zone';
import { INDICATORS, legendLabel, type IndicatorSpec } from '../indicators/catalog';
import type { ChartPrimitive, PrimitiveDrawScope } from '../plugins/primitive';
import { createPriceLine } from '../plugins/price-line';
import { HistogramSeries } from '../series/histogram';
import { LineSeries } from '../series/line';
import { chartTypeIcon, chartTypeList, resolveChartType, type TransformsLike } from './chart-types';
import { CHART_TYPES, applyChartType } from '../transforms/index';
import { CRYPTO_SYMBOLS, demoBars } from './demo';
import { btn, h, Layers, placePopover } from './dom';
import { svgIcon } from './icons';
import { barsForSpan, intervalForSpan, intervalFromDigits, intervalSeconds, intervalWords, nearestInterval, normalizeInterval, sortIntervals, toLiveInterval } from './intervals';
import { collapseBar, KEEP, useSheets, type BarItem } from './layout';
import { DEFAULT_STRINGS, fill, type WidgetStrings } from './strings';
import { WIDGET_CSS, widgetSheet } from './styles';
import type {
  ChartTypeInfo, IndicatorHandle, IndicatorState, OutputStyle, SymbolInfo, Widget, WidgetBar, WidgetEvent, WidgetModules,
  WidgetOptions, WidgetRowInput, WidgetSettings, WorkspaceJSON,
} from './types';
import { defaultSettings, readWorkspace, validateParams, WORKSPACE_FORMAT, WORKSPACE_VERSION } from './workspace';

type AnySeries = SeriesApi<AnySeriesDefinition>;
type PriceLine = { remove(): void };

export const RANGE_KEYS = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'] as const;
export const DEFAULT_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1D', '1W'];
const LIVE_INTERVALS = ['1m', '5m', '15m', '1h', '6h', '1D'];
const ZONES = ['UTC', 'local', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Zurich', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney'];
const CATEGORIES = ['trend', 'momentum', 'volatility', 'volume', 'other'] as const;
const STORE_PREFIX = 'chartist-lite-workspace:';

/** Accent colours for indicator outputs (no purple): blue, orange, teal, pink-red, olive, slate. */
function accents(dark: boolean): string[] {
  return dark ? ['#0A84FF', '#FF9F0A', '#40C8E0', '#FF6482', '#B8C65A', '#AEAEB2'] : ['#0066CC', '#C24E00', '#0A7E8C', '#C8174B', '#6B7F00', '#636366'];
}

/** A colour with alpha (hex only; anything else unchanged). */
function alpha(c: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return c;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Readable numbers: no grouping, true minus, precision from the size. */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  return formatPrice(v, a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6);
}

/** Read one input row into a bar (null when unusable). Seconds or milliseconds, 'YYYY-MM-DD' or ISO text. */
export function toBar(r: WidgetRowInput | null | undefined): WidgetBar | null {
  if (!r || typeof r !== 'object') return null;
  let t: number;
  if (typeof r.time === 'number') t = r.time > 1e11 ? Math.floor(r.time / 1000) : r.time;
  else if (typeof r.time === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.time);
    t = m ? daysFromCivil(+m[1], +m[2], +m[3]) * 86_400 : Math.floor(Date.parse(r.time) / 1000);
  } else return null;
  if (!Number.isFinite(t)) return null;
  const v = typeof r.value === 'number' ? r.value : NaN;
  const close = typeof r.close === 'number' ? r.close : v;
  if (!Number.isFinite(close)) return null;
  const open = typeof r.open === 'number' && Number.isFinite(r.open) ? r.open : close;
  const high = typeof r.high === 'number' && Number.isFinite(r.high) ? r.high : Math.max(open, close);
  const low = typeof r.low === 'number' && Number.isFinite(r.low) ? r.low : Math.min(open, close);
  const bar: WidgetBar = { time: t, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close };
  if (typeof r.volume === 'number' && Number.isFinite(r.volume)) bar.volume = r.volume;
  return bar;
}

/** Rows into sorted bars, one per time (the later row wins). */
export function toBars(rows: readonly WidgetRowInput[] | null | undefined): WidgetBar[] {
  const out: WidgetBar[] = [];
  for (const r of rows ?? []) { const b = toBar(r); if (b) out.push(b); }
  out.sort((a, b) => a.time - b.time);
  let n = 0;
  for (let i = 0; i < out.length; i++) { if (n > 0 && out[n - 1].time === out[i].time) out[n - 1] = out[i]; else out[n++] = out[i]; }
  out.length = n;
  return out;
}

/** "UTC+5:30" / "UTC−4" for an offset in ms. */
export function offsetLabel(ms: number): string {
  if (ms === 0) return 'UTC';
  const m = Math.round(Math.abs(ms) / 60000);
  return `UTC${ms < 0 ? MINUS_SIGN : '+'}${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''}`;
}

interface Ind {
  uid: string;
  spec: IndicatorSpec;
  params: Record<string, number | string | boolean>;
  visible: boolean;
  placement: 'overlay' | 'pane';
  styles: Record<string, OutputStyle>;
  series: Map<string, AnySeries>;
  guides: PriceLine[];
  band: ChartPrimitive | null;
  last: Record<string, { time: unknown; value?: number }[]>;
  handle: IndicatorHandle;
  row: HTMLElement | null;
  values: Map<string, HTMLElement>;
}

let seq = 0;

type Container = HTMLElement | string;
export function createWidget(container: Container, options: WidgetOptions = {}): Widget {
  const parent = typeof container === 'string' ? (typeof document === 'undefined' ? null : document.getElementById(container)) : container;
  if (!parent || typeof parent.appendChild !== 'function') throw new TypeError('Chartist Lite: createWidget needs a container element (or its id)');
  const doc = parent.ownerDocument;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win) throw new Error('Chartist Lite: the container is not in a window');

  const S: WidgetStrings = { ...DEFAULT_STRINGS, ...(options.strings ?? {}) };
  const catalog: readonly IndicatorSpec[] = options.catalog && options.catalog.length ? options.catalog : INDICATORS;
  const parts = { symbol: true, intervals: true, chartType: true, indicators: true, compare: true, alerts: true, draw: true, undo: true, screenshot: true, fullscreen: true, theme: true, settings: true, ranges: true, goto: true, clock: true, scale: true, status: true, ...(options.toolbar ?? {}) };
  const modules: WidgetModules = { ...(options.modules ?? {}) };
  const liveOpt = options.live ? (options.live === true ? {} : options.live) : null;
  const feed = options.feed ?? null;
  const cleanups: (() => void)[] = [];
  const listen = <T extends EventTarget>(t: T | null | undefined, type: string, fn: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions | boolean): void => {
    if (!t) return;
    t.addEventListener(type, fn, opts);
    cleanups.push(() => t.removeEventListener(type, fn, opts));
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  let destroyed = false;

  // ── state ──
  const defaultIntervals = feed?.intervals?.length ? sortIntervals(feed.intervals) : liveOpt ? LIVE_INTERVALS : sortIntervals(options.intervals ?? DEFAULT_INTERVALS);
  let intervals = defaultIntervals.length ? defaultIntervals : DEFAULT_INTERVALS;
  const symOpt = options.symbol ?? (liveOpt ? liveOpt.symbol ?? 'BTC-USD' : '');
  let symbol: SymbolInfo = typeof symOpt === 'string' ? { symbol: symOpt } : { ...symOpt };
  if (liveOpt && !symbol.description) symbol.description = CRYPTO_SYMBOLS.find(c => c.symbol === symbol.symbol)?.description;
  let interval = normalizeInterval(options.interval ?? '') ?? (liveOpt ? '1h' : feed ? intervals[Math.min(3, intervals.length - 1)] : '1D');
  if (liveOpt || feed) interval = intervals.includes(interval) ? interval : nearestInterval(interval, intervals) ?? intervals[0];
  let chartType = options.chartType ?? 'candles';
  let theme: 'light' | 'dark' | 'auto' = options.theme ?? 'light';
  let tz = options.timeZone && (options.timeZone === 'local' || isValidTimeZone(options.timeZone)) ? options.timeZone : 'UTC';
  let settings: WidgetSettings = { ...defaultSettings(), ...(options.settings ?? {}) };
  let rows: WidgetBar[] = [];
  let compareSyms: { symbol: string; series: AnySeries | null; rows: WidgetBar[] }[] = [];
  let rangeKey: string | null = null;
  let ready = false;
  const inds: Ind[] = [];
  const handlers = new Map<WidgetEvent, Set<(d: unknown) => void>>();
  const emit = (e: WidgetEvent, d?: unknown): void => { for (const f of handlers.get(e) ?? []) { try { f(d); } catch { /* host handler */ } } if (e !== 'change' && e !== 'status' && e !== 'ready' && e !== 'error') { emitChange(); } };

  // ── DOM ──
  const host = h(doc, 'div', '', { 'data-chartist-widget': '' });
  host.style.setProperty('display', 'block', 'important');
  host.style.setProperty('position', 'relative', 'important');
  host.style.setProperty('width', '100%', 'important');
  host.style.setProperty('height', options.height ? `${options.height}px` : '100%', 'important');
  host.style.setProperty('min-height', '0', 'important');
  host.style.setProperty('margin', '0', 'important');
  host.style.setProperty('padding', '0', 'important');
  host.style.setProperty('border', '0', 'important');
  let shadow: ShadowRoot;
  try { shadow = host.attachShadow({ mode: 'open' }); } catch { throw new Error('Chartist Lite: the widget needs Shadow DOM'); }
  const sheet = widgetSheet(win);
  if (sheet && 'adoptedStyleSheets' in shadow) shadow.adoptedStyleSheets = [sheet];
  else { const st = doc.createElement('style'); st.textContent = WIDGET_CSS; shadow.appendChild(st); }

  const w = h(doc, 'div', 'w', { role: 'region', 'aria-label': S.widgetLabel });
  const top = h(doc, 'div', 'bar top', { role: 'toolbar', 'aria-label': S.widgetLabel });
  const stage = h(doc, 'div', 'stage');
  const card = h(doc, 'div', 'card');
  const plot = h(doc, 'div', 'plot');
  const legendLayer = h(doc, 'div', '');
  const bottom = h(doc, 'div', 'bar bot', { role: 'toolbar', 'aria-label': S.ranges });
  const live = h(doc, 'div', 'sr', { 'aria-live': 'polite' });
  card.append(plot, legendLayer);
  stage.append(card);
  w.append(top, stage, bottom, live);
  shadow.appendChild(w);
  parent.appendChild(host);
  if (!options.height && host.clientHeight < 160) host.style.setProperty('height', '560px', 'important');
  const layers = new Layers(w, shadow);
  const coarseQ = win.matchMedia?.('(pointer: coarse)') ?? null;
  const darkQ = win.matchMedia?.('(prefers-color-scheme: dark)') ?? null;

  // ── chart ──
  const zoneName = (): string => (tz === 'local' ? localTimeZone() : tz);
  const chart: ChartApi = createChart(plot, {
    ...(options.chartOptions ?? {}),
    theme,
    attribution: { visible: true, position: 'axis-corner' },
    timeScale: { timeZone: tz },
    ariaLabel: fill(S.chartLabel, symbol.symbol || S.symbol),
    ariaDescription: `${(chart0Desc())} ${S.shortcuts}.`,
  } as never);
  function chart0Desc(): string { return 'Left and right arrows pan, plus and minus zoom, Home and End jump to the first and last bar. Press Enter to inspect bars one at a time; Escape stops.'; }
  let main: AnySeries | null = null;
  let mainData: readonly Record<string, unknown>[] = [];
  let mainKind: 'series' | 'transform' = 'series';
  let volume: AnySeries | null = null;
  type ToolsLike = { destroy(): void; undo(): boolean; redo(): boolean; canUndo(): boolean; canRedo(): boolean; exportJSON(): string; importJSON(j: string): number; on(e: string, f: () => void): () => void; colors(): unknown };
  let tools: ToolsLike | null = null;
  let toolsLoading: Promise<void> | null = null;
  let drawingsJSON: string | null = typeof options.drawings === 'string' ? options.drawings : null;
  let drawingsOn = !!options.drawings;

  const isDark = (): boolean => theme === 'dark' || (theme === 'auto' && !!darkQ?.matches);
  const colors = (): ThemeColors => ({ ...(isDark() ? darkTheme : lightTheme), ...((options.chartOptions as { colors?: Partial<ThemeColors> } | undefined)?.colors ?? {}) });

  // ── modules ──
  async function getModule<K extends keyof WidgetModules>(name: K): Promise<WidgetModules[K] | null> {
    if (modules[name]) return modules[name] as WidgetModules[K];
    const loader = options.load?.[name];
    if (!loader) return null;
    try { const m = await loader(); if (m) modules[name] = m as never; return (m as WidgetModules[K]) ?? null; } catch (e) { emit('error', e); return null; }
  }
  const BUILTIN: TransformsLike = { CHART_TYPES: CHART_TYPES as never, applyChartType };
  const transforms = (): TransformsLike => (modules.transforms as TransformsLike | undefined) ?? BUILTIN;
  const chartTypes = (): readonly ChartTypeInfo[] => chartTypeList(transforms());

  // ── theme ──
  function applyTheme(): void {
    w.classList.toggle('dark', isDark());
    const c = colors();
    w.style.setProperty('--rowbg', alpha(c.background.length === 7 ? c.background : '#FFFFFF', 0.86));
    w.style.setProperty('--card', c.background);
  }
  function applyCoarse(): void { w.classList.toggle('coarse', !!coarseQ?.matches); }
  listen(darkQ, 'change', () => { if (theme === 'auto') { applyTheme(); restyleIndicators(); syncTop(); } });
  listen(coarseQ, 'change', () => { applyCoarse(); relayout(); });

  // ── main series and volume ──
  function buildMain(): void {
    const r = resolveChartType(chartType, rows, transforms());
    if (main) { chart.removeSeries(main); main = null; }
    main = chart.addSeries(r.definition, { title: symbol.symbol, ...(r.options ?? {}) } as never, 0);
    mainKind = r.transformed ? 'transform' : 'series';
    mainData = r.data as readonly Record<string, unknown>[];
    main.setData(r.data as never);
    syncVolume();
  }
  function syncVolume(): void {
    // A transform (bricks, lines) has its own times: its rows carry their summed volume, or no volume is shown.
    const src = (mainKind === 'series' ? rows : mainData) as readonly { time: unknown; volume?: unknown }[];
    const want = settings.volume && src.some(b => typeof b.volume === 'number');
    if (want && !volume) {
      volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false, priceFormat: { precision: 0, minMove: 1 } } as never, 0);
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    } else if (!want && volume) { chart.removeSeries(volume); volume = null; }
    chart.priceScale('right', 0).applyOptions({ scaleMargins: { top: 0.1, bottom: volume ? 0.22 : 0.1 } });
    volume?.setData(src.map(b => ({ time: b.time, value: typeof b.volume === 'number' ? b.volume : 0 })) as never);
  }

  /** New history: everything is recomputed. */
  function setRows(next: WidgetBar[], keepView = false): void {
    const prevCount = rows.length;
    rows = next;
    buildMain();
    for (const ind of inds) computeIndicator(ind);
    paintLegend(null);
    if (!rows.length) showOverlay('empty');
    else showOverlay(null);
    if (!keepView || !prevCount) {
      if (rangeKey && rangeKey !== 'All') { try { chart.timeScale().setVisibleSpan(rangeKey); } catch { chart.timeScale().resetTimeScale(); } }
      else if (rangeKey === 'All') chart.timeScale().fitContent();
      else chart.timeScale().resetTimeScale();
    }
    if (!ready && rows.length) { ready = true; emit('ready', { chart }); }
  }

  /** One live bar (same time replaces the last, newer appends): O(1) for a plain series, indicators once per frame. */
  function updateRow(b: WidgetBar): void {
    if (!rows.length) { setRows([b]); return; }
    const last = rows[rows.length - 1];
    if (b.time < last.time) return;
    if (b.time === last.time) rows[rows.length - 1] = { ...b, volume: b.volume ?? last.volume }; else rows.push(b);
    if (mainKind === 'series' && main) {
      const r = resolveChartType(chartType, [rows[rows.length - 1]], transforms());
      const d = r.data[0] as Record<string, unknown>;
      try { main.update(d as never); } catch { buildMain(); }
      if (volume) volume.update({ time: b.time, value: rows[rows.length - 1].volume ?? 0 } as never);
    }
    scheduleRecompute();
  }
  let recomputeId = 0;
  let lastRecompute = 0;
  function scheduleRecompute(): void {
    if (recomputeId) return;
    const wait = Math.max(0, 250 - (Date.now() - lastRecompute));
    recomputeId = later(() => {
      recomputeId = 0;
      lastRecompute = Date.now();
      if (destroyed) return;
      if (mainKind === 'transform') buildMain();
      for (const ind of inds) computeIndicator(ind);
      paintLegend(lastCross);
    }, wait) as unknown as number;
  }

  // ── indicators ──
  function placeIndex(ind: Ind): number {
    if (ind.placement === 'overlay') return 0;
    // Own panes follow the order of the indicators that have one.
    let pane = 1;
    for (const o of inds) { if (o === ind) return pane; if (o.placement === 'pane') pane++; }
    return pane;
  }
  function defaultStyles(spec: IndicatorSpec, used: number): Record<string, OutputStyle> {
    const c = colors();
    const acc = accents(isDark());
    const out: Record<string, OutputStyle> = {};
    let k = used;
    spec.outputs.forEach(o => {
      const tone = o.tone ?? 'line';
      const color = tone === 'up' ? c.up : tone === 'down' ? c.down : tone === 'muted' ? (isDark() ? '#8E8E93' : '#8A8A8E') : typeof tone === 'number' ? acc[(used + tone) % acc.length] : acc[k++ % acc.length];
      out[o.key] = { color, width: o.kind === 'line' ? 2 : 1, visible: true };
    });
    return out;
  }

  /** A shaded band between an upper and a lower output (Bollinger, Keltner): one main-layer primitive. */
  function bandPrimitive(ind: Ind, up: string, lo: string): ChartPrimitive {
    const p: ChartPrimitive = {
      zOrder: 'bottom',
      draw(scope: PrimitiveDrawScope) {
        const a = ind.last[up], b = ind.last[lo];
        if (!ind.visible || !a || !b || !a.length) return;
        const st = ind.styles[up];
        if (st && !st.visible) return;
        const vr = scope.visibleLogicalRange;
        if (!vr) return;
        const n = Math.min(a.length, b.length, rows.length);
        const from = Math.max(0, Math.floor(vr.from) - 1), to = Math.min(n - 1, Math.ceil(vr.to) + 1);
        const ctx = scope.ctx;
        const xs: number[] = [], yu: number[] = [], yl: number[] = [];
        for (let i = from; i <= to; i++) {
          const u = a[i]?.value, l = b[i]?.value;
          if (typeof u !== 'number' || typeof l !== 'number') continue;
          const x = scope.logicalToX(i), y1 = scope.priceToY(u), y2 = scope.priceToY(l);
          if (y1 === null || y2 === null) continue;
          xs.push(x); yu.push(y1); yl.push(y2);
        }
        if (xs.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(xs[0], yu[0]);
        for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], yu[i]);
        for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(xs[i], yl[i]);
        ctx.closePath();
        ctx.fillStyle = alpha(st?.color && st.color.startsWith('#') ? st.color : colors().line, isDark() ? 0.09 : 0.07);
        ctx.fill();
      },
    };
    return p;
  }

  function teardownIndicator(ind: Ind): void {
    for (const g of ind.guides) { try { g.remove(); } catch { /* gone with its series */ } }
    ind.guides = [];
    if (ind.band && main) { try { main.detachPrimitive(ind.band); } catch { /* main was rebuilt */ } }
    ind.band = null;
    for (const s of ind.series.values()) { try { chart.removeSeries(s); } catch { /* already removed */ } }
    ind.series.clear();
  }

  function buildIndicator(ind: Ind): void {
    teardownIndicator(ind);
    const pane = placeIndex(ind);
    const own = ind.placement === 'pane';
    const scaleId = !own && !ind.spec.overlay ? `ind-${ind.uid}` : 'right';
    for (const o of ind.spec.outputs) {
      const st = ind.styles[o.key];
      const common = { priceScaleId: scaleId, priceLineVisible: false, lastValueVisible: o.kind === 'line' && st.visible && ind.visible && own, visible: st.visible && ind.visible, title: '' };
      const s = o.kind === 'histogram'
        ? chart.addSeries(HistogramSeries, { ...common, color: st.color } as never, pane)
        : chart.addSeries(LineSeries, { ...common, color: st.color, lineWidth: st.width, lineStyle: o.kind === 'markers' ? 'dotted' : o.kind === 'line' ? 'solid' : 'solid', crosshairMarkerVisible: o.kind === 'line' } as never, pane);
      ind.series.set(o.key, s);
    }
    if (scaleId !== 'right') chart.priceScale(scaleId, pane).applyOptions({ scaleMargins: { top: 0.7, bottom: 0.02 } });
    const first = ind.series.get(ind.spec.outputs[0]?.key ?? '');
    if (first && own && ind.spec.guides) {
      for (const g of ind.spec.guides) ind.guides.push(createPriceLine(first, { price: g, lineStyle: 'dotted', axisLabelVisible: false, color: colors().mutedText } as never));
    }
    const up = ind.spec.outputs.find(o => o.kind === 'band-upper'), lo = ind.spec.outputs.find(o => o.kind === 'band-lower');
    if (up && lo && main && !own) { ind.band = bandPrimitive(ind, up.key, lo.key); main.attachPrimitive(ind.band); }
    computeIndicator(ind);
  }

  function computeIndicator(ind: Ind): void {
    let res: Record<string, { time: unknown; value?: number }[]> = {};
    try { res = ind.spec.compute(rows as never, ind.params) as never; } catch { res = {}; }
    ind.last = res;
    const c = colors();
    for (const o of ind.spec.outputs) {
      const s = ind.series.get(o.key);
      if (!s) continue;
      const arr = res[o.key] ?? [];
      if (o.kind === 'histogram') {
        const st = ind.styles[o.key];
        const signed = st.color === c.up || st.color === c.down;
        s.setData(arr.map(p => (typeof p.value === 'number' && Number.isFinite(p.value)
          ? { time: p.time, value: p.value, color: signed ? alpha(p.value >= 0 ? c.up : c.down, 0.6) : alpha(st.color, 0.75) }
          : { time: p.time })) as never);
      } else s.setData(arr.map(p => (typeof p.value === 'number' && Number.isFinite(p.value) ? { time: p.time, value: p.value } : { time: p.time })) as never);
    }
  }

  function rebuildIndicators(): void {
    // Remove all, then add in order (pane indices follow the list).
    for (const ind of inds) teardownIndicator(ind);
    for (const ind of inds) buildIndicator(ind);
    applyPaneStretch();
    renderLegend();
  }

  function restyleIndicators(): void {
    rebuildIndicators();
  }

  function makeHandle(ind: Ind): IndicatorHandle {
    return {
      get uid() { return ind.uid; },
      get id() { return ind.spec.id; },
      get name() { return legendLabel(ind.spec, ind.params); },
      params: () => ({ ...ind.params }),
      setParams(p) { record(() => { ind.params = validateParams(ind.spec, { ...ind.params, ...p }).params; computeIndicator(ind); renderLegend(); }); emit('indicators', api.indicators()); },
      setVisible(v) { record(() => { ind.visible = !!v; buildIndicator(ind); renderLegend(); }); emit('indicators', api.indicators()); },
      visible: () => ind.visible,
      setPlacement(pl) { if (pl !== ind.placement) { record(() => { ind.placement = pl; rebuildIndicators(); }); emit('indicators', api.indicators()); } },
      placement: () => ind.placement,
      setOutputStyle(key, st) { const cur = ind.styles[key]; if (!cur) return; record(() => { ind.styles[key] = { ...cur, ...st }; buildIndicator(ind); renderLegend(); }); emit('indicators', api.indicators()); },
      remove() { api.removeIndicator(ind.uid); },
    };
  }

  function addIndicatorRaw(spec: IndicatorSpec, state: Partial<IndicatorState>): Ind {
    const used = inds.reduce((a, b) => a + b.spec.outputs.filter(o => typeof o.tone !== 'string' || o.tone === 'line').length, 0);
    const base = defaultStyles(spec, used);
    const styles: Record<string, OutputStyle> = {};
    for (const o of spec.outputs) styles[o.key] = { ...base[o.key], ...(state.styles?.[o.key] ?? {}) };
    const ind: Ind = {
      uid: `i${++seq}`, spec, params: validateParams(spec, state.params ?? {}).params, visible: state.visible !== false,
      placement: state.placement ?? (spec.overlay ? 'overlay' : 'pane'), styles, series: new Map(), guides: [], band: null, last: {},
      handle: null as unknown as IndicatorHandle, row: null, values: new Map(),
    };
    ind.handle = makeHandle(ind);
    inds.push(ind);
    return ind;
  }

  const indState = (ind: Ind): IndicatorState => ({ id: ind.spec.id, params: { ...ind.params }, visible: ind.visible, placement: ind.placement, styles: JSON.parse(JSON.stringify(ind.styles)) });

  // ── panes ──
  let maximised = -1;
  function applyPaneStretch(): void {
    const panes = chart.panes();
    panes.forEach((p, i) => {
      if (maximised >= 0) p.setStretchFactor(i === maximised ? 100 : 0.0001);
      else p.setStretchFactor(i === 0 ? 3 : 1);
    });
  }
  function indsInPane(pane: number): Ind[] { return inds.filter(i => placeIndex(i) === pane && (pane > 0 ? i.placement === 'pane' : i.placement === 'overlay')); }
  function movePane(pane: number, dir: -1 | 1): void {
    const ownList = inds.filter(i => i.placement === 'pane');
    const a = pane - 1, b = a + dir;
    if (a < 0 || b < 0 || b >= ownList.length) return;
    record(() => {
      const ia = inds.indexOf(ownList[a]), ib = inds.indexOf(ownList[b]);
      [inds[ia], inds[ib]] = [inds[ib], inds[ia]];
      maximised = -1;
      rebuildIndicators();
    });
    emit('indicators', api.indicators());
  }

  // ── legend rows (indicators and compare symbols): DOM over the card, values written only when they change ──
  let lastCross: MouseEventParams | null = null;
  let legendKey = '';
  const rowTop0 = (): number => 6 + Math.round(chart.options().fontSize * 1.5) + 4 + 4;
  function paneTops(): number[] {
    const tops: number[] = [];
    let y = 0;
    for (const p of chart.panes()) { tops.push(y); y += p.getHeight() + 1; }
    return tops;
  }
  function renderLegend(): void {
    legendLayer.textContent = '';
    legendKey = '';
    const groups = new Map<number, HTMLElement>();
    const groupFor = (pane: number): HTMLElement => {
      let g = groups.get(pane);
      if (!g) { g = h(doc, 'div', 'lg', { role: 'group', 'aria-label': pane === 0 ? S.indicators : `${S.indicators} ${pane + 1}` }); g.dataset.pane = String(pane); groups.set(pane, g); legendLayer.appendChild(g); }
      return g;
    };
    const ownCount = inds.filter(i => i.placement === 'pane').length;
    for (const ind of inds) {
      const pane = placeIndex(ind);
      const row = h(doc, 'div', `row${ind.visible ? '' : ' off'}`, { tabindex: '0', 'aria-label': legendLabel(ind.spec, ind.params) });
      const first = ind.spec.outputs[0];
      row.append(h(doc, 'span', 'sw2', {}, []));
      (row.lastChild as HTMLElement).style.setProperty('background', ind.styles[first?.key ?? '']?.color ?? colors().line);
      row.append(h(doc, 'span', 'nm', {}, [legendLabel(ind.spec, ind.params)]));
      ind.values.clear();
      for (const o of ind.spec.outputs) {
        if (o.kind === 'band-lower' || !ind.styles[o.key].visible) continue;
        const v = h(doc, 'span', 'v');
        v.style.setProperty('color', ind.styles[o.key].color);
        ind.values.set(o.key, v);
        row.append(v);
      }
      const acts = h(doc, 'span', 'acts');
      acts.append(
        btn(doc, { icon: ind.visible ? 'eye' : 'eyeOff', label: ind.visible ? S.hide : S.show, iconPx: 16, onClick: () => ind.handle.setVisible(!ind.visible) }),
        btn(doc, { icon: 'gear', label: fill(S.settingsOf, ind.spec.shortName), iconPx: 16, onClick: ev => openIndicatorSettings(ind, ev.currentTarget as HTMLElement) }),
        btn(doc, { icon: 'close', label: S.remove, iconPx: 16, onClick: () => ind.handle.remove() }),
      );
      const isFirstInPane = pane > 0 && !Array.from(groupFor(pane).children).length;
      if (isFirstInPane) {
        const idx = pane - 1;
        acts.append(
          btn(doc, { icon: 'up', label: S.moveUp, iconPx: 16, attrs: { disabled: idx === 0 }, onClick: () => movePane(pane, -1) }),
          btn(doc, { icon: 'down', label: S.moveDown, iconPx: 16, attrs: { disabled: idx >= ownCount - 1 }, onClick: () => movePane(pane, 1) }),
          btn(doc, { icon: 'maximise', label: maximised === pane ? S.restore : S.maximise, iconPx: 16, onClick: () => { maximised = maximised === pane ? -1 : pane; applyPaneStretch(); renderLegend(); } }),
          btn(doc, { icon: 'trash', label: S.closePane, iconPx: 16, onClick: () => { record(() => { for (const i of indsInPane(pane)) { teardownIndicator(i); inds.splice(inds.indexOf(i), 1); } maximised = -1; rebuildIndicators(); }); emit('indicators', api.indicators()); } }),
        );
      }
      row.append(acts);
      // Touch: a tap shows the actions (hover does on a mouse).
      row.addEventListener('pointerdown', ev => { if (ev.pointerType !== 'mouse') { for (const r of Array.from(legendLayer.querySelectorAll('.row.tap'))) if (r !== row) r.classList.remove('tap'); row.classList.toggle('tap'); } });
      row.addEventListener('keydown', ev => { if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); ind.handle.remove(); } else if (ev.key === 'Enter' && ev.target === row) { ev.preventDefault(); openIndicatorSettings(ind, row); } });
      ind.row = row;
      groupFor(pane).appendChild(row);
    }
    for (const c of compareSyms) {
      const row = h(doc, 'div', 'row', { tabindex: '0', 'aria-label': c.symbol });
      const color = (c.series?.options() as { color?: string } | undefined)?.color ?? colors().line;
      const dot = h(doc, 'span', 'sw2');
      dot.style.setProperty('background', color);
      row.append(dot, h(doc, 'span', 'nm', {}, [c.symbol]));
      const acts = h(doc, 'span', 'acts');
      acts.append(btn(doc, { icon: 'close', label: S.remove, iconPx: 16, onClick: () => removeCompare(c.symbol) }));
      row.append(acts);
      groupFor(0).appendChild(row);
    }
    placeLegend(true);
    paintLegend(lastCross);
  }
  function placeLegend(force = false): void {
    const tops = paneTops();
    const left = chart.priceScale('left').width() + 6 + (tools && drawingsOn ? 48 : 0);
    const key = `${tops.join(',')}|${left}`;
    if (!force && key === legendKey) return;
    legendKey = key;
    for (const g of Array.from(legendLayer.children) as HTMLElement[]) {
      const pane = Number(g.dataset.pane);
      g.style.setProperty('left', `${pane === 0 ? left : chart.priceScale('left').width() + 6}px`);
      g.style.setProperty('top', `${(tops[pane] ?? 0) + (pane === 0 ? rowTop0() : 6)}px`);
      g.classList.toggle('hide', tops[pane] === undefined || (chart.panes()[pane]?.getHeight() ?? 0) < 40);
    }
  }
  /** Values of the hovered bar (or the last), written only when the text changes. */
  function paintLegend(p: MouseEventParams | null): void {
    lastCross = p;
    for (const ind of inds) {
      for (const [key, el] of ind.values) {
        const s = ind.series.get(key);
        let v: number | undefined;
        if (p && p.time !== undefined && s) v = (p.seriesData.get(s) as { value?: number } | undefined)?.value;
        else { const arr = ind.last[key]; for (let i = (arr?.length ?? 0) - 1; i >= 0 && i >= arr.length - 3; i--) if (typeof arr[i].value === 'number') { v = arr[i].value; break; } }
        const t = v === undefined ? '' : formatValue(v);
        if (el.textContent !== t) el.textContent = t;
      }
    }
  }
  const onCross = (p: MouseEventParams): void => paintLegend(p.time !== undefined ? p : null);
  chart.subscribeCrosshairMove(onCross);

  // A primitive on the top pane whose draw runs once per main frame: it notices pane height changes (a separator drag,
  // a resize) and re-places the legend groups in the next frame. No DOM is read or written while nothing moved.
  let placeQueued = false;
  const watcher: ChartPrimitive = {
    draw() {
      if (placeQueued) return;
      const tops = paneTops();
      const left = chart.priceScale('left').width() + 6 + (tools && drawingsOn ? 48 : 0);
      if (`${tops.join(',')}|${left}` === legendKey) return;
      placeQueued = true;
      win.requestAnimationFrame(() => { placeQueued = false; if (!destroyed) placeLegend(); });
    },
  };
  chart.attachPrimitive(watcher);

  // Session breaks: a dotted vertical line where the local day changes (intraday only), visible bars only.
  const breaks: ChartPrimitive = {
    zOrder: 'bottom',
    draw(scope: PrimitiveDrawScope) {
      if (!settings.sessionBreaks || rows.length < 2 || intervalSeconds(interval) >= 86_400) return;
      const vr = scope.visibleLogicalRange;
      if (!vr) return;
      const zone = zoneName();
      const from = Math.max(1, Math.floor(vr.from)), to = Math.min(rows.length - 1, Math.ceil(vr.to));
      const ctx = scope.ctx;
      ctx.save();
      ctx.strokeStyle = colors().paneSeparator;
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      let prev = zoneDayNumber(zone, rows[from - 1].time * 1000);
      for (let i = from; i <= to; i++) {
        const d = zoneDayNumber(zone, rows[i].time * 1000);
        if (d !== prev) { const x = scope.logicalToX(i - 0.5); { const xx = Math.round(x) + 0.5; ctx.moveTo(xx, scope.pane.y); ctx.lineTo(xx, scope.pane.y + scope.pane.height); } }
        prev = d;
      }
      ctx.stroke();
      ctx.restore();
    },
  };
  chart.attachPrimitive(breaks);

  // ── overlays (loading, empty, error) ──
  let overlay: HTMLElement | null = null;
  function showOverlay(kind: 'loading' | 'empty' | 'error' | null, detail = ''): void {
    overlay?.remove();
    overlay = null;
    if (!kind) return;
    const name = symbol.symbol || S.symbol;
    const ov = h(doc, 'div', 'ov', { role: kind === 'error' ? 'alert' : 'status' });
    if (kind === 'loading') {
      const sk = h(doc, 'div', 'skel', { 'aria-hidden': 'true' });
      const hs = [38, 52, 44, 61, 57, 70, 64, 58, 73, 80, 69, 77, 86, 79, 72, 84, 91, 83];
      for (const v of hs) { const i = h(doc, 'i'); i.style.setProperty('height', `${v}%`); sk.append(i); }
      ov.append(sk, h(doc, 'div', 'sub', {}, [fill(S.loading, name)]));
      ov.style.setProperty('justify-content', 'flex-end');
      ov.style.setProperty('padding-bottom', '28px');
    } else {
      ov.append(h(doc, 'div', 'msg', {}, [fill(kind === 'empty' ? S.empty : S.error, name)]));
      if (detail) ov.append(h(doc, 'div', 'sub', {}, [detail.replace(/^Chartist Lite: /, '')]));
      ov.append(btn(doc, { text: S.retry, label: S.retry, cls: 'pri', onClick: () => void loadData() }));
    }
    card.appendChild(ov);
    overlay = ov;
  }

  // ── data: static rows, a feed, or live crypto ──
  let liveHandle: { disconnect(): void; setInterval(i: string): void; setSymbol(s: string): void; loadOlder(): Promise<number>; status(): string; provider(): string | null } | null = null;
  let feedUnsub: (() => void) | null = null;
  let loadToken = 0;
  let demo = false;

  async function loadData(limitOverride?: number): Promise<void> {
    const token = ++loadToken;
    feedUnsub?.(); feedUnsub = null;
    if (liveOpt) { await startLive(); return; }
    if (feed) {
      showOverlay('loading');
      try {
        const last = rows.length ? rows[rows.length - 1].time : Math.floor(Date.now() / 1000);
        const limit = limitOverride ?? (rangeKey ? barsForSpan(rangeKey, interval, last) : 600);
        const got = await feed.getBars({ symbol: symbol.symbol, interval, limit });
        if (token !== loadToken || destroyed) return;
        setRows(toBars(got));
        if (feed.subscribeBars) {
          const unsub = feed.subscribeBars({ symbol: symbol.symbol, interval }, bar => { if (token === loadToken && !destroyed) { const b = toBar(bar); if (b) updateRow(b); } });
          feedUnsub = typeof unsub === 'function' ? unsub : null;
          setStatus('live');
        }
        for (const c of compareSyms) void loadCompare(c);
      } catch (e) {
        if (token !== loadToken || destroyed) return;
        showOverlay('error', e instanceof Error ? e.message : String(e));
        emit('error', e);
      }
      return;
    }
    setRows(toBars(options.data ?? []));
  }

  function setStatus(s: string, provider?: string | null): void {
    const el = statusEl;
    if (!el) return;
    el.dataset.s = s;
    const word = demo ? S.demoData : ({ connecting: S.statusConnecting, live: S.statusLive, reconnecting: S.statusReconnecting, offline: S.statusOffline, error: S.statusError } as Record<string, string>)[s] ?? s;
    const prov = provider ? ` · ${provider[0].toUpperCase()}${provider.slice(1)}` : '';
    el.lastChild!.textContent = `${word}${demo ? '' : prov}`;
    el.classList.toggle('hide', !parts.status);
    emit('status', { status: s, provider, demo });
  }

  async function startLive(): Promise<void> {
    liveHandle?.disconnect();
    liveHandle = null;
    demo = false;
    showOverlay('loading');
    setStatus('connecting');
    const mod = await getModule('live') as { connectLive?: (...a: unknown[]) => unknown } | null;
    if (destroyed) return;
    if (!mod || typeof mod.connectLive !== 'function') { fallbackDemo(); return; }
    const token = loadToken;
    const sink = {
      seriesType: () => 'candlestick',
      setData(list: readonly WidgetRowInput[]) { if (token === loadToken) setRows(toBars(list), rows.length > 0); },
      update(row: WidgetRowInput) { if (token === loadToken) { const b = toBar(row); if (b) updateRow(b); } },
      data: () => rows,
      applyOptions() { /* not used */ },
    };
    const volSink = {
      seriesType: () => 'histogram',
      setData(list: readonly { time: number; value: number }[]) {
        if (token !== loadToken) return;
        const m = new Map(list.map(v => [v.time, v.value]));
        for (const b of rows) { const v = m.get(b.time); if (v !== undefined) b.volume = v; }
        syncVolume();
      },
      update(v: { time: number; value: number }) {
        if (token !== loadToken || !rows.length) return;
        const last = rows[rows.length - 1];
        if (last.time === v.time) { last.volume = v.value; volume?.update(v as never); }
      },
      data: () => [],
    };
    let failedOnce = false;
    liveHandle = mod.connectLive(sink, {
      symbol: symbol.symbol, interval: toLiveInterval(interval), provider: liveOpt?.provider ?? 'coinbase', volumeSeries: volSink, chart, history: 720,
      onStatus: (s: string, info: { provider: string | null }) => {
        if (token !== loadToken) return;
        setStatus(s, info?.provider);
        if (s === 'error' && !rows.length) { failedOnce = true; fallbackDemo(); }
      },
      onError: (e: unknown) => { if (token === loadToken) emit('error', e); },
    }) as typeof liveHandle;
    // Every provider failing shows as 'error' with no bars: demo data then, said in the status.
    later(() => { if (token === loadToken && !rows.length && !failedOnce && !destroyed && (liveHandle?.status() === 'error' || liveHandle?.status() === 'connecting')) fallbackDemo(); }, 12000);
  }
  function fallbackDemo(): void {
    liveHandle?.disconnect();
    liveHandle = null;
    demo = true;
    setRows(demoBars(symbol.symbol, interval, 600));
    setStatus('offline');
  }

  async function loadCompare(c: { symbol: string; series: AnySeries | null; rows: WidgetBar[] }): Promise<void> {
    try {
      let got: WidgetBar[] = [];
      if (feed) got = toBars(await feed.getBars({ symbol: c.symbol, interval, limit: Math.max(rows.length, 300) }));
      else got = demoBars(c.symbol, interval, Math.max(rows.length, 300), rows.length ? rows[rows.length - 1].time : undefined);
      if (destroyed || !compareSyms.includes(c)) return;
      c.rows = got;
      c.series?.setData(got.map(b => ({ time: b.time, value: b.close })) as never);
    } catch (e) { emit('error', e); }
  }
  function addCompare(sym: string): void {
    if (!sym || compareSyms.some(c => c.symbol === sym) || sym === symbol.symbol) return;
    const acc = accents(isDark());
    const c = { symbol: sym, series: chart.addSeries(LineSeries, { color: acc[(compareSyms.length + 1) % acc.length], lineWidth: 2, priceLineVisible: false, title: '' } as never, 0), rows: [] as WidgetBar[] };
    compareSyms.push(c);
    settings.scaleMode = 'percent';
    applySettings();
    void loadCompare(c);
    renderLegend();
    emit('indicators', api.indicators());
  }
  function removeCompare(sym: string): void {
    const c = compareSyms.find(x => x.symbol === sym);
    if (!c) return;
    if (c.series) chart.removeSeries(c.series);
    compareSyms = compareSyms.filter(x => x !== c);
    if (!compareSyms.length && settings.scaleMode === 'percent') { settings.scaleMode = 'linear'; applySettings(); }
    renderLegend();
    emit('indicators', api.indicators());
  }

  // ── settings ──
  function applySettings(): void {
    chart.applyOptions({
      grid: { horzLines: settings.grid, vertLines: settings.vertGrid },
      crosshair: { mode: settings.crosshair },
    } as never);
    chart.priceScale('right', 0).applyOptions({ mode: settings.scaleMode, autoScale: settings.autoScale });
    syncVolume();
    chart.paint();
    syncScaleKeys();
    void syncExtras();
    schedulePersist();
  }

  // ── extras (tooltips, watermark), when the extras module is present ──
  let extraHandles: { tooltip?: { remove?(): void; destroy?(): void } | null; watermark?: { remove?(): void; destroy?(): void } | null } = {};
  async function syncExtras(): Promise<void> {
    const needs = settings.tooltip !== 'off' || settings.watermark;
    const x = needs ? await getModule('extras') : modules.extras ?? null;
    if (destroyed) return;
    const drop = (k: 'tooltip' | 'watermark'): void => { const hd = extraHandles[k]; if (hd) { try { (hd.remove ?? hd.destroy)?.call(hd); } catch { /* ignore */ } } extraHandles[k] = null; };
    drop('tooltip'); drop('watermark');
    if (!x) return;
    try {
      if (settings.tooltip !== 'off' && typeof x.createTooltip === 'function') extraHandles.tooltip = (x.createTooltip as (c: ChartApi, o: unknown) => never)(chart, { mode: settings.tooltip });
      if (settings.watermark && typeof x.createWatermark === 'function') extraHandles.watermark = (x.createWatermark as (c: ChartApi, o: unknown) => never)(chart, { text: options.watermark ?? `${symbol.symbol} · ${interval}` });
    } catch (e) { emit('error', e); }
  }

  // ── drawings ──
  async function ensureTools(): Promise<void> {
    if (tools || !main) return;
    if (toolsLoading) return toolsLoading;
    toolsLoading = (async () => {
      const mod = await getModule('drawings') as { createDrawingTools?: (...a: unknown[]) => unknown } | null;
      if (destroyed || !mod || typeof mod.createDrawingTools !== 'function' || !main) return;
      const t = mod.createDrawingTools(chart, main, { toolbar: { position: 'left' }, magnet: true }) as ToolsLike;
      tools = t;
      if (drawingsJSON) { try { t.importJSON(drawingsJSON); } catch { /* bad saved drawings are dropped */ } }
      const onChange = (): void => { if (!applyingHistory) { pushHistory({ kind: 'draw' }); } drawingsJSON = tools?.exportJSON() ?? null; schedulePersist(); };
      for (const e of ['created', 'changed', 'removed']) t.on(e, onChange);
      placeLegend(true);
      syncTop();
    })();
    await toolsLoading;
    toolsLoading = null;
  }
  function dropTools(): void {
    if (!tools) return;
    drawingsJSON = tools.exportJSON();
    tools.destroy();
    tools = null;
    placeLegend(true);
  }
  async function setDrawings(on: boolean): Promise<void> {
    drawingsOn = on;
    if (on) await ensureTools(); else dropTools();
    syncTop();
    schedulePersist();
  }

  // ── undo / redo: widget changes as workspace snapshots, drawing changes through the drawing tools ──
  type Hist = { kind: 'ws'; before: WorkspaceJSON; after: WorkspaceJSON } | { kind: 'draw' };
  let undoStack: Hist[] = [];
  let redoStack: Hist[] = [];
  let applyingHistory = false;
  function pushHistory(e: Hist): void { undoStack.push(e); if (undoStack.length > 100) undoStack.shift(); redoStack = []; syncHistoryButtons(); }
  function record(fn: () => void): void {
    if (applyingHistory) { fn(); return; }
    const before = snapshot();
    fn();
    pushHistory({ kind: 'ws', before, after: snapshot() });
    schedulePersist();
  }
  async function undo(): Promise<void> {
    const e = undoStack.pop();
    if (!e) return;
    applyingHistory = true;
    try { if (e.kind === 'draw') tools?.undo(); else await applyWorkspace(e.before, false); } finally { applyingHistory = false; }
    redoStack.push(e);
    syncHistoryButtons();
  }
  async function redo(): Promise<void> {
    const e = redoStack.pop();
    if (!e) return;
    applyingHistory = true;
    try { if (e.kind === 'draw') tools?.redo(); else await applyWorkspace(e.after, false); } finally { applyingHistory = false; }
    undoStack.push(e);
    syncHistoryButtons();
  }

  // ── workspace ──
  function snapshot(): WorkspaceJSON {
    return {
      format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, symbol: { ...symbol }, interval, chartType, theme, timeZone: tz,
      indicators: inds.map(indState), compare: compareSyms.map(c => c.symbol), settings: { ...settings },
      drawings: tools ? tools.exportJSON() : drawingsJSON,
    };
  }
  async function applyWorkspace(ws: WorkspaceJSON, reload: boolean): Promise<void> {
    const symbolChanged = ws.symbol.symbol !== symbol.symbol;
    const intervalChanged = ws.interval !== interval;
    symbol = { ...ws.symbol };
    interval = ws.interval;
    chartType = chartTypes().some(c => c.id === ws.chartType) ? ws.chartType : chartType;
    theme = ws.theme;
    tz = ws.timeZone === 'local' || isValidTimeZone(ws.timeZone) ? ws.timeZone : tz;
    settings = { ...ws.settings };
    chart.applyOptions({ theme, timeScale: { timeZone: tz } } as never);
    applyTheme();
    for (const ind of inds) teardownIndicator(ind);
    inds.length = 0;
    for (const st of ws.indicators) { const spec = catalog.find(s => s.id === st.id); if (spec) addIndicatorRaw(spec, st); }
    for (const c of [...compareSyms]) { if (c.series) chart.removeSeries(c.series); }
    compareSyms = [];
    if (ws.drawings !== (tools ? tools.exportJSON() : drawingsJSON)) {
      drawingsJSON = ws.drawings;
      const t = tools as ToolsLike | null;
      if (t && ws.drawings) { try { t.importJSON(ws.drawings); } catch { /* ignore */ } }
    }
    if (reload && (symbolChanged || intervalChanged) && (feed || liveOpt)) await loadData();
    else buildMain();
    rebuildIndicators();
    for (const s of ws.compare) addCompare(s);
    applySettings();
    syncTop();
    syncBottom();
  }

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const storage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null => {
    if (!options.persist) return null;
    if (options.persist.storage) return options.persist.storage;
    try { return win.localStorage; } catch { return null; }
  };
  function schedulePersist(): void {
    if (!options.persist || destroyed) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      try { storage()?.setItem(STORE_PREFIX + options.persist!.key, JSON.stringify(snapshot())); } catch { /* full or blocked */ }
    }, 300);
  }
  let emitQueued = false;
  function emitChange(): void {
    schedulePersist();
    if (emitQueued) return;
    emitQueued = true;
    queueMicrotask(() => { emitQueued = false; for (const f of handlers.get('change') ?? []) { try { f(undefined); } catch { /* host */ } } });
  }

  // ── top bar ──
  const items = new Map<string, HTMLElement>();
  const symBtn = h(doc, 'button', `b sym${canSearch() ? '' : ' plain'}`, { type: 'button', 'aria-label': S.searchSymbol, title: canSearch() ? S.searchSymbol : '' });
  const symName = h(doc, 'span', 'n');
  const symDesc = h(doc, 'span', 'd');
  symBtn.append(symName, symDesc);
  symBtn.addEventListener('click', () => { if (canSearch()) openSymbolSearch(symBtn, ''); });
  if (!canSearch()) { symBtn.setAttribute('tabindex', '-1'); symBtn.removeAttribute('aria-label'); }
  const statusEl = h(doc, 'span', 'st hide', { role: 'status' }, [h(doc, 'span', 'dot'), h(doc, 'span', '', {}, [''])]);
  const ivGroup = h(doc, 'div', 'grp', { role: 'radiogroup', 'aria-label': S.interval });
  const ivMore = btn(doc, { icon: 'chevron', label: S.moreIntervals, iconPx: 16, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, onClick: ev => openIntervalMenu(ev.currentTarget as HTMLElement) });
  const ivCur = h(doc, 'span', 'hide', {}, ['']);
  ivCur.style.setProperty('font-weight', '600');
  ivMore.prepend(ivCur);
  const typeBtn = btn(doc, { icon: chartTypeIcon(chartType), label: S.chartType, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, onClick: ev => openChartTypeMenu(ev.currentTarget as HTMLElement) });
  const indBtn = btn(doc, { icon: 'indicators', text: S.indicators, label: `${S.indicators} (Alt+I)`, attrs: { 'aria-haspopup': 'dialog' }, onClick: ev => openIndicators(ev.currentTarget as HTMLElement) });
  const cmpBtn = btn(doc, { icon: 'compare', label: S.compare, attrs: { 'aria-haspopup': 'dialog' }, onClick: ev => openSymbolSearch(ev.currentTarget as HTMLElement, '', true) });
  const drawBtn = btn(doc, { icon: 'pencil', label: S.draw, attrs: { 'aria-pressed': 'false' }, onClick: () => void setDrawings(!drawingsOn) });
  const undoBtn = btn(doc, { icon: 'undo', label: `${S.undo} (Ctrl+Z)`, onClick: () => void undo() });
  const redoBtn = btn(doc, { icon: 'redo', label: `${S.redo} (Ctrl+Shift+Z)`, onClick: () => void redo() });
  const shotBtn = btn(doc, { icon: 'camera', label: `${S.screenshot} (Alt+S)`, onClick: () => void api.screenshot(true) });
  const fullBtn = btn(doc, { icon: 'expand', label: S.fullscreen, onClick: () => toggleFullscreen() });
  const themeBtn = btn(doc, { icon: 'moon', label: S.themeDark, onClick: () => api.setTheme(isDark() ? 'light' : 'dark') });
  const setBtn = btn(doc, { icon: 'sliders', label: S.settings, attrs: { 'aria-haspopup': 'dialog' }, onClick: ev => openSettings(ev.currentTarget as HTMLElement) });
  const moreBtn = btn(doc, { icon: 'more', label: S.more, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, onClick: ev => openMoreMenu(ev.currentTarget as HTMLElement, 'top') });
  const ivKeys: HTMLButtonElement[] = [];

  function canSearch(): boolean { return parts.symbol && (!!feed?.searchSymbols || !!liveOpt); }
  function canCompare(): boolean { return parts.compare && (!!feed?.getBars && !!feed?.searchSymbols || !!liveOpt && false); }

  function buildIntervalKeys(): void {
    ivGroup.textContent = '';
    ivKeys.length = 0;
    const shown = intervals.slice(0, 6);
    if (!shown.includes(interval)) shown[shown.length - 1] = interval;
    for (const iv of sortIntervals(shown)) {
      const k = h(doc, 'button', 'b k', { type: 'button', role: 'radio', 'aria-checked': String(iv === interval), 'aria-label': intervalWords(iv, S), title: intervalWords(iv, S) }, [iv]);
      k.dataset.iv = iv;
      k.addEventListener('click', () => void api.setInterval(iv));
      k.tabIndex = iv === interval ? 0 : -1;
      ivKeys.push(k);
      ivGroup.appendChild(k);
    }
  }
  // Arrow keys move between the interval keys (one tab stop for the group).
  ivGroup.addEventListener('keydown', ev => {
    const i = ivKeys.indexOf((shadow.activeElement as HTMLButtonElement));
    if (i < 0) return;
    let n = -1;
    if (ev.key === 'ArrowRight') n = (i + 1) % ivKeys.length; else if (ev.key === 'ArrowLeft') n = (i - 1 + ivKeys.length) % ivKeys.length;
    if (n >= 0) { ev.preventDefault(); ivKeys[n].focus(); }
  });

  const sep = (): HTMLElement => h(doc, 'span', 'sep', { 'aria-hidden': 'true' });
  const topDef: { id: string; el: HTMLElement; pri: number; label?: string; icon?: string; run?: (opener: HTMLElement) => void; on?: () => boolean }[] = [
    { id: 'symbol', el: symBtn, pri: KEEP },
    { id: 'status', el: statusEl, pri: 50 },
    { id: 'sepA', el: sep(), pri: 45 },
    { id: 'intervals', el: ivGroup, pri: 90 },
    { id: 'ivMore', el: ivMore, pri: KEEP },
    { id: 'sepB', el: sep(), pri: 44 },
    { id: 'chartType', el: typeBtn, pri: 85, label: S.chartType, icon: 'candles', run: o => openChartTypeMenu(o) },
    { id: 'indicators', el: indBtn, pri: 88, label: S.indicators, icon: 'indicators', run: o => openIndicators(o) },
    { id: 'compare', el: cmpBtn, pri: 20, label: S.compare, icon: 'compare', run: o => openSymbolSearch(o, '', true) },
    { id: 'draw', el: drawBtn, pri: 60, label: S.draw, icon: 'pencil', run: () => void setDrawings(!drawingsOn), on: () => drawingsOn },
    { id: 'spacer', el: h(doc, 'span', 'sp'), pri: KEEP },
    { id: 'undo', el: undoBtn, pri: 30, label: S.undo, icon: 'undo', run: () => void undo() },
    { id: 'redo', el: redoBtn, pri: 29, label: S.redo, icon: 'redo', run: () => void redo() },
    { id: 'screenshot', el: shotBtn, pri: 40, label: S.screenshot, icon: 'camera', run: () => void api.screenshot(true) },
    { id: 'fullscreen', el: fullBtn, pri: 42, label: S.fullscreen, icon: 'expand', run: () => toggleFullscreen() },
    { id: 'theme', el: themeBtn, pri: 35, label: S.themeDark, icon: 'moon', run: () => api.setTheme(isDark() ? 'light' : 'dark') },
    { id: 'settings', el: setBtn, pri: 70, label: S.settings, icon: 'sliders', run: o => openSettings(o) },
    { id: 'more', el: moreBtn, pri: KEEP },
  ];
  const partOf: Record<string, keyof typeof parts | null> = { symbol: 'symbol', status: 'status', intervals: 'intervals', ivMore: 'intervals', chartType: 'chartType', indicators: 'indicators', compare: 'compare', draw: 'draw', undo: 'undo', redo: 'undo', screenshot: 'screenshot', fullscreen: 'fullscreen', theme: 'theme', settings: 'settings' };
  for (const d of topDef) { items.set(d.id, d.el); top.appendChild(d.el); }

  function enabledTop(id: string): boolean {
    const p = partOf[id];
    if (p && !parts[p]) return false;
    if (id === 'compare') return canCompare();
    if (id === 'draw') return !!(modules.drawings || options.load?.drawings);
    if (id === 'status') return !!(liveOpt || feed?.subscribeBars) && parts.status;
    return true;
  }

  // ── bottom bar ──
  const rangeGroup = h(doc, 'div', 'grp', { role: 'radiogroup', 'aria-label': S.ranges });
  const rangeKeys: HTMLButtonElement[] = [];
  for (const k of RANGE_KEYS) {
    const b = h(doc, 'button', 'b k', { type: 'button', role: 'radio', 'aria-checked': 'false', title: k }, [k]);
    b.addEventListener('click', () => void api.setRange(k));
    b.tabIndex = rangeKeys.length === 0 ? 0 : -1;
    rangeKeys.push(b);
    rangeGroup.appendChild(b);
  }
  rangeGroup.addEventListener('keydown', ev => {
    const i = rangeKeys.indexOf(shadow.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let n = -1;
    if (ev.key === 'ArrowRight') n = (i + 1) % rangeKeys.length; else if (ev.key === 'ArrowLeft') n = (i - 1 + rangeKeys.length) % rangeKeys.length;
    if (n >= 0) { ev.preventDefault(); rangeKeys.forEach((b, j) => { b.tabIndex = j === n ? 0 : -1; }); rangeKeys[n].focus(); }
  });
  const gotoBtn = btn(doc, { icon: 'calendar', text: S.goTo, label: S.goToDate, attrs: { 'aria-haspopup': 'dialog' }, onClick: ev => openGoTo(ev.currentTarget as HTMLElement) });
  const clockBtn = btn(doc, { icon: 'globe', text: '', label: S.timeZone, cls: 'clk', iconPx: 16, attrs: { 'aria-haspopup': 'menu' }, onClick: ev => openZoneMenu(ev.currentTarget as HTMLElement) });
  const scaleGroup = h(doc, 'div', 'grp', { role: 'group', 'aria-label': S.scaleMode });
  const pctBtn = h(doc, 'button', 'b k', { type: 'button', 'aria-pressed': 'false', 'aria-label': S.scalePercentLong, title: S.scalePercentLong }, [S.scalePercent]);
  const logBtn = h(doc, 'button', 'b k', { type: 'button', 'aria-pressed': 'false', 'aria-label': S.scaleLogLong, title: S.scaleLogLong }, [S.scaleLog]);
  const autoBtn = h(doc, 'button', 'b k', { type: 'button', 'aria-pressed': 'true', 'aria-label': S.scaleAutoLong, title: S.scaleAutoLong }, [S.scaleAuto]);
  pctBtn.addEventListener('click', () => { record(() => { settings.scaleMode = settings.scaleMode === 'percent' ? 'linear' : 'percent'; }); applySettings(); });
  logBtn.addEventListener('click', () => { record(() => { settings.scaleMode = settings.scaleMode === 'log' ? 'linear' : 'log'; }); applySettings(); });
  autoBtn.addEventListener('click', () => { record(() => { settings.autoScale = !settings.autoScale; }); applySettings(); });
  scaleGroup.append(pctBtn, logBtn, autoBtn);
  const botMore = btn(doc, { icon: 'more', label: S.more, attrs: { 'aria-haspopup': 'menu' }, onClick: ev => openMoreMenu(ev.currentTarget as HTMLElement, 'bottom') });
  const botDef: { id: string; el: HTMLElement; pri: number; label?: string; icon?: string; run?: (o: HTMLElement) => void }[] = [
    { id: 'ranges', el: rangeGroup, pri: 80, label: S.ranges, icon: 'calendar', run: o => openRangeMenu(o) },
    { id: 'goto', el: gotoBtn, pri: 60, label: S.goToDate, icon: 'calendar', run: o => openGoTo(o) },
    { id: 'bspacer', el: h(doc, 'span', 'sp'), pri: KEEP },
    { id: 'clock', el: clockBtn, pri: 40, label: S.timeZone, icon: 'globe', run: o => openZoneMenu(o) },
    { id: 'bsep', el: sep(), pri: 39 },
    { id: 'scale', el: scaleGroup, pri: 50, label: S.scaleMode, icon: 'sliders', run: o => openScaleMenu(o) },
    { id: 'bmore', el: botMore, pri: KEEP },
  ];
  const botPart: Record<string, keyof typeof parts | null> = { ranges: 'ranges', goto: 'goto', clock: 'clock', bsep: 'clock', scale: 'scale' };
  for (const d of botDef) { items.set(d.id, d.el); bottom.appendChild(d.el); }

  // ── go to latest ──
  const latestBtn = btn(doc, { icon: 'latest', text: '', label: S.latest, cls: 'latest hide', iconPx: 16, onClick: () => { chart.timeScale().scrollToRealTime(); latestBtn.classList.add('hide'); chart.element().focus(); } });
  card.appendChild(latestBtn);
  const onRT = (rt: boolean): void => {
    latestBtn.classList.toggle('hide', rt);
    if (!rt) {
      const right = chart.priceScale('right').width() + 10;
      const panesH = chart.panes().reduce((a, p) => a + p.getHeight() + 1, -1);
      latestBtn.style.setProperty('right', `${right}px`);
      latestBtn.style.setProperty('top', `${Math.max(8, panesH - 38)}px`);
    }
  };
  chart.timeScale().subscribeRealTimeChange(onRT);
  // A pan or zoom by hand clears the selected range key.
  let programmatic = 0;
  const onRange = (): void => { if (programmatic > Date.now()) return; if (rangeKey) { rangeKey = null; syncBottom(); } };
  chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

  // ── sync of the chrome (state -> DOM), and the responsive collapse (on resize only) ──
  const overflowTop: string[] = [];
  const overflowBot: string[] = [];
  function syncTop(): void {
    symName.textContent = symbol.symbol || S.symbol;
    symDesc.textContent = symbol.description ?? '';
    symDesc.classList.toggle('hide', !symbol.description);
    if (canSearch()) symBtn.append(...(symBtn.querySelector('svg') ? [] : [svgIcon(doc, 'search', 16)]));
    ivCur.textContent = interval;
    for (const k of ivKeys) { const on = k.dataset.iv === interval; k.setAttribute('aria-checked', String(on)); k.tabIndex = on ? 0 : -1; }
    if (!ivKeys.some(k => k.dataset.iv === interval)) buildIntervalKeys();
    typeBtn.replaceChildren(svgIcon(doc, chartTypeIcon(chartType), 20));
    const ct = chartTypes().find(c => c.id === chartType);
    typeBtn.title = `${S.chartType}: ${ct?.name ?? chartType}`;
    typeBtn.setAttribute('aria-label', typeBtn.title);
    drawBtn.setAttribute('aria-pressed', String(drawingsOn));
    const dark = isDark();
    themeBtn.replaceChildren(svgIcon(doc, dark ? 'sun' : 'moon', 20));
    themeBtn.title = dark ? S.themeLight : S.themeDark;
    themeBtn.setAttribute('aria-label', themeBtn.title);
    const fs = isFullscreen();
    fullBtn.replaceChildren(svgIcon(doc, fs ? 'shrink' : 'expand', 20));
    fullBtn.title = fs ? S.exitFullscreen : S.fullscreen;
    fullBtn.setAttribute('aria-label', fullBtn.title);
    syncHistoryButtons();
  }
  function syncHistoryButtons(): void {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }
  function syncScaleKeys(): void {
    pctBtn.setAttribute('aria-pressed', String(settings.scaleMode === 'percent'));
    logBtn.setAttribute('aria-pressed', String(settings.scaleMode === 'log'));
    autoBtn.setAttribute('aria-pressed', String(settings.autoScale));
  }
  function syncBottom(): void {
    rangeKeys.forEach(b => b.setAttribute('aria-checked', String(b.textContent === rangeKey)));
    syncScaleKeys();
    tickClock(true);
  }

  let measured = new Map<string, number>();
  function relayout(): void {
    if (destroyed) return;
    const width = w.clientWidth;
    if (!(width > 0)) return;
    for (const [defs, partMap, bar, more, overflow] of [[topDef, partOf, top, moreBtn, overflowTop], [botDef, botPart, bottom, botMore, overflowBot]] as const) {
      for (const d of defs) {
        const p = (partMap as Record<string, keyof typeof parts | null>)[d.id];
        const enabled = bar === top ? enabledTop(d.id) : !(p && !parts[p]);
        d.el.classList.toggle('hide', !enabled);
        (d.el as HTMLElement & { _en?: boolean })._en = enabled;
      }
      // Measure each enabled item once per relayout (all shown), then collapse.
      for (const d of defs) if ((d.el as HTMLElement & { _en?: boolean })._en && d.id !== 'spacer' && d.id !== 'bspacer') d.el.classList.remove('hide');
      more.classList.remove('hide');
      measured = new Map();
      const list: BarItem[] = [];
      for (const d of defs) {
        if (!(d.el as HTMLElement & { _en?: boolean })._en || d.el === more) continue;
        const wd = d.id === 'spacer' || d.id === 'bspacer' ? 8 : d.el.offsetWidth + 2;
        measured.set(d.id, wd);
        list.push({ id: d.id, width: wd, priority: d.pri });
      }
      const avail = bar.clientWidth - 16;
      const res = collapseBar(list, avail, more.offsetWidth + 2);
      overflow.length = 0;
      for (const id of res.overflow) overflow.push(id);
      for (const d of defs) {
        if (d.el === more) continue;
        const en = (d.el as HTMLElement & { _en?: boolean })._en;
        d.el.classList.toggle('hide', !en || res.overflow.includes(d.id));
      }
      // Separators next to nothing go too.
      more.classList.toggle('hide', !res.overflow.some(id => defs.find(d => d.id === id)?.run));
    }
    // With the keys collapsed, the menu button names the interval.
    const ivHidden = overflowTop.includes('intervals');
    ivCur.textContent = interval;
    ivCur.classList.toggle('hide', !ivHidden);
    ivMore.classList.toggle('i', !ivHidden);
    placeLegend(true);
  }
  const RO = (win as Window & typeof globalThis).ResizeObserver;
  let roQueued = false;
  if (RO) {
    const ro = new RO(() => { if (roQueued) return; roQueued = true; win.requestAnimationFrame(() => { roQueued = false; relayout(); }); });
    ro.observe(w);
    cleanups.push(() => ro.disconnect());
  }

  // ── clock ──
  let clockId: ReturnType<typeof setInterval> | null = null;
  let clockText = '';
  function tickClock(force = false): void {
    const now = Date.now();
    const zone = zoneName();
    const off = zoneOffsetMs(zone, now);
    const t = new Date(now + off);
    const p2 = (n: number): string => String(n).padStart(2, '0');
    const text = `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())} ${offsetLabel(off)}`;
    if (!force && text === clockText) return;
    clockText = text;
    const span = clockBtn.querySelector('.t');
    if (span) span.textContent = text;
    clockBtn.title = `${S.timeZone}: ${tz === 'local' ? `${S.localZone} (${zone})` : zone}`;
    clockBtn.setAttribute('aria-label', clockBtn.title);
  }
  if (parts.clock) { clockId = setInterval(() => tickClock(), 1000); cleanups.push(() => { if (clockId) clearInterval(clockId); }); }

  // ── menus ──
  const sheets = (): boolean => useSheets(w.clientWidth, !!coarseQ?.matches);
  function menuItem(label: string, opts: { icon?: string; checked?: boolean; hint?: string; onPick: () => void; radio?: boolean; disabled?: boolean }): HTMLElement {
    const it = h(doc, 'div', 'mi', { role: opts.radio ? 'menuitemradio' : 'menuitem', tabindex: '-1', 'aria-checked': opts.radio ? String(!!opts.checked) : undefined, 'aria-disabled': opts.disabled ? 'true' : undefined });
    if (opts.icon) it.append(svgIcon(doc, opts.icon, 20));
    it.append(h(doc, 'span', 't', {}, [label]));
    if (opts.hint) it.append(h(doc, 'span', 'x', {}, [opts.hint]));
    if (!opts.disabled) it.addEventListener('click', () => opts.onPick());
    return it;
  }
  function openMenu(opener: HTMLElement, label: string, fillMenu: (m: HTMLElement, close: () => void) => void, align: 'start' | 'end' = 'start', prefer: 'below' | 'above' = 'below'): void {
    layers.closeAll(false);
    const m = h(doc, 'div', 'menu', { role: 'menu', 'aria-label': label });
    let close: (rf?: boolean) => void = () => {};
    fillMenu(m, () => close(true));
    const sheet = sheets();
    opener.setAttribute('aria-expanded', 'true');
    if (!sheet) { m.style.setProperty('visibility', 'hidden'); w.appendChild(m); placePopover(m, opener.getBoundingClientRect(), w.getBoundingClientRect(), prefer, align); m.style.removeProperty('visibility'); }
    close = layers.push(m, { kind: 'menu', opener, sheet, onClose: () => opener.setAttribute('aria-expanded', 'false') });
  }

  function openIntervalMenu(opener: HTMLElement): void {
    openMenu(opener, S.interval, (m, close) => {
      const list = sortIntervals(liveOpt ? LIVE_INTERVALS : feed?.intervals?.length ? feed.intervals : Array.from(new Set([...intervals, ...(feed ? [] : [])])));
      let lastUnit = '';
      for (const iv of list) {
        const u = iv.slice(-1);
        if (lastUnit && u !== lastUnit) m.append(h(doc, 'div', 'msep'));
        lastUnit = u;
        m.append(menuItem(intervalWords(iv, S), { radio: true, checked: iv === interval, hint: iv, onPick: () => { close(); void api.setInterval(iv); } }));
      }
    });
  }
  function openChartTypeMenu(opener: HTMLElement): void {
    openMenu(opener, S.chartType, (m, close) => {
      for (const t of chartTypes()) m.append(menuItem(t.name, { icon: chartTypeIcon(t.id), radio: true, checked: t.id === chartType, onPick: () => { close(); api.setChartType(t.id); } }));
    });
  }
  function openZoneMenu(opener: HTMLElement): void {
    openMenu(opener, S.timeZone, (m, close) => {
      m.append(h(doc, 'div', 'mh', {}, [S.timeZone]));
      const now = Date.now();
      for (const z of ZONES) {
        const real = z === 'local' ? localTimeZone() : z;
        const label = z === 'local' ? `${S.localZone} (${real.split('/').pop()?.replace(/_/g, ' ')})` : z === 'UTC' ? 'UTC' : (z.split('/').pop() ?? z).replace(/_/g, ' ');
        m.append(menuItem(label, { radio: true, checked: z === tz, hint: offsetLabel(zoneOffsetMs(real, now)), onPick: () => { close(); setZone(z); } }));
      }
    }, 'end', 'above');
  }
  function openRangeMenu(opener: HTMLElement): void {
    openMenu(opener, S.ranges, (m, close) => { for (const k of RANGE_KEYS) m.append(menuItem(k, { radio: true, checked: rangeKey === k, onPick: () => { close(); void api.setRange(k); } })); }, 'start', 'above');
  }
  function openScaleMenu(opener: HTMLElement): void {
    openMenu(opener, S.scaleMode, (m, close) => {
      m.append(menuItem(S.scalePercentLong, { radio: true, checked: settings.scaleMode === 'percent', onPick: () => { close(); pctBtn.click(); } }));
      m.append(menuItem(S.scaleLogLong, { radio: true, checked: settings.scaleMode === 'log', onPick: () => { close(); logBtn.click(); } }));
      m.append(menuItem(S.scaleAutoLong, { radio: true, checked: settings.autoScale, onPick: () => { close(); autoBtn.click(); } }));
    }, 'end', 'above');
  }
  function openMoreMenu(opener: HTMLElement, which: 'top' | 'bottom'): void {
    const defs = which === 'top' ? topDef : botDef;
    const ids = which === 'top' ? overflowTop : overflowBot;
    openMenu(opener, S.more, (m, close) => {
      for (const id of ids) {
        const d = defs.find(x => x.id === id);
        if (!d || !d.run || !d.label) continue;
        if (id === 'intervals') continue;
        const label = id === 'theme' ? (isDark() ? S.themeLight : S.themeDark) : id === 'fullscreen' && isFullscreen() ? S.exitFullscreen : d.label;
        const icon = id === 'theme' ? (isDark() ? 'sun' : 'moon') : id === 'chartType' ? chartTypeIcon(chartType) : d.icon;
        m.append(menuItem(label, { icon, onPick: () => { close(); d.run!(opener); } }));
      }
      const x = modules.extras;
      if (which === 'top' && x && typeof x.createReplay === 'function') m.append(menuItem(S.replay, { icon: 'replay', onPick: () => { close(); startReplay(); } }));
    }, 'end', which === 'top' ? 'below' : 'above');
  }
  function startReplay(): void {
    try { (modules.extras!.createReplay as (c: ChartApi, s: AnySeries, o: unknown) => unknown)(chart, main as AnySeries, { data: rows }); } catch (e) { emit('error', e); }
  }

  // ── dialogs ──
  function dialog(title: string, opener: HTMLElement | null, wide = false): { el: HTMLElement; body: HTMLElement; foot: HTMLElement; open: (focus?: HTMLElement | null) => () => void } {
    layers.closeAll(false);
    const el = h(doc, 'div', 'dlg', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    if (wide) el.style.setProperty('width', 'min(680px, calc(100% - 24px))');
    const head = h(doc, 'div', 'dh', {}, [h(doc, 'div', 'ttl', {}, [title])]);
    const body = h(doc, 'div', 'db');
    const foot = h(doc, 'div', 'df');
    let close: (rf?: boolean) => void = () => {};
    head.append(btn(doc, { icon: 'close', label: S.close, onClick: () => close(true) }));
    el.append(head, body);
    return {
      el, body, foot,
      open: (focus?: HTMLElement | null) => {
        if (foot.childNodes.length) el.append(foot);
        close = layers.push(el, { kind: 'dialog', opener, scrim: true, sheet: sheets(), focus });
        return () => close(true);
      },
    };
  }

  function openSymbolSearch(opener: HTMLElement, initial: string, compare = false): void {
    if (!compare && !canSearch()) return;
    const d = dialog(compare ? S.compareSymbol : S.searchSymbol, opener);
    const field = h(doc, 'div', 'srch', {}, [svgIcon(doc, 'search', 18)]);
    const input = h(doc, 'input', '', { type: 'search', placeholder: S.searchPlaceholder, 'aria-label': S.searchSymbol, autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-autocomplete': 'list' });
    input.value = initial;
    field.append(input);
    const list = h(doc, 'div', 'lst', { role: 'listbox', 'aria-label': S.searchSymbol });
    d.el.insertBefore(field, d.body);
    d.body.append(list);
    let token = 0;
    let results: SymbolInfo[] = [];
    let active = 0;
    const pick = (s: SymbolInfo): void => { close(); if (compare) addCompare(s.symbol); else void api.setSymbol(s); };
    const render = (): void => {
      list.textContent = '';
      if (!results.length) { list.append(h(doc, 'div', 'empty', {}, [S.noMatches])); return; }
      results.forEach((s, i) => {
        const it = h(doc, 'div', 'mi', { role: 'option', 'aria-selected': String(i === active), id: `opt-${i}` }, [h(doc, 'span', 't', {}, [s.symbol]), h(doc, 'span', 'x', {}, [[s.description, s.exchange].filter(Boolean).join(' · ')])]);
        if (i === active) it.style.setProperty('background', 'var(--hover)');
        it.addEventListener('click', () => pick(s));
        list.append(it);
      });
      input.setAttribute('aria-activedescendant', `opt-${active}`);
    };
    const search = async (): Promise<void> => {
      const q = input.value.trim();
      const t = ++token;
      let got: readonly SymbolInfo[] = [];
      if (feed?.searchSymbols) { try { got = await feed.searchSymbols(q); } catch { got = []; } }
      else { const ql = q.toLowerCase(); got = CRYPTO_SYMBOLS.filter(c => !ql || c.symbol.toLowerCase().includes(ql) || (c.description ?? '').toLowerCase().includes(ql)); }
      if (t !== token || destroyed) return;
      results = got.slice(0, 50).map(s => ({ ...s }));
      active = 0;
      render();
    };
    input.addEventListener('input', () => void search());
    input.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(results.length - 1, active + 1); render(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(0, active - 1); render(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); if (results[active]) pick(results[active]); }
    });
    const close = d.open(input);
    void search();
  }

  function catLabel(c: string): string {
    return ({ trend: S.categoryTrend, momentum: S.categoryMomentum, volatility: S.categoryVolatility, volume: S.categoryVolume } as Record<string, string>)[c] ?? S.categoryOther;
  }

  function openIndicators(opener: HTMLElement): void {
    const d = dialog(S.indicators, opener, true);
    const field = h(doc, 'div', 'srch', {}, [svgIcon(doc, 'search', 18)]);
    const input = h(doc, 'input', '', { type: 'search', placeholder: S.searchIndicators, 'aria-label': S.searchIndicators, autocomplete: 'off', spellcheck: 'false' });
    field.append(input);
    d.el.insertBefore(field, d.body);
    const render = (): void => {
      const q = input.value.trim().toLowerCase();
      d.body.textContent = '';
      // On the chart.
      if (!q) {
        d.body.append(h(doc, 'div', 'fs', {}, [S.onChart]));
        if (!inds.length) d.body.append(h(doc, 'div', 'empty', {}, [S.noIndicators]));
        for (const ind of inds) {
          const row = h(doc, 'div', 'ind');
          const dot = h(doc, 'span', 'sw2');
          dot.style.setProperty('width', '8px'); dot.style.setProperty('height', '8px'); dot.style.setProperty('border-radius', '4px');
          dot.style.setProperty('background', ind.styles[ind.spec.outputs[0]?.key ?? '']?.color ?? colors().line);
          row.append(dot, h(doc, 'span', 't', {}, [legendLabel(ind.spec, ind.params)]), h(doc, 'span', 'x', {}, [ind.placement === 'pane' ? S.ownPane : S.overlay]));
          const acts = h(doc, 'span', 'acts');
          acts.append(
            btn(doc, { icon: ind.visible ? 'eye' : 'eyeOff', label: `${ind.visible ? S.hide : S.show} ${ind.spec.shortName}`, onClick: () => { ind.handle.setVisible(!ind.visible); render(); } }),
            btn(doc, { icon: 'gear', label: fill(S.settingsOf, ind.spec.shortName), onClick: ev => openIndicatorSettings(ind, ev.currentTarget as HTMLElement) }),
            btn(doc, { icon: 'trash', label: `${S.remove} ${ind.spec.shortName}`, onClick: () => { ind.handle.remove(); render(); input.focus(); } }),
          );
          row.append(acts);
          d.body.append(row);
        }
      }
      for (const cat of CATEGORIES) {
        const specs = catalog.filter(s => (s.category ?? 'other') === cat && (!q || s.name.toLowerCase().includes(q) || s.shortName.toLowerCase().includes(q) || s.id.includes(q)));
        if (!specs.length) continue;
        d.body.append(h(doc, 'div', 'fs', {}, [catLabel(cat)]));
        for (const s of specs) {
          const row = h(doc, 'div', 'ind');
          const count = inds.filter(i => i.spec.id === s.id).length;
          row.append(h(doc, 'span', 't', {}, [s.name]), h(doc, 'span', 'x', {}, [count ? `${s.shortName} · ${count}` : s.shortName]));
          const add = btn(doc, { icon: 'plus', label: `${S.add} ${s.name}`, onClick: () => { api.addIndicator(s.id); render(); live.textContent = `${s.name}: ${S.onChart}`; (d.body.querySelector(`[data-add="${s.id}"]`) as HTMLElement | null)?.focus(); } });
          add.dataset.add = s.id;
          row.append(add);
          row.addEventListener('dblclick', () => add.click());
          d.body.append(row);
        }
      }
      if (q && !d.body.childNodes.length) d.body.append(h(doc, 'div', 'empty', {}, [S.noMatches]));
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { const first = d.body.querySelector<HTMLElement>('[data-add]'); first?.click(); } });
    render();
    d.open(input);
  }

  function openIndicatorSettings(ind: Ind, opener: HTMLElement): void {
    const d = dialog(fill(S.settingsOf, ind.spec.name), opener);
    const draft = { ...ind.params };
    const styles: Record<string, OutputStyle> = JSON.parse(JSON.stringify(ind.styles));
    let placement = ind.placement;
    if (ind.spec.inputs.length) d.body.append(h(doc, 'div', 'fs', {}, [S.inputs]));
    for (const input of ind.spec.inputs) {
      const id = `in-${ind.uid}-${input.key}`;
      const row = h(doc, 'div', 'fr', {}, [h(doc, 'label', '', { for: id }, [input.label])]);
      if (input.type === 'bool') {
        const sw = h(doc, 'button', 'sw', { type: 'button', role: 'switch', id, 'aria-checked': String(!!draft[input.key]), 'aria-label': input.label });
        sw.addEventListener('click', () => { draft[input.key] = !draft[input.key]; sw.setAttribute('aria-checked', String(!!draft[input.key])); });
        row.append(sw);
      } else if (input.type === 'select' || input.type === 'source') {
        const sel = h(doc, 'select', 'f', { id });
        for (const o of input.options ?? []) sel.append(h(doc, 'option', '', { value: o, selected: o === draft[input.key] }, [o]));
        sel.addEventListener('change', () => { draft[input.key] = sel.value; });
        row.append(sel);
      } else {
        const f = h(doc, 'input', 'f', { id, type: 'number', inputmode: input.type === 'int' ? 'numeric' : 'decimal', min: input.min, max: input.max, step: input.step ?? (input.type === 'int' ? 1 : 0.1), value: String(draft[input.key]) });
        f.addEventListener('change', () => {
          const v = validateParams({ inputs: [input] }, { [input.key]: f.value });
          draft[input.key] = v.params[input.key];
          f.value = String(v.params[input.key]);
        });
        row.append(f);
      }
      d.body.append(row);
    }
    d.body.append(h(doc, 'div', 'fs', {}, [S.style]));
    const palette = Array.from(new Set([...accents(isDark()), colors().up, colors().down, isDark() ? '#8E8E93' : '#8A8A8E']));
    for (const o of ind.spec.outputs) {
      const st = styles[o.key];
      const row = h(doc, 'div', 'fr', {}, [h(doc, 'span', 'lb', {}, [o.label])]);
      const cl = h(doc, 'div', 'cl', { role: 'radiogroup', 'aria-label': `${o.label} ${S.colour}` });
      for (const c of palette.includes(st.color) ? palette : [st.color, ...palette].slice(0, 9)) {
        const s = h(doc, 'button', 'cs', { type: 'button', role: 'radio', 'aria-checked': String(c === st.color), 'aria-label': `${S.colour} ${c}`, title: c });
        s.style.setProperty('background', c);
        s.addEventListener('click', () => { st.color = c; for (const x of Array.from(cl.children)) x.setAttribute('aria-checked', String(x === s)); });
        cl.append(s);
      }
      const wsel = h(doc, 'select', 'f', { 'aria-label': `${o.label} ${S.lineWidth}` });
      wsel.style.setProperty('width', '64px');
      for (const wv of [1, 2, 3, 4]) wsel.append(h(doc, 'option', '', { value: wv, selected: wv === st.width }, [`${wv} px`]));
      wsel.addEventListener('change', () => { st.width = Number(wsel.value) as OutputStyle['width']; });
      const vis = h(doc, 'button', 'sw', { type: 'button', role: 'switch', 'aria-checked': String(st.visible), 'aria-label': `${o.label} ${S.visible}` });
      vis.addEventListener('click', () => { st.visible = !st.visible; vis.setAttribute('aria-checked', String(st.visible)); });
      row.append(cl, wsel, vis);
      d.body.append(row);
    }
    d.body.append(h(doc, 'div', 'fs', {}, [S.placement]));
    const pill = h(doc, 'div', 'pill', { role: 'radiogroup', 'aria-label': S.placement });
    for (const [v, label] of [['overlay', S.overlay], ['pane', S.ownPane]] as const) {
      const b = h(doc, 'button', 'b', { type: 'button', role: 'radio', 'aria-checked': String(placement === v) }, [label]);
      b.addEventListener('click', () => { placement = v; for (const x of Array.from(pill.children)) x.setAttribute('aria-checked', String(x === b)); });
      pill.append(b);
    }
    d.body.append(h(doc, 'div', 'fr', {}, [h(doc, 'span', 'lb', {}, [S.placement]), pill]));
    const reset = btn(doc, { text: S.defaults, label: S.defaults, onClick: () => { close(); record(() => { ind.params = validateParams(ind.spec, {}).params; ind.styles = defaultStyles(ind.spec, inds.indexOf(ind)); ind.placement = ind.spec.overlay ? 'overlay' : 'pane'; rebuildIndicators(); }); emit('indicators', api.indicators()); } });
    const done = btn(doc, { text: S.done, label: S.done, cls: 'on', onClick: () => {
      close();
      record(() => {
        ind.params = validateParams(ind.spec, draft).params;
        ind.styles = styles;
        const moved = placement !== ind.placement;
        ind.placement = placement;
        if (moved) rebuildIndicators(); else { buildIndicator(ind); renderLegend(); }
      });
      emit('indicators', api.indicators());
    } });
    d.foot.append(reset, done);
    const close = d.open();
  }

  function openSettings(opener: HTMLElement): void {
    const d = dialog(S.settings, opener);
    const sw = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
      const b = h(doc, 'button', 'sw', { type: 'button', role: 'switch', 'aria-checked': String(get()), 'aria-label': label });
      b.addEventListener('click', () => { record(() => set(!get())); b.setAttribute('aria-checked', String(get())); applySettings(); });
      return h(doc, 'div', 'fr', {}, [h(doc, 'span', 'lb', {}, [label]), b]);
    };
    const pills = <T extends string>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void): HTMLElement => {
      const p = h(doc, 'div', 'pill', { role: 'radiogroup', 'aria-label': label });
      for (const [v, text] of opts) {
        const b = h(doc, 'button', 'b', { type: 'button', role: 'radio', 'aria-checked': String(get() === v) }, [text]);
        b.addEventListener('click', () => { record(() => set(v)); for (const x of Array.from(p.children)) x.setAttribute('aria-checked', String(x === b)); applySettings(); });
        p.append(b);
      }
      return h(doc, 'div', 'fr', {}, [h(doc, 'span', 'lb', {}, [label]), p]);
    };
    d.body.append(h(doc, 'div', 'fs', {}, [S.appearance]));
    d.body.append(pills(S.appearance, [['light', S.themeLight.split(' ')[0]], ['dark', S.themeDark.split(' ')[0]], ['auto', S.scaleAuto]], () => theme, v => { theme = v; chart.applyOptions({ theme: v } as never); applyTheme(); restyleIndicators(); syncTop(); emit('theme', v); }));
    d.body.append(sw(S.grid, () => settings.grid, v => { settings.grid = v; }));
    d.body.append(sw(S.vertGrid, () => settings.vertGrid, v => { settings.vertGrid = v; }));
    d.body.append(pills(S.crosshair, [['normal', S.crosshairNormal], ['magnet', S.crosshairMagnet], ['hidden', S.crosshairHidden]], () => settings.crosshair, v => { settings.crosshair = v; }));
    d.body.append(sw(S.volume, () => settings.volume, v => { settings.volume = v; }));
    d.body.append(sw(S.sessionBreaks, () => settings.sessionBreaks, v => { settings.sessionBreaks = v; }));
    d.body.append(h(doc, 'div', 'fs', {}, [S.scaleMode]));
    d.body.append(pills(S.scaleMode, [['linear', S.scaleLinear], ['log', S.scaleLog], ['percent', S.scalePercent]], () => settings.scaleMode, v => { settings.scaleMode = v; }));
    d.body.append(sw(S.scaleAutoLong, () => settings.autoScale, v => { settings.autoScale = v; }));
    const zsel = h(doc, 'select', 'f', { 'aria-label': S.timeZone });
    for (const z of ZONES) zsel.append(h(doc, 'option', '', { value: z, selected: z === tz }, [z === 'local' ? S.localZone : z.replace(/_/g, ' ')]));
    zsel.addEventListener('change', () => setZone(zsel.value));
    d.body.append(h(doc, 'div', 'fr', {}, [h(doc, 'span', 'lb', {}, [S.timeZone]), zsel]));
    if (modules.extras || options.load?.extras) {
      d.body.append(h(doc, 'div', 'fs', {}, [S.tooltip]));
      d.body.append(pills(S.tooltip, [['off', S.tooltipOff], ['floating', S.tooltipFloating], ['tracking', S.tooltipTracking], ['magnifier', S.tooltipMagnifier]], () => settings.tooltip, v => { settings.tooltip = v; }));
      d.body.append(sw(S.watermark, () => settings.watermark, v => { settings.watermark = v; }));
    }
    const resetB = btn(doc, { text: S.reset, label: S.reset, onClick: () => { close(); record(() => { settings = { ...defaultSettings(), ...(options.settings ?? {}) }; for (const i of inds) teardownIndicator(i); inds.length = 0; maximised = -1; }); applySettings(); rebuildIndicators(); chart.timeScale().resetTimeScale(); emit('indicators', api.indicators()); } });
    d.foot.append(resetB, btn(doc, { text: S.done, label: S.done, cls: 'on', onClick: () => close() }));
    const close = d.open();
  }

  function openGoTo(opener: HTMLElement): void {
    layers.closeAll(false);
    const m = h(doc, 'div', 'menu', { role: 'dialog', 'aria-label': S.goToDate });
    m.style.setProperty('padding', '10px');
    m.style.setProperty('gap', '8px');
    const last = rows.length ? rows[rows.length - 1].time : Date.now() / 1000;
    const zone = zoneName();
    const dn = zoneDayNumber(zone, last * 1000);
    const iso = new Date(dn * 86_400_000).toISOString().slice(0, 10);
    const dateF = h(doc, 'input', 'f', { type: 'date', value: iso, 'aria-label': S.date, max: iso });
    if (rows.length) dateF.min = new Date(zoneDayNumber(zone, rows[0].time * 1000) * 86_400_000).toISOString().slice(0, 10);
    const intraday = intervalSeconds(interval) < 86_400;
    const timeF = h(doc, 'input', 'f', { type: 'time', value: '12:00', 'aria-label': S.time });
    const go = btn(doc, { text: S.go, label: S.go, cls: 'on' });
    const row = h(doc, 'div', 'fr', {}, [dateF]);
    row.style.setProperty('padding', '0');
    if (intraday) row.append(timeF);
    dateF.style.setProperty('width', '150px');
    timeF.style.setProperty('width', '100px');
    m.append(h(doc, 'div', 'mh', {}, [S.goToDate]), row, go);
    const submit = (): void => {
      const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateF.value);
      if (!md) { dateF.focus(); return; }
      const days = daysFromCivil(+md[1], +md[2], +md[3]);
      let t = intervalSeconds(interval) >= 86_400 ? days * 86_400 : localMidnight(zone, days);
      if (intraday) { const mt = /^(\d{2}):(\d{2})/.exec(timeF.value); if (mt) t += +mt[1] * 3600 + +mt[2] * 60; }
      close();
      goToTime(t);
    };
    go.addEventListener('click', submit);
    m.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') { ev.preventDefault(); submit(); } });
    const sheet = sheets();
    if (!sheet) { m.style.setProperty('visibility', 'hidden'); w.appendChild(m); placePopover(m, opener.getBoundingClientRect(), w.getBoundingClientRect(), 'above'); m.style.removeProperty('visibility'); }
    const close = layers.push(m, { kind: 'dialog', opener, sheet, focus: dateF });
  }

  function goToTime(t: number): void {
    const ts = chart.timeScale();
    const l = ts.timeToLogical(t);
    const r = ts.getVisibleLogicalRange();
    if (l === null || !r) return;
    const span = Math.max(20, r.to - r.from);
    programmatic = Date.now() + 300;
    rangeKey = null;
    ts.setVisibleLogicalRange({ from: l - span / 2, to: l + span / 2 });
    syncBottom();
    live.textContent = `${S.goToDate}: ${new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ')}`;
    // A feed with older history: fetch it when the date is before the first bar.
    if (feed && rows.length && t < rows[0].time) {
      const need = Math.ceil((rows[rows.length - 1].time - t) / (intervalSeconds(interval) || 86_400)) + 200;
      void loadData(Math.min(5000, need)).then(() => { const l2 = ts.timeToLogical(t); if (l2 !== null) { programmatic = Date.now() + 300; ts.setVisibleLogicalRange({ from: l2 - span / 2, to: l2 + span / 2 }); } });
    }
  }

  function setZone(z: string): void {
    if (z !== 'local' && !isValidTimeZone(z)) return;
    record(() => { tz = z; chart.applyOptions({ timeScale: { timeZone: z } } as never); });
    tickClock(true);
    schedulePersist();
  }

  // ── full screen ──
  let pseudo = false;
  const isFullscreen = (): boolean => pseudo || doc.fullscreenElement === host;
  function toggleFullscreen(): void {
    if (isFullscreen()) {
      if (pseudo) { pseudo = false; w.classList.remove('pseudo'); syncTop(); }
      else void doc.exitFullscreen?.().catch(() => {});
      return;
    }
    const req = host.requestFullscreen?.bind(host);
    if (req) req().catch(() => { pseudo = true; w.classList.add('pseudo'); syncTop(); });
    else { pseudo = true; w.classList.add('pseudo'); syncTop(); }
  }
  listen(doc, 'fullscreenchange', () => { syncTop(); win.requestAnimationFrame(() => { relayout(); chart.paint(); }); });

  // ── screenshot: the chart canvases plus the legend text, painted on one canvas ──
  async function screenshot(download: boolean): Promise<Blob | null> {
    const src = chart.takeScreenshot();
    const cssW = plot.clientWidth || 1;
    const ratio = src.width / cssW;
    const out = doc.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    const c = colors();
    ctx.fillStyle = c.background;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    ctx.scale(ratio, ratio);
    const font = chart.options().fontFamily;
    const fs = chart.options().fontSize;
    // Line 1: symbol, interval and the last bar, as the legend shows it.
    const lb = rows[rows.length - 1];
    const left = chart.priceScale('left').width() + 12;
    ctx.textBaseline = 'middle';
    let x = left;
    const put = (t: string, color: string, weight = 400): void => { ctx.font = `${weight} ${fs}px ${font}`; ctx.fillStyle = color; ctx.fillText(t, x, 6 + 11); x += ctx.measureText(t).width; };
    // The chart's own legend is DOM: paint its line here (symbol, interval, OHLC).
    ctx.fillStyle = alpha(c.background, 0.92);
    ctx.fillRect(left - 6, 6, Math.min(cssW - left, 560), 22);
    put(`${symbol.symbol} · ${interval}`, c.text, 600);
    if (lb) {
      put(`   O ${formatValue(lb.open)}  H ${formatValue(lb.high)}  L ${formatValue(lb.low)}  C ${formatValue(lb.close)}`, c.mutedText);
      const prev = rows[rows.length - 2];
      if (prev) { const ch = lb.close - prev.close; put(`  ${ch >= 0 ? '+' : MINUS_SIGN}${formatValue(Math.abs(ch))} (${ch >= 0 ? '+' : MINUS_SIGN}${(Math.abs(ch) / prev.close * 100).toFixed(2)}%)`, ch >= 0 ? c.upText : c.downText); }
    }
    // Indicator rows at their places.
    const cardBox = card.getBoundingClientRect();
    for (const ind of inds) {
      if (!ind.row || !ind.row.isConnected || ind.row.offsetParent === null) continue;
      const r = ind.row.getBoundingClientRect();
      x = r.left - cardBox.left + 6;
      const y = r.top - cardBox.top;
      ctx.fillStyle = alpha(c.background, 0.86);
      ctx.fillRect(r.left - cardBox.left, y, Math.min(r.width, 420), r.height);
      ctx.font = `600 ${fs}px ${font}`;
      ctx.fillStyle = c.text;
      const name = legendLabel(ind.spec, ind.params);
      ctx.fillText(name, x + 14, y + r.height / 2);
      ctx.fillStyle = ind.styles[ind.spec.outputs[0]?.key ?? '']?.color ?? c.line;
      ctx.beginPath(); ctx.arc(x + 4, y + r.height / 2, 4, 0, Math.PI * 2); ctx.fill();
      x += 14 + ctx.measureText(name).width + 8;
      ctx.font = `400 ${fs}px ${font}`;
      for (const [key, el] of ind.values) { if (!el.textContent) continue; ctx.fillStyle = ind.styles[key]?.color ?? c.mutedText; ctx.fillText(el.textContent, x, y + r.height / 2); x += ctx.measureText(el.textContent).width + 8; }
    }
    const blob = await new Promise<Blob | null>(res => { try { out.toBlob(b => res(b), 'image/png'); } catch { res(null); } });
    if (blob && download) {
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      a.href = url;
      a.download = `${(symbol.symbol || 'chart').replace(/[^\w.-]+/g, '_')}-${interval}-${stamp}.png`;
      a.rel = 'noopener';
      shadow.appendChild(a);
      a.click();
      a.remove();
      later(() => URL.revokeObjectURL(url), 4000);
    }
    return blob;
  }

  // ── keyboard shortcuts (none clash with the chart's arrows, + - Home End Enter Space Escape, or the drawing keys) ──
  let digits = '';
  let digitTimer: ReturnType<typeof setTimeout> | null = null;
  let tipEl: HTMLElement | null = null;
  function showTip(text: string | null): void {
    tipEl?.remove(); tipEl = null;
    if (!text) return;
    tipEl = h(doc, 'div', 'tip', { 'aria-hidden': 'true' }, [text]);
    card.appendChild(tipEl);
    live.textContent = text;
  }
  function shortcut(e: KeyboardEvent, fromChart: boolean): boolean {
    const t = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return false;
    if (layers.open) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) { if (e.shiftKey) void redo(); else void undo(); return true; }
    if (mod && !e.altKey && (e.key === 'y' || e.key === 'Y')) { void redo(); return true; }
    if (e.altKey && !mod && e.code === 'KeyI') { openIndicators(indBtn.isConnected && !indBtn.classList.contains('hide') ? indBtn : moreBtn); return true; }
    if (e.altKey && !mod && e.code === 'KeyS') { void api.screenshot(true); return true; }
    if (mod || e.altKey) return false;
    if (e.key === '/' && canSearch()) { openSymbolSearch(symBtn, ''); return true; }
    if (e.key === ',') { openIntervalMenu(ivMore.classList.contains('hide') ? moreBtn : ivMore); return true; }
    if (/^[0-9]$/.test(e.key)) {
      digits = (digits + e.key).slice(-4);
      if (digitTimer) clearTimeout(digitTimer);
      digitTimer = later(() => { digits = ''; showTip(null); }, 2500);
      showTip(fill(S.typeInterval, intervalFromDigits(digits) ?? digits));
      return true;
    }
    if (e.key === 'Enter' && digits) {
      const iv = intervalFromDigits(digits);
      digits = '';
      showTip(null);
      if (iv) { const pick = liveOpt || feed ? nearestInterval(iv, liveOpt ? LIVE_INTERVALS : intervals) : iv; if (pick) void api.setInterval(pick); }
      return true;
    }
    if (e.key === 'Escape' && digits) { digits = ''; showTip(null); return true; }
    // Letters open the symbol search, except on the chart while the drawing tools own the letter keys.
    if (canSearch() && e.key.length === 1 && /[a-z]/i.test(e.key) && !e.shiftKey && !(fromChart && tools)) { openSymbolSearch(symBtn, e.key); return true; }
    return false;
  }
  const removeKeyHandler = chart.addPointerHandler({ keyDown: e => shortcut(e, true) });
  cleanups.push(removeKeyHandler);
  listen(w, 'keydown', ev => {
    const e = ev as KeyboardEvent;
    if (chart.element().contains(e.target as Node) && e.target !== w) { /* the chart's handler ran first */ if (e.defaultPrevented) return; }
    if ((e.composedPath?.() ?? []).includes(chart.element())) return;
    if (shortcut(e, false)) e.preventDefault();
  });
  listen(w, 'pointerdown', ev => layers.pointerDown((ev as PointerEvent).composedPath()));

  // ── the API ──
  const api: Widget = {
    chart,
    element: host,
    async setSymbol(s) {
      const next: SymbolInfo = typeof s === 'string' ? { symbol: s, description: CRYPTO_SYMBOLS.find(c => c.symbol === s)?.description } : { ...s };
      if (!next.symbol || next.symbol === symbol.symbol) return;
      record(() => { symbol = next; });
      chart.applyOptions({ ariaLabel: fill(S.chartLabel, symbol.symbol) } as never);
      for (const c of [...compareSyms]) if (c.symbol === symbol.symbol) removeCompare(c.symbol);
      syncTop();
      relayout();
      emit('symbol', { ...symbol });
      if (liveOpt && liveHandle && !demo) { showOverlay('loading'); rows = []; loadToken++; await startLive(); }
      else if (liveOpt) await startLive();
      else if (feed) await loadData();
      else buildMain();
      void syncExtras();
    },
    async setInterval(iv) {
      const n = normalizeInterval(iv);
      if (!n || n === interval) return;
      record(() => { interval = n; });
      syncTop();
      emit('interval', interval);
      if (liveOpt) { loadToken++; await startLive(); }
      else if (feed) await loadData();
      void syncExtras();
    },
    setChartType(id) {
      if (id === chartType || !chartTypes().some(c => c.id === id)) return;
      record(() => { chartType = id; buildMain(); if (tools) { dropTools(); if (drawingsOn) void ensureTools(); } for (const ind of inds) if (ind.band && main) { main.attachPrimitive(ind.band); } });
      syncTop();
      emit('chartType', chartType);
    },
    addIndicator(id, params, state) {
      const spec = catalog.find(s => s.id === id);
      if (!spec) throw new RangeError(`Chartist Lite: unknown indicator "${id}"; see INDICATORS in the indicators catalog`);
      let ind: Ind | null = null;
      record(() => { ind = addIndicatorRaw(spec, { ...(state ?? {}), params: (params ?? {}) as IndicatorState['params'] }); if (ind.placement === 'pane') rebuildIndicators(); else { buildIndicator(ind); renderLegend(); } });
      emit('indicators', api.indicators());
      return (ind as unknown as Ind).handle;
    },
    removeIndicator(hd) {
      const uid = typeof hd === 'string' ? hd : hd.uid;
      const ind = inds.find(i => i.uid === uid || (typeof hd === 'string' && i.spec.id === hd));
      if (!ind) return;
      record(() => { teardownIndicator(ind); inds.splice(inds.indexOf(ind), 1); maximised = -1; rebuildIndicators(); });
      emit('indicators', api.indicators());
    },
    indicators: () => inds.map(i => i.handle),
    setTheme(t) {
      if (t !== 'light' && t !== 'dark' && t !== 'auto') return;
      record(() => { theme = t; });
      chart.applyOptions({ theme: t } as never);
      applyTheme();
      restyleIndicators();
      syncTop();
      emit('theme', t);
    },
    async setRange(key) {
      const span = parseSpan(key);
      if (!span) throw new RangeError(`Chartist Lite: unknown range "${key}"`);
      rangeKey = key;
      syncBottom();
      const avail = liveOpt ? LIVE_INTERVALS : feed ? (feed.intervals?.length ? sortIntervals(feed.intervals) : intervals) : null;
      if (avail) {
        const iv = intervalForSpan(key, avail);
        if (iv && iv !== interval) {
          interval = iv;
          syncTop();
          emit('interval', interval);
          if (liveOpt) { loadToken++; await startLive(); return; }
          await loadData();
          return;
        }
        if (feed && rows.length) {
          const need = barsForSpan(key, interval, rows[rows.length - 1].time);
          if (need > rows.length * 1.2 && rows.length < 5000) { await loadData(need); return; }
        }
      }
      programmatic = Date.now() + 300;
      if (key === 'All') chart.timeScale().fitContent();
      else chart.timeScale().setVisibleSpan(key);
      live.textContent = `${S.ranges} ${key}`;
    },
    setData(list) { setRows(toBars(list)); },
    save: () => snapshot(),
    async load(json) {
      const ws = readWorkspace(json, catalog, snapshot());
      if (!ws) throw new TypeError('Chartist Lite: that is not a saved widget workspace');
      record(() => {});
      await applyWorkspace(ws, true);
      emit('indicators', api.indicators());
    },
    on(event, fn) {
      let set = handlers.get(event);
      if (!set) { set = new Set(); handlers.set(event, set); }
      set.add(fn);
      if (event === 'ready' && ready) { try { fn({ chart }); } catch { /* host */ } }
      return () => { set?.delete(fn); };
    },
    screenshot: (download = true) => screenshot(download),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      layers.closeAll(false);
      liveHandle?.disconnect(); liveHandle = null;
      feedUnsub?.(); feedUnsub = null;
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const k of ['tooltip', 'watermark'] as const) { const hd = extraHandles[k]; if (hd) { try { (hd.remove ?? hd.destroy)?.call(hd); } catch { /* ignore */ } } }
      extraHandles = {};
      tools?.destroy(); tools = null;
      for (const f of cleanups) { try { f(); } catch { /* keep going */ } }
      cleanups.length = 0;
      chart.unsubscribeCrosshairMove(onCross);
      chart.timeScale().unsubscribeRealTimeChange(onRT);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
      if (doc.fullscreenElement === host) void doc.exitFullscreen?.().catch(() => {});
      host.remove();
      handlers.clear();
      inds.length = 0;
    },
  };

  // ── start ──
  applyTheme();
  applyCoarse();
  // A saved workspace (opt-in) wins over the options.
  let restored: WorkspaceJSON | null = null;
  if (options.persist) {
    try { const raw = storage()?.getItem(STORE_PREFIX + options.persist.key); if (raw) restored = readWorkspace(raw, catalog, snapshot()); } catch { restored = null; }
  }
  if (restored) {
    symbol = restored.symbol; interval = restored.interval; chartType = restored.chartType; theme = restored.theme; tz = restored.timeZone; settings = restored.settings;
    if (restored.drawings) { drawingsJSON = restored.drawings; drawingsOn = true; }
    chart.applyOptions({ theme, timeScale: { timeZone: tz } } as never);
    applyTheme();
    for (const st of restored.indicators) { const spec = catalog.find(s => s.id === st.id); if (spec) addIndicatorRaw(spec, st); }
  } else {
    for (const it of options.indicators ?? []) {
      const st = typeof it === 'string' ? { id: it } : it;
      const spec = catalog.find(s => s.id === st.id);
      if (spec) addIndicatorRaw(spec, st);
    }
  }
  buildIntervalKeys();
  syncTop();
  syncBottom();
  relayout();
  buildMain();
  rebuildIndicators();
  applySettings();
  void (async () => {
    // Chart types of the transforms entry, when it is to be loaded.
    if (!modules.transforms && options.load?.transforms) { await getModule('transforms'); if (!destroyed) { syncTop(); if (chartType !== 'candles') buildMain(); } }
    await loadData();
    if (destroyed) return;
    if (restored) for (const s of restored.compare) addCompare(s);
    if (drawingsOn) await ensureTools();
    relayout();
  })().catch(e => { if (!destroyed) { showOverlay('error', e instanceof Error ? e.message : String(e)); emit('error', e); } });
  return api;
}
