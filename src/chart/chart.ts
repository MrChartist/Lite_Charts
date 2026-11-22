// The chart: DOM, state, the paint scheduler and the two painters. See ARCHITECTURE.md "Render pipeline".
//
// Two canvases cover the whole chart. MAIN holds the grid, series, primitives and axes and is repainted only when
// data, scales, size or options change. OVERLAY holds the crosshair, its axis tags and focus ring, and is the only
// thing repainted on a pointer move. Every invalidation is coalesced into one requestAnimationFrame.
//
// Panes are stacked vertically and share the time axis (at the bottom), the plot's left and right edges and the
// crosshair's vertical line. Each pane has its own price scales ('right', 'left', overlays).

import type {
  AnySeriesDefinition, ChartApi, ChartPointerEvent, ChartPointerHandler, LogicalRangeChangeHandler, MouseEventHandler, MouseEventParams, PaneApi, PriceScaleApi,
  SeriesApi, TimeRange, TimeScaleApi,
} from '../api';
import { formatPercent, formatPrice, formatStamp, resolvePriceFormat } from '../core/format';
import { defaultChartOptions, mergeInto, MIN_FONT_SIZE, touchActionFor, type ChartOptions, type ChartTimeScaleOptions, type DeepPartial } from '../core/options';
import { darkTheme, lightTheme, readableTextOn, type ThemeColors } from '../core/theme';
import { timeToSeconds, type Time } from '../core/time';
import { TimeIndex } from '../core/time-index';
import { isValidTimeZone, localTimeZone, weekdayOfDay } from '../core/zone';
import { parseSpan, spanFirstIndex, type Span, type SpanInput } from '../core/span';
import type { ChartPrimitive, PrimitiveDrawScope } from '../plugins/primitive';
import { CanvasLayer } from '../render/canvas';
import { css, cssReset } from '../render/dom';
import { decimateColumns } from '../render/decimate';
import { TextPainter } from '../render/text';
import { priceTicks, type PriceTick } from '../scales/price-ticks';
import { PriceScaleModel, type PriceScaleOptions } from '../scales/price-scale';
import { planTimeTicks, tickWeight, type TimeTick } from '../scales/time-ticks';
import { TimeScaleModel, type LogicalRange } from '../scales/time-scale';
import type { RowBase, SeriesCommonOptions, SeriesDefinition, SeriesDrawScope } from '../series/definition';
import { OFF, SeriesModel } from '../series/series-model';
import { InputController, type HitArea, type InputTarget } from './input';
import { describeRow, isOhlc, LegendBox, type LegendEntry } from './legend';
import { layoutPanes, moveSeparator, paneAt, stretchForHeight } from './pane-layout';

const OVERLAY = 1;
const MAIN = 2;
const LAYOUT = 4;

const AXIS_PAD = 8;
/** CSS px between two panes (a line is drawn in it). */
const SEPARATOR = 1;
const MIN_PANE = 32;
const ATTRIBUTION_URL = 'https://mrchartist.com';

type AnyModel = SeriesModel<RowBase, object>;
type Side = 'left' | 'right';

interface Tag { y: number; text: string; fill: string; color: string; pinned: boolean }

interface Pane {
  scales: Map<string, PriceScaleModel>;
  stretch: number;
  top: number;
  height: number;
  prims: ChartPrimitive[];
  ticks: Record<Side, PriceTick[]>;
  tags: Record<Side, Tag[]>;
  shown: Record<Side, boolean>;
  divider: HTMLDivElement | null;
  legend: LegendBox | null;
}

let uid = 0;
/** Scratch [low, high] for SeriesModel.extents (no allocation per frame). */
const ext = new Float64Array(2);

/** A view request made before the chart had a width or data; applied by the first layout that can. */
type PendingView = { kind: 'fit' } | { kind: 'logical'; range: LogicalRange } | { kind: 'time'; range: TimeRange } | { kind: 'span'; span: Span };

function commonDefaults(): SeriesCommonOptions {
  return {
    priceScaleId: 'right', visible: true, lastValueVisible: true, priceLineVisible: true,
    priceFormat: { precision: 2, minMove: 0.01 }, title: '',
  };
}

function clone<T extends object>(o: T): T {
  return mergeInto({} as T, o);
}

function hideVisually(el: { style: CSSStyleDeclaration }): void {
  cssReset(el, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', 'clip-path': 'inset(50%)', 'white-space': 'nowrap', margin: '-1px' });
}

/** Series options with the price format resolved (minMove alone sets the precision; see `resolvePriceFormat`). */
function withPriceFormat(options: object, given: unknown): void {
  const pf = (given as { priceFormat?: { precision?: unknown; minMove?: unknown } } | undefined)?.priceFormat;
  if (!pf) return;
  (options as SeriesCommonOptions).priceFormat = resolvePriceFormat(pf);
}

class SeriesHandle<D extends AnySeriesDefinition> implements SeriesApi<D> {
  constructor(private chart: Chart, readonly model: AnyModel) {}
  seriesType(): string { return this.model.def.type; }
  private subs = new Set<(kind: 'set' | 'update', row?: unknown) => void>();
  setData(data: readonly unknown[]): void { this.chart.setSeriesData(this.model, data as never); this.emit('set'); }
  update(row: unknown, o?: { append?: boolean }): void { this.chart.updateSeries(this.model, row as never, !!o?.append); this.emit('update', row); }
  pop(n = 1): void { this.chart.popSeries(this.model, n); this.emit('set'); }
  private emit(kind: 'set' | 'update', row?: unknown): void { for (const f of this.subs) { try { f(kind, row); } catch { /* a plugin's handler */ } } }
  subscribeDataChanged(f: (kind: 'set' | 'update', row?: unknown) => void): void { this.subs.add(f); }
  unsubscribeDataChanged(f: (kind: 'set' | 'update', row?: unknown) => void): void { this.subs.delete(f); }
  data(): never[] { return this.model.data() as never[]; }
  applyOptions(options: object): void {
    mergeInto(this.model.options, options);
    this.model.invalidateExtents();
    withPriceFormat(this.model.options, options);
    this.chart.scaleFor(this.model);
    this.chart.invalidate(LAYOUT | MAIN | OVERLAY);
  }
  options(): never { return this.model.options as never; }
  priceScale(): PriceScaleApi { return this.chart.priceScale(this.model.options.priceScaleId, this.model.paneIndex); }
  priceToCoordinate(price: number): number | null {
    const y = this.chart.scaleFor(this.model).priceToY(price);
    return Number.isFinite(y) ? y : null;
  }
  coordinateToPrice(y: number): number | null {
    const p = this.chart.scaleFor(this.model).yToPrice(y);
    return Number.isFinite(p) ? p : null;
  }
  attachPrimitive(p: ChartPrimitive): void { this.chart.attachTo(this.model.primitives, p, this); }
  detachPrimitive(p: ChartPrimitive): void { this.chart.detachFrom(this.model.primitives, p); }
  paneIndex(): number { return this.model.paneIndex; }
  moveToPane(i: number): void { this.chart.moveSeries(this.model, i); }
}

export class Chart implements ChartApi, InputTarget {
  readonly root: HTMLDivElement;
  readonly win: Window;
  private doc: Document;
  private container: HTMLElement;
  private opts: ChartOptions;
  private main: CanvasLayer;
  private top: CanvasLayer;
  private mainText: TextPainter;
  private topText: TextPainter;
  private link: HTMLAnchorElement | null = null;
  private live: HTMLDivElement;
  private input: InputController;

  readonly index = new TimeIndex();
  readonly ts: TimeScaleModel;
  private paneList: Pane[] = [];
  private series: AnyModel[] = [];
  private handles = new Map<AnyModel, SeriesHandle<AnySeriesDefinition>>();

  private cssW = 0;
  private cssH = 0;
  private plotL = 0;
  private plotW = 0;
  private leftW = 0;
  private rightW = 0;
  private panesH = 0;
  private timeH = 0;
  private colors: ThemeColors = { ...lightTheme };
  private timeTicks: TimeTick[] = [];
  private needsInitialView = true;
  private lastRange: LogicalRange | null = null;

  /** x: plot-relative, y: pane-relative, CSS px. */
  private cross: { x: number; y: number; slot: number; pane: number } | null = null;
  private inspect = false;
  private drag: { pane: number; side: Side } = { pane: 0, side: 'right' };
  private dirty = 0;
  private raf = 0;
  private removed = false;
  private crossSubs = new Set<MouseEventHandler>();
  private clickSubs = new Set<MouseEventHandler>();
  private rangeSubs = new Set<LogicalRangeChangeHandler>();
  private rtSubs = new Set<(atRealTime: boolean) => void>();
  private removeSubs = new Set<() => void>();
  private lastRT = true;
  private cleanups: (() => void)[] = [];
  /** Price-scale options a NEW pane starts from: the chart's creation options plus later chart-level patches only. */
  private paneScaleDefaults!: { right: PriceScaleOptions; left: PriceScaleOptions };
  private pendingView: PendingView | null = null;
  private handlers: ChartPointerHandler[] = [];
  private forcedCursor: string | null = null;
  private rootCursor = '';
  private linkAnchor: HTMLAnchorElement | null = null;
  private darkQuery: MediaQueryList | null = null;
  private motionQuery: MediaQueryList | null = null;

  constructor(container: HTMLElement, options?: DeepPartial<ChartOptions>) {
    this.container = container;
    this.doc = container.ownerDocument;
    const win = this.doc.defaultView;
    if (!win) throw new Error('Chartist Lite: the container is not in a window');
    this.win = win;
    this.opts = defaultChartOptions();
    this.applyOptionPatch(options);
    this.paneScaleDefaults = { right: clone(this.opts.rightPriceScale), left: clone(this.opts.leftPriceScale) };
    this.ts = new TimeScaleModel(this.opts.timeScale);
    this.index.setZone(this.zone());

    const root = this.doc.createElement('div');
    cssReset(root, {
      position: 'relative', overflow: 'hidden', display: 'block', 'user-select': 'none', '-webkit-user-select': 'none',
      '-webkit-tap-highlight-color': 'transparent', direction: 'ltr', 'text-align': 'left',
    });
    // The canvases place text runs left to right themselves: an RTL page must not flip them.
    root.setAttribute('dir', 'ltr');
    root.tabIndex = 0;
    root.setAttribute('role', 'application');
    root.setAttribute('aria-roledescription', 'chart');
    this.root = root;
    this.main = new CanvasLayer(this.doc, () => this.invalidate(LAYOUT | MAIN | OVERLAY));
    this.top = new CanvasLayer(this.doc, () => this.invalidate(LAYOUT | MAIN | OVERLAY));
    root.appendChild(this.main.canvas);
    root.appendChild(this.top.canvas);
    this.mainText = new TextPainter(this.main.ctx);
    this.topText = new TextPainter(this.top.ctx);

    // Screen-reader help and the polite live region that reads the inspected bar.
    // A random part as well: two copies of the library on one page each count from 1.
    const id = `chartist-lite-${++uid}-${Math.random().toString(36).slice(2, 8)}`;
    const help = this.doc.createElement('div');
    help.id = `${id}-help`;
    hideVisually(help);
    root.appendChild(help);
    root.setAttribute('aria-describedby', help.id);
    this.live = this.doc.createElement('div');
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('aria-atomic', 'true');
    hideVisually(this.live);
    root.appendChild(this.live);
    container.appendChild(root);

    this.paneList.push(this.newPane(0));

    this.darkQuery = win.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    this.motionQuery = win.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    if (this.darkQuery) {
      const onScheme = (): void => { if (this.opts.theme === 'auto') this.invalidate(LAYOUT | MAIN | OVERLAY); };
      this.darkQuery.addEventListener?.('change', onScheme);
      this.cleanups.push(() => this.darkQuery?.removeEventListener?.('change', onScheme));
    }
    const RO = (win as Window & typeof globalThis).ResizeObserver;
    if (RO) {
      const ro = new RO(() => { if (this.opts.autoSize) this.invalidate(LAYOUT | MAIN | OVERLAY); });
      ro.observe(container);
      this.cleanups.push(() => ro.disconnect());
    }
    this.watchPixelRatio();
    this.input = new InputController(this);
    this.syncDom();
    this.invalidate(LAYOUT | MAIN | OVERLAY);
  }

  // ── options ──

  private applyOptionPatch(patch: unknown): void {
    if (patch && typeof patch === 'object') {
      const p = { ...(patch as Record<string, unknown>) };
      if (typeof p.attribution === 'boolean') p.attribution = { visible: p.attribution };
      if (typeof p.legend === 'boolean') p.legend = { visible: p.legend };
      mergeInto(this.opts, p);
    }
    this.opts.fontSize = Math.max(MIN_FONT_SIZE, Number(this.opts.fontSize) || MIN_FONT_SIZE);
    const tz = this.opts.timeScale.timeZone;
    if (tz !== 'local' && !isValidTimeZone(tz)) {
      throw new RangeError(`Chartist Lite: unknown time zone "${tz}"`);
    }
  }

  private zone(): string {
    const tz = this.opts.timeScale.timeZone;
    return tz === 'local' ? localTimeZone() : tz;
  }

  applyOptions(patch: DeepPartial<ChartOptions> & { attribution?: unknown }): void {
    const ts = (patch as { timeScale?: Partial<ChartTimeScaleOptions> }).timeScale;
    this.applyOptionPatch(patch);
    const p = patch as { rightPriceScale?: unknown; leftPriceScale?: unknown };
    if (p.rightPriceScale) mergeInto(this.paneScaleDefaults.right, p.rightPriceScale);
    if (p.leftPriceScale) mergeInto(this.paneScaleDefaults.left, p.leftPriceScale);
    if (ts?.barSpacing !== undefined) this.ts.barSpacing = this.opts.timeScale.barSpacing;
    if (ts?.rightOffset !== undefined) this.ts.rightOffset = this.opts.timeScale.rightOffset;
    if (this.index.setZone(this.zone())) this.cross = null;
    this.syncDom();
    this.invalidate(LAYOUT | MAIN | OVERLAY);
  }

  options(): Readonly<ChartOptions> { return this.opts; }

  private resolveColors(): void {
    const dark = this.opts.theme === 'dark' || (this.opts.theme === 'auto' && !!this.darkQuery?.matches);
    this.colors = { ...(dark ? darkTheme : lightTheme), ...this.opts.colors };
  }

  private syncDom(): void {
    const o = this.opts;
    this.root.setAttribute('aria-label', o.ariaLabel);
    const help = this.root.querySelector(`#${CSS_ESCAPE(this.root.getAttribute('aria-describedby') ?? '')}`);
    if (help) help.textContent = o.ariaDescription;
    css(this.root, {
      width: o.autoSize ? '100%' : `${o.width}px`,
      height: o.autoSize ? '100%' : `${o.height}px`,
      'touch-action': this.handlers.some(h => h.blocksTouch?.()) ? 'none' : touchActionFor(o.interaction),
    });
    if (o.attribution.visible && !this.link) this.makeLink();
    else if (!o.attribution.visible && this.link) {
      this.link.remove();
      this.link = null;
      this.linkAnchor = null;
    }
  }

  /**
   * The attribution link. It lives in a closed shadow root on a small host, so the page's `a {}` / `a::after {}`
   * rules cannot restyle it; every style is a CSSOM write (CSP-safe). Pointer input on it is left to the browser
   * (see `isLink`), so a click opens it.
   */
  private makeLink(): void {
    const host = this.doc.createElement('span');
    cssReset(host, { position: 'absolute', 'z-index': '1', display: 'block', width: 'auto', height: 'auto' });
    host.setAttribute('data-chartist-attribution', '');
    const a = this.doc.createElement('a');
    a.href = ATTRIBUTION_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Chartist';
    a.title = 'Chart by Chartist Lite';
    cssReset(a, {
      display: 'block', position: 'static', padding: '2px 4px', 'border-radius': '4px', 'line-height': '16px',
      opacity: '0.75', cursor: 'pointer', 'white-space': 'nowrap', 'pointer-events': 'auto',
    });
    let root: ShadowRoot | null = null;
    try { root = host.attachShadow({ mode: 'closed' }); } catch { root = null; }
    if (root) root.appendChild(a); else host.appendChild(a);
    this.root.appendChild(host);
    this.link = host as unknown as HTMLAnchorElement;
    this.linkAnchor = a;
  }

  /** True for an event target that is the attribution link (or its host): input leaves it to the browser. */
  isLink(target: EventTarget | null): boolean {
    if (!!this.link && (target === this.link || target === this.linkAnchor)) return true;
    // The legend too: a press there selects its text instead of panning.
    return this.paneList.some(p => p.legend !== null && target === p.legend.host);
  }

  private placeLink(): void {
    const host = this.link;
    const a = this.linkAnchor;
    if (!host || !a) return;
    const p0 = this.paneList[0];
    css(a, { font: `400 ${MIN_FONT_SIZE}px ${this.opts.fontFamily}`, color: this.colors.mutedText });
    const pos = this.opts.attribution.position;
    const inset = 6;
    const box: Record<string, string> = { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto' };
    if (pos === 'axis-corner' && (this.rightW > 0 || this.leftW > 0) && this.timeH > 0) {
      // The empty cell under a price axis, beside the time axis: it never covers data.
      if (this.rightW > 0) box.right = '2px'; else box.left = '2px';
      box.top = `${this.panesH + Math.max(0, (this.timeH - 20) / 2)}px`;
    } else {
      if (pos.endsWith('right')) box.right = `${this.rightW + inset}px`; else box.left = `${this.plotL + inset}px`;
      if (pos.startsWith('top')) box.top = `${p0.top + inset}px`; else box.bottom = `${this.cssH - (p0.top + p0.height) + inset}px`;
    }
    css(host, box);
  }

  private watchPixelRatio(): void {
    let mq: MediaQueryList | null = null;
    const listen = (): void => {
      mq = this.win.matchMedia?.(`(resolution: ${this.win.devicePixelRatio || 1}dppx)`) ?? null;
      mq?.addEventListener?.('change', onChange, { once: true });
    };
    const onChange = (): void => {
      if (this.removed) return;
      this.invalidate(LAYOUT | MAIN | OVERLAY);
      listen();
    };
    listen();
    this.cleanups.push(() => mq?.removeEventListener?.('change', onChange));
  }

  // ── scheduling ──

  invalidate(mask: number): void {
    if (this.removed) return;
    this.dirty |= mask;
    if (!this.raf) this.raf = this.win.requestAnimationFrame(() => this.frame());
  }

  paint(): void {
    if (this.raf) { this.win.cancelAnimationFrame(this.raf); this.raf = 0; }
    this.dirty |= LAYOUT | MAIN | OVERLAY;
    this.frame();
  }

  private frame(): void {
    this.raf = 0;
    if (this.removed) return;
    const m = this.dirty;
    this.dirty = 0;
    if (m & LAYOUT) this.measure();
    if (m & (MAIN | LAYOUT)) this.paintMain();
    if (m) this.paintOverlay();
    if (m) this.syncLegends();
  }

  private measure(): void {
    this.resolveColors();
    const w = this.opts.autoSize ? this.container.clientWidth : this.opts.width;
    const h = this.opts.autoSize ? this.container.clientHeight : this.opts.height;
    this.cssW = Math.max(0, Math.floor(w));
    this.cssH = Math.max(0, Math.floor(h));
    const dpr = this.win.devicePixelRatio || 1;
    this.main.resize(this.cssW, this.cssH, dpr);
    this.top.resize(this.cssW, this.cssH, dpr);
    this.mainText.setFont(this.opts.fontFamily, this.opts.fontSize);
    this.topText.setFont(this.opts.fontFamily, this.opts.fontSize);
  }

  // ── panes ──

  private newPane(index: number): Pane {
    const scales = new Map<string, PriceScaleModel>();
    // Pane 0 IS the chart's rightPriceScale / leftPriceScale; a later pane starts from the creation-time options
    // (plus chart-level patches), never from what pane 0 became at run time (log mode, autoscale off after a drag).
    scales.set('right', new PriceScaleModel('right', index === 0 ? this.opts.rightPriceScale : clone(this.paneScaleDefaults.right)));
    scales.set('left', new PriceScaleModel('left', index === 0 ? this.opts.leftPriceScale : clone(this.paneScaleDefaults.left)));
    const pane: Pane = {
      scales, stretch: index === 0 ? 3 : 1, top: 0, height: 0, prims: [],
      ticks: { left: [], right: [] }, tags: { left: [], right: [] }, shown: { left: false, right: false }, divider: null, legend: null,
    };
    if (index > 0) pane.divider = this.makeDivider();
    return pane;
  }

  /** A keyboard-reachable separator above a pane: drag or arrow keys move it. */
  private makeDivider(): HTMLDivElement {
    const d = this.doc.createElement('div');
    d.tabIndex = 0;
    d.setAttribute('role', 'separator');
    d.setAttribute('aria-orientation', 'horizontal');
    d.setAttribute('aria-label', 'Resize panes');
    d.setAttribute('aria-valuemin', '0');
    d.setAttribute('aria-valuemax', '100');
    cssReset(d, { position: 'absolute', left: '0', height: '11px', cursor: 'row-resize', 'z-index': '2', 'touch-action': 'none', 'border-radius': '4px', display: 'block' });
    const indexOf = (): number => this.paneList.findIndex(p => p.divider === d);
    let start: { y: number; heights: number[] } | null = null;
    const stop = (e: Event): void => e.stopPropagation();
    d.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      try { d.setPointerCapture(e.pointerId); } catch { /* best effort */ }
      start = { y: e.clientY, heights: this.paneList.map(p => p.height) };
    });
    d.addEventListener('pointermove', e => {
      e.stopPropagation();
      if (!start) return;
      this.applyHeights(moveSeparator(start.heights, indexOf() - 1, e.clientY - start.y, MIN_PANE));
    });
    const end = (e: PointerEvent): void => { e.stopPropagation(); start = null; };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('dblclick', stop);
    d.addEventListener('wheel', stop);
    d.addEventListener('keydown', e => {
      const step = e.shiftKey ? 40 : 8;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (!dy) return;
      e.preventDefault();
      e.stopPropagation();
      this.applyHeights(moveSeparator(this.paneList.map(p => p.height), indexOf() - 1, dy, MIN_PANE));
    });
    const ring = (): void => {
      css(d, { 'box-shadow': focusVisibleOn(d) ? `inset 0 0 0 2px ${this.colors.focusRing}` : 'none' });
    };
    d.addEventListener('focus', ring);
    d.addEventListener('blur', ring);
    this.root.appendChild(d);
    return d;
  }

  /** Set pane heights in px: the stretch factors become the heights, so proportions survive a resize. */
  private applyHeights(heights: number[]): void {
    heights.forEach((h, i) => { if (this.paneList[i]) this.paneList[i].stretch = Math.max(1, h); });
    this.invalidate(LAYOUT | MAIN | OVERLAY);
  }

  private paneOf(i: number): Pane {
    return this.paneList[Math.max(0, Math.min(this.paneList.length - 1, i))];
  }

  /** Pane index for a requested index: an index past the last pane adds one pane. */
  private claimPane(i: number): number {
    const want = Number.isFinite(i) ? Math.max(0, Math.floor(i)) : 0;
    if (want < this.paneList.length) return want;
    this.paneList.push(this.newPane(this.paneList.length));
    return this.paneList.length - 1;
  }

  /** Remove every empty pane below the top one; later series move up. */
  private prunePanes(): void {
    for (let i = this.paneList.length - 1; i >= 1; i--) {
      if (this.series.some(s => s.paneIndex === i)) continue;
      const pane = this.paneList[i];
      for (const p of pane.prims) p.detached?.();
      pane.divider?.remove();
      pane.legend?.remove();
      this.paneList.splice(i, 1);
      for (const s of this.series) if (s.paneIndex > i) s.paneIndex--;
    }
    if (this.cross && this.cross.pane >= this.paneList.length) this.cross = null;
  }

  moveSeries(model: AnyModel, i: number): void {
    const id = model.options.priceScaleId;
    const from = this.paneOf(model.paneIndex).scales.get(id);
    model.paneIndex = this.claimPane(i);
    // An overlay scale's settings (margins, mode) travel with the series when the target pane does not have that id.
    const to = this.paneOf(model.paneIndex);
    if (from && id !== 'right' && id !== 'left' && !to.scales.has(id)) to.scales.set(id, new PriceScaleModel(id, clone(from.options)));
    this.prunePanes();
    this.scaleFor(model);
    this.invalidate(LAYOUT | MAIN | OVERLAY);
  }

  ensureScale(id: string, paneIndex = 0): PriceScaleModel {
    const pane = this.paneOf(paneIndex);
    let s = pane.scales.get(id);
    if (!s) {
      s = new PriceScaleModel(id, { mode: 'linear', autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 }, visible: false });
      pane.scales.set(id, s);
    }
    return s;
  }

  scaleFor(m: AnyModel): PriceScaleModel { return this.ensureScale(m.options.priceScaleId, m.paneIndex); }

  // ── data ──

  addSeries<D extends AnySeriesDefinition>(def: D, options?: object, paneIndex = 0): SeriesApi<D> {
    if (!def || typeof def.draw !== 'function' || typeof def.normalize !== 'function') {
      throw new TypeError('Chartist Lite: addSeries needs a series definition, e.g. CandlestickSeries');
    }
    const opts = mergeInto(mergeInto(commonDefaults(), clone(def.defaults as object)), options) as object & SeriesCommonOptions;
    withPriceFormat(opts, options);
    const model = new SeriesModel(def as SeriesDefinition<RowBase, object>, opts);
    model.paneIndex = this.claimPane(paneIndex);
    this.series.push(model);
    this.scaleFor(model);
    if (def.ordinal && this.lead === model) this.rebuildIndex();
    const handle = new SeriesHandle<D>(this, model);
    this.handles.set(model, handle as unknown as SeriesHandle<AnySeriesDefinition>);
    this.invalidate(LAYOUT | MAIN | OVERLAY);
    return handle;
  }

  removeSeries(api: SeriesApi<AnySeriesDefinition>): void {
    const model = (api as unknown as SeriesHandle<AnySeriesDefinition>).model;
    const i = this.series.indexOf(model);
    if (i < 0) return;
    for (const p of model.primitives) p.detached?.();
    this.series.splice(i, 1);
    this.handles.delete(model);
    this.prunePanes();
    this.rebuildIndex();
    this.invalidate(LAYOUT | MAIN | OVERLAY);
  }

  /** The kind of time the OTHER series use (true = business days), or null when none has data. */
  private kindOf(model: AnyModel): boolean | null {
    for (const s of this.series) if (s !== model && s.businessDays !== null) return s.businessDays;
    return null;
  }

  /**
   * The series that makes an ordinal (brick) axis: the first one whose definition has `ordinal`; null for a calendar
   * axis. Every other series of an ordinal chart is placed row for row (row i at slot i) while its times match.
   */
  get lead(): AnyModel | null {
    for (const s of this.series) if (s.def.ordinal) return s;
    return null;
  }

  setSeriesData(model: AnyModel, data: readonly (Record<string, unknown> & { time: Time })[]): void {
    if (!Array.isArray(data)) throw new TypeError('Chartist Lite: setData needs an array of rows');
    const lead = this.lead;
    model.setData(data, this.kindOf(model), !!lead, lead && lead !== model ? this.index : null);
    this.rebuildIndex();
  }

  updateSeries(model: AnyModel, row: Record<string, unknown> & { time: Time }, append = false): void {
    const lead = this.lead;
    const idx = this.index;
    const { kind, t } = model.update(row, this.kindOf(model), append, !!lead, lead && lead !== model ? idx : null);
    const i = model.count - 1;
    if (lead && kind === 'append') {
      if (model === lead) {
        if (!idx.count) { idx.businessDays = !!model.businessDays; idx.setZone(this.zone()); }
        model.pos[i] = idx.append(t);
        // Rows another series already holds past the old end line up now.
        for (const s of this.series) if (s !== lead && s.count > i && s.pos[i] === OFF && (!i || s.pos[i - 1] === i - 1) && s.times[i] === t) s.pos[i] = i;
        this.ts.count = idx.count;
        this.ts.onAppend(1);
        if (idx.count === 1) this.needsInitialView = true;
      } else model.pos[i] = i < idx.count && (!i || model.pos[i - 1] === i - 1) ? i : OFF;
    }
    if (kind === 'replace' || lead) { this.invalidate(MAIN | OVERLAY); return; }
    if (idx.count === 0 || t > idx.times[idx.count - 1]) {
      if (idx.count === 0) { idx.businessDays = !!model.businessDays; idx.setZone(this.zone()); }
      model.pos[model.count - 1] = idx.append(t);
      this.ts.count = idx.count;
      this.ts.onAppend(1);
      if (idx.count === 1) this.needsInitialView = true;
    } else {
      const slot = idx.indexOf(t);
      if (slot >= 0) model.pos[model.count - 1] = slot;
      else { this.rebuildIndex(); return; }
    }
    this.invalidate(MAIN | OVERLAY);
  }

  /** Remove the last `n` rows of a series: O(n) on an ordinal axis, an axis rebuild on a calendar one. */
  popSeries(model: AnyModel, n: number): void {
    const before = model.count;
    model.pop(n);
    const lead = this.lead;
    if (!lead) { this.rebuildIndex(); return; }
    if (model === lead) {
      this.index.truncate(model.count);
      for (const s of this.series) for (let i = model.count; i < s.count; i++) s.pos[i] = OFF;
      this.ts.count = this.index.count;
      this.ts.onAppend(model.count - before);
      this.cross = null;
    }
    this.invalidate(MAIN | OVERLAY);
  }

  private rebuildIndex(): void {
    const hadData = this.index.count > 0;
    const prevCount = this.index.count;
    const business = this.series.some(s => s.businessDays === true);
    const lead = this.lead;
    this.index.setZone(this.zone());
    this.index.rebuild((lead ? [lead] : this.series).map(s => ({ times: s.times, count: s.count })), business, !!lead);
    for (const s of this.series) s.remap(this.index);
    this.ts.count = this.index.count;
    if (!hadData && this.index.count > 0) this.needsInitialView = true;
    // Fewer bars than the scrolled-back view needs: back to the live edge rather than a near-empty screen.
    else this.ts.onShrink(prevCount);
    this.cross = null;
    this.invalidate(MAIN | OVERLAY);
  }

  /** The time of slot `i` as given in the data (the first series holding it), else seconds. */
  private timeAt(slot: number): Time | undefined {
    if (slot < 0 || slot >= this.index.count) return undefined;
    for (const s of this.series) {
      const r = s.rowAtSlot(slot);
      if (r >= 0) {
        const row = s.rows[r];
        if (row) return row.time;
      }
    }
    return this.index.times[slot];
  }

  // ── primitives ──

  attachTo(list: ChartPrimitive[], p: ChartPrimitive, series: unknown): void {
    if (list.includes(p)) return;
    list.push(p);
    p.attached?.({ requestUpdate: () => this.invalidate(MAIN | OVERLAY), requestOverlay: () => this.invalidate(OVERLAY), series });
    this.invalidate(LAYOUT | MAIN | OVERLAY);
  }

  detachFrom(list: ChartPrimitive[], p: ChartPrimitive): void {
    const i = list.indexOf(p);
    if (i < 0) return;
    list.splice(i, 1);
    p.detached?.();
    this.invalidate(LAYOUT | MAIN | OVERLAY);
  }

  attachPrimitive(p: ChartPrimitive): void { this.attachTo(this.paneList[0].prims, p, null); }
  detachPrimitive(p: ChartPrimitive): void { this.detachFrom(this.paneList[0].prims, p); }

  // ── scales and layout ──

  private seriesIn(pane: number): AnyModel[] {
    return this.series.filter(s => s.paneIndex === pane);
  }

  private mainSeriesOf(scaleId: string, pane: number): AnyModel | null {
    for (const s of this.series) if (s.paneIndex === pane && s.options.priceScaleId === scaleId && s.options.visible) return s;
    return null;
  }

  private formatOf(scaleId: string, pane: number): { precision: number; minMove: number } {
    const s = this.mainSeriesOf(scaleId, pane);
    return resolvePriceFormat(s?.options.priceFormat);
  }

  private precisionOf(scaleId: string, pane: number): number {
    return this.formatOf(scaleId, pane).precision;
  }

  /** Axis / tag / crosshair text for a price on a scale. */
  private priceText(scale: PriceScaleModel, price: number, pane: number): string {
    if (scale.options.mode === 'percent') return formatPercent(scale.toScale(price), 2);
    const f = this.opts.localization.priceFormatter;
    return f ? f(price) : formatPrice(price, this.precisionOf(scale.id, pane));
  }

  private autoscale(): void {
    const r = this.ts.visibleLogicalRange();
    const from = r ? Math.max(0, Math.ceil(r.from - 0.5)) : 0;
    const to = r ? Math.min(this.index.count - 1, Math.floor(r.to + 0.5)) : -1;
    this.paneList.forEach((pane, pi) => {
      for (const scale of pane.scales.values()) {
        scale.height = pane.height;
        if (!scale.options.autoScale && !scale.isEmpty()) continue;
        const log = scale.options.mode === 'log';
        let lo = Infinity;
        let hi = -Infinity;
        let base = NaN;
        const take = (l: number, h: number): void => {
          if (log && !(l > 0)) l = h > 0 ? h : NaN;
          if (l < lo) lo = l;
          if (h > hi) hi = h;
        };
        for (const s of this.series) {
          if (s.paneIndex !== pi || s.options.priceScaleId !== scale.id || !s.options.visible || s.count === 0 || to < from) continue;
          const rr = s.rowRange(from, to);
          if (rr) {
            const def = s.def;
            const rows = s.rows;
            if (log) {
              // Log mode needs each row's low checked against zero: the plain scan.
              for (let i = rr.from; i <= rr.to; i++) { const row = rows[i]; if (row) take(def.low(row, s.options), def.high(row, s.options)); }
            } else {
              // Cached per-block extremes: O(visible / 128) once warm, whatever the zoom.
              s.extents(rr.from, rr.to, ext);
              if (ext[1] >= ext[0]) take(ext[0], ext[1]);
            }
            // Percent base: the first value that is not zero (a zero base has no percent change).
            for (let i = rr.from; i <= rr.to && Number.isNaN(base); i++) {
              const row = rows[i];
              if (row) { const v = def.value(row); if (v !== 0 && Number.isFinite(v)) base = v; }
            }
          }
          if (r) for (const p of s.primitives) { const a = p.autoscale?.(r); if (a) take(a.min, a.max); }
        }
        if (r) {
          for (const p of pane.prims) {
            if ((p.priceScaleId ?? 'right') !== scale.id) continue;
            const a = p.autoscale?.(r);
            if (a) take(a.min, a.max);
          }
        }
        if (!(hi >= lo)) { scale.min = NaN; scale.max = NaN; continue; }
        if (!Number.isNaN(base)) scale.base = base;
        scale.fit(lo, hi);
      }
    });
  }

  /** Ticks for each pane's left and right axis, and the width each side needs. */
  private planPriceAxes(): Record<Side, number> {
    const fs = this.opts.fontSize;
    const need: Record<Side, number> = { left: 0, right: 0 };
    this.paneList.forEach((pane, pi) => {
      for (const side of ['left', 'right'] as Side[]) {
        const scale = pane.scales.get(side) as PriceScaleModel;
        pane.ticks[side] = [];
        pane.shown[side] = scale.options.visible && !scale.isEmpty();
        if (!pane.shown[side]) continue;
        const { lo, hi } = scale.edgePrices();
        const pMin = Math.min(lo, hi);
        const pMax = Math.max(lo, hi);
        const minMove = this.formatOf(side, pi).minMove;
        pane.ticks[side] = priceTicks({
          pMin, pMax, priceH: pane.height, mode: scale.options.mode, minGapPx: fs * 2.6,
          anchor: scale.base, minStep: scale.options.mode === 'linear' ? minMove : 0,
        });
        let w = 0;
        for (const t of pane.ticks[side]) w = Math.max(w, this.mainText.measure(this.priceText(scale, t.price, pi)));
        for (const p of [pMin, pMax]) w = Math.max(w, this.mainText.measure(this.priceText(scale, p, pi)));
        need[side] = Math.max(need[side], Math.ceil(w + 2 * AXIS_PAD), fs * 4);
      }
    });
    return need;
  }

  private layout(): void {
    const fs = this.opts.fontSize;
    this.timeH = this.opts.timeScale.visible ? Math.round(fs + 16) : 0;
    this.panesH = Math.max(0, this.cssH - this.timeH);
    const boxes = layoutPanes(this.paneList.map(p => p.stretch), this.panesH, SEPARATOR, MIN_PANE);
    this.paneList.forEach((p, i) => { p.top = boxes[i].top; p.height = boxes[i].height; });
    let appliedView = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.plotL = this.leftW;
      this.plotW = Math.max(0, this.cssW - this.leftW - this.rightW);
      this.ts.width = this.plotW;
      this.ts.count = this.index.count;
      if (this.needsInitialView && this.index.count > 0 && this.plotW > 0) {
        this.ts.reset();
        this.needsInitialView = false;
      }
      // Applied on every pass, so the view fits the final plot width once the axis widths settle.
      if (this.pendingView && this.index.count > 0 && this.plotW > 0) {
        this.needsInitialView = false;
        this.applyView(this.pendingView);
        appliedView = true;
      }
      this.ts.clamp();
      this.autoscale();
      const need = this.planPriceAxes();
      let changed = false;
      for (const side of ['left', 'right'] as Side[]) {
        const cur = side === 'left' ? this.leftW : this.rightW;
        if (need[side] > cur || need[side] < cur - 8 || (need[side] === 0 && cur !== 0)) {
          if (side === 'left') this.leftW = need[side]; else this.rightW = need[side];
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (appliedView) this.pendingView = null;
    this.timeTicks = [];
    const vis = this.ts.visibleBars();
    if (this.opts.timeScale.visible && vis) {
      const idx = this.index;
      this.timeTicks = planTimeTicks({
        cal: idx.cal, count: idx.count, from: vis.from, to: vis.to,
        xOf: i => this.ts.indexToX(i), barSpacing: this.ts.barSpacing, plotW: this.plotW, kind: idx.kind,
        measure: (text, weight) => this.mainText.measure(text, weight),
        text: { hours12: this.opts.localization.hours12, dateOrder: this.opts.localization.dateOrder },
        starts: { day: idx.dayStarts, dayCount: idx.dayStartCount, month: idx.monthStarts, monthCount: idx.monthStartCount },
        tickText: this.lead?.def.ordinal?.tickText,
      });
    }
    this.paneList.forEach((p, i) => {
      if (!p.divider) return;
      const above = this.paneList[i - 1];
      const st = p.divider.style;
      st.top = `${p.top - SEPARATOR / 2 - 5.5}px`;
      st.width = `${this.cssW}px`;
      const pct = Math.round((above.height / Math.max(1, above.height + p.height)) * 100);
      p.divider.setAttribute('aria-valuenow', String(pct));
    });
    this.placeLink();
  }

  // ── painting ──

  private paintMain(): void {
    this.layout();
    const { ctx, hpr, vpr } = this.main;
    const bw = this.main.canvas.width;
    const bh = this.main.canvas.height;
    const c = this.colors;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.background;
    ctx.fillRect(0, 0, bw, bh);
    const xL = Math.round(this.plotL * hpr);
    const xR = Math.round((this.plotL + this.plotW) * hpr);
    const vis = this.ts.visibleBars();

    this.paneList.forEach((pane, pi) => {
      const yT = Math.round(pane.top * vpr);
      const yB = Math.round((pane.top + pane.height) * vpr);
      // Grid, one device pixel: the right axis' rows, else the left's.
      const gridSide: Side = pane.shown.right ? 'right' : 'left';
      const gridScale = pane.scales.get(gridSide) as PriceScaleModel;
      ctx.fillStyle = c.grid;
      if (this.opts.grid.horzLines) for (const t of pane.ticks[gridSide]) {
        const y = Math.round((pane.top + gridScale.priceToY(t.price)) * vpr);
        if (y >= yT && y < yB) ctx.fillRect(xL, y, xR - xL, 1);
      }
      if (this.opts.grid.vertLines) for (const t of this.timeTicks) ctx.fillRect(Math.floor((this.plotL + t.x) * hpr), yT, 1, yB - yT);
      if (pi > 0) {
        ctx.fillStyle = c.paneSeparator;
        ctx.fillRect(0, Math.round((pane.top - SEPARATOR) * vpr), bw, Math.max(1, Math.round(SEPARATOR * vpr)));
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(xL, yT, xR - xL, yB - yT);
      ctx.clip();
      this.drawPrimitives(pi, 'bottom');
      if (vis) for (const s of this.series) if (s.paneIndex === pi) this.drawSeries(s, pane, pi, vis, { x: xL, y: yT, width: xR - xL, height: yB - yT });
      this.drawPrimitives(pi, 'normal');
      this.drawPriceLines(pane, pi, xL, xR);
      this.drawPrimitives(pi, 'top');
      ctx.restore();

      ctx.setTransform(hpr, 0, 0, vpr, 0, 0);
      for (const side of ['left', 'right'] as Side[]) if (pane.shown[side] && (side === 'left' ? this.leftW : this.rightW) > 0) this.drawPriceAxis(pane, pi, side);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    });

    if (this.timeH > 0) {
      ctx.setTransform(hpr, 0, 0, vpr, 0, 0);
      const y = this.panesH + this.timeH / 2;
      for (const t of this.timeTicks) this.mainText.draw(t.text, this.plotL + t.textX, y, t.level === 1 ? c.mutedText : c.text, tickWeight(t.level), 'center');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // A chart without data says so, quietly, instead of showing an empty box.
    const empty = this.opts.localization.noDataText;
    if (this.index.count === 0 && empty && this.plotW > 0) {
      const p0 = this.paneList[0];
      ctx.setTransform(hpr, 0, 0, vpr, 0, 0);
      this.mainText.draw(empty, this.plotL + this.plotW / 2, p0.top + p0.height / 2, c.mutedText, 400, 'center');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    const range = this.ts.visibleLogicalRange();
    if (this.rangeSubs.size > 0 && (range?.from !== this.lastRange?.from || range?.to !== this.lastRange?.to)) {
      for (const h of this.rangeSubs) h(range ? { ...range } : null);
    }
    this.lastRange = range;
    const rt = this.atRealTime();
    if (rt !== this.lastRT) { this.lastRT = rt; for (const h of this.rtSubs) h(rt); }
  }

  /** The newest bar is in view (not scrolled back into history). */
  atRealTime(): boolean { return this.index.count === 0 || this.ts.rightOffset >= -0.5; }

  private drawSeries(s: AnyModel, pane: Pane, pi: number, vis: { from: number; to: number }, rect: { x: number; y: number; width: number; height: number }): void {
    if (!s.options.visible || s.count === 0) return;
    const rr = s.rowRange(vis.from, vis.to);
    if (!rr) return;
    const scale = this.scaleFor(s);
    if (scale.isEmpty()) return;
    const { hpr, vpr } = this.main;
    const ts = this.ts;
    const pos = s.pos;
    const left = this.plotL;
    const top = pane.top;
    const from = Math.max(0, rr.from - 1);
    const to = Math.min(s.count - 1, rr.to + 1);
    const x = (i: number): number => (left + ts.indexToX(pos[i])) * hpr;
    const scope: SeriesDrawScope<RowBase, object> = {
      ctx: this.main.ctx,
      pixelRatio: hpr,
      rows: s.rows,
      from,
      to,
      x,
      y: p => (top + scale.priceToY(p)) * vpr,
      barSpacing: ts.barSpacing * hpr,
      options: s.options,
      colors: this.colors,
      pane: rect,
      decimate: access => decimateColumns(s.rows, from, to, x, access),
      paneIndex: pi,
      values: s.vals,
      lows: s.lows,
      highs: s.highs,
      slots: pos,
      // x(i) = (left + width - (rightIndex - slot + 0.5) * spacing) * hpr = xOrigin + xStep * slot
      xOrigin: (left + ts.width - (ts.rightIndex() + 0.5) * ts.barSpacing) * hpr,
      xStep: ts.barSpacing * hpr,
      // Only worth building when rows are denser than device pixels.
      valueBlocks: ts.barSpacing * hpr < 1 ? s.valueBlocks() : undefined,
    };
    this.main.ctx.save();
    s.def.draw(scope);
    this.main.ctx.restore();
  }

  private drawPriceLines(pane: Pane, pi: number, xL: number, xR: number): void {
    const { ctx, hpr, vpr } = this.main;
    for (const s of this.series) {
      if (s.paneIndex !== pi || !s.options.visible || !s.options.priceLineVisible) continue;
      const row = s.lastRow();
      if (!row) continue;
      const y = this.scaleFor(s).priceToY(s.def.value(row));
      if (!Number.isFinite(y)) continue;
      const yd = Math.floor((pane.top + y) * vpr) + 0.5;
      ctx.save();
      ctx.strokeStyle = s.def.lastValueColor(row, s.options, this.colors, s.lastRow(1));
      ctx.lineWidth = 1;
      ctx.setLineDash([Math.max(1, Math.round(2 * hpr)), Math.max(1, Math.round(3 * hpr))]);
      ctx.beginPath();
      ctx.moveTo(xL, yd);
      ctx.lineTo(xR, yd);
      ctx.stroke();
      ctx.restore();
    }
  }

  private primitiveScope(p: ChartPrimitive, ctx: CanvasRenderingContext2D, owner: AnyModel | null, pi: number, text: TextPainter, hpr: number): PrimitiveDrawScope {
    const pane = this.paneOf(pi);
    const scale = owner ? this.scaleFor(owner) : this.ensureScale(p.priceScaleId ?? 'right', pi);
    const left = this.plotL;
    return {
      ctx,
      pixelRatio: hpr,
      pane: { x: left, y: pane.top, width: this.plotW, height: pane.height },
      colors: this.colors,
      fontFamily: this.opts.fontFamily,
      fontSize: this.opts.fontSize,
      visibleLogicalRange: this.ts.visibleLogicalRange(),
      timeToX: time => {
        const slot = this.index.indexOf(timeToSeconds(time));
        return slot >= 0 ? left + this.ts.indexToX(slot) : null;
      },
      logicalToX: l => left + this.ts.indexToX(l),
      priceToY: price => { const y = scale.priceToY(price); return Number.isFinite(y) ? pane.top + y : null; },
      text: (t, x, y, color, weight, align) => text.draw(t, x, y, color, weight, align),
      measureText: (t, weight) => text.measure(t, weight),
      formatPrice: price => this.priceText(scale, price, pi),
      seriesRowAt: owner
        ? (time: Time) => {
          const slot = this.index.indexOf(timeToSeconds(time));
          const r = slot >= 0 ? owner.rowAtSlot(slot) : -1;
          return r >= 0 ? owner.rows[r] : null;
        }
        : undefined,
    };
  }

  private eachPrimitive(pi: number, fn: (p: ChartPrimitive, owner: AnyModel | null) => void): void {
    // A copy: a primitive that detaches itself (or another) while drawing must not make the loop skip one.
    const list: [ChartPrimitive, AnyModel | null][] = [];
    for (const p of this.paneOf(pi).prims) list.push([p, null]);
    for (const s of this.series) if (s.paneIndex === pi && s.options.visible) for (const p of s.primitives) list.push([p, s]);
    for (const [p, owner] of list) fn(p, owner);
  }

  private drawPrimitives(pi: number, z: 'bottom' | 'normal' | 'top'): void {
    const { ctx, hpr, vpr } = this.main;
    this.eachPrimitive(pi, (p, owner) => {
      if (!p.draw || (p.zOrder ?? 'normal') !== z) return;
      ctx.save();
      ctx.setTransform(hpr, 0, 0, vpr, 0, 0);
      p.draw(this.primitiveScope(p, ctx, owner, pi, this.mainText, hpr));
      ctx.restore();
    });
  }

  private tagHeight(): number { return this.opts.fontSize + 8; }

  /** Axis extent of a side in CSS px: [x0, x1) and where its text is right-aligned. */
  private axisBox(side: Side): { x: number; w: number; textX: number } {
    return side === 'right'
      ? { x: this.plotL + this.plotW, w: this.rightW, textX: this.cssW - AXIS_PAD }
      : { x: 0, w: this.leftW, textX: this.leftW - AXIS_PAD };
  }

  /** `y` is chart-relative CSS px. */
  private drawTag(text: TextPainter, ctx: CanvasRenderingContext2D, side: Side, y: number, label: string, fill: string, color: string): void {
    const h = this.tagHeight();
    const box = this.axisBox(side);
    ctx.fillStyle = fill;
    ctx.beginPath();
    roundRect(ctx, box.x + 1, y - h / 2, box.w - 2, h, 4);
    ctx.fill();
    text.draw(label, box.textX, y, color, 500, 'right');
  }

  private drawPriceAxis(pane: Pane, pi: number, side: Side): void {
    const ctx = this.main.ctx;
    const fs = this.opts.fontSize;
    const h = this.tagHeight();
    const scale = pane.scales.get(side) as PriceScaleModel;
    const tags: Tag[] = [];
    for (const s of this.series) {
      if (s.paneIndex !== pi || !s.options.visible || !s.options.lastValueVisible || s.options.priceScaleId !== side) continue;
      const row = s.lastRow();
      if (!row) continue;
      const v = s.def.value(row);
      const y = scale.priceToY(v);
      if (!Number.isFinite(y)) continue;
      const fill = s.def.lastValueColor(row, s.options, this.colors, s.lastRow(1));
      tags.push({ y, text: this.priceText(scale, v, pi), fill, color: readableTextOn(fill), pinned: true });
    }
    this.eachPrimitive(pi, (p, owner) => {
      if (!p.priceAxisLabels) return;
      const sc = owner ? this.scaleFor(owner) : this.ensureScale(p.priceScaleId ?? 'right', pi);
      if (sc !== scale) return;
      for (const l of p.priceAxisLabels(this.colors)) {
        const y = scale.priceToY(l.price);
        if (!Number.isFinite(y)) continue;
        // A price off the pane shows no tag unless the label asks to stay in view.
        if (!l.keepInView && (y < 0 || y > pane.height)) continue;
        tags.push({ y, text: l.text ?? this.priceText(scale, l.price, pi), fill: l.color, color: l.textColor ?? readableTextOn(l.color), pinned: !!l.keepInView });
      }
    });
    // Tags never overlap: pushed apart, top to bottom, then kept inside the pane.
    tags.sort((a, b) => a.y - b.y);
    for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < h) tags[i].y = tags[i - 1].y + h;
    for (const t of tags) t.y = Math.max(h / 2, Math.min(pane.height - h / 2, t.y));

    const box = this.axisBox(side);
    for (const t of pane.ticks[side]) {
      const y = scale.priceToY(t.price);
      if (!(y >= fs / 2 + 1 && y <= pane.height - fs / 2 - 1)) continue;
      if (tags.some(tag => Math.abs(tag.y - y) < h * 0.9)) continue;
      this.mainText.draw(this.priceText(scale, t.price, pi), box.textX, pane.top + y, this.colors.mutedText, 400, 'right');
    }
    for (const t of tags) this.drawTag(this.mainText, ctx, side, pane.top + t.y, t.text, t.fill, t.color);
    pane.tags[side] = tags;
  }

  private crossShownAt = -1;

  private paintOverlay(): void {
    const { ctx, hpr, vpr } = this.top;
    const c = this.colors;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.top.canvas.width, this.top.canvas.height);
    const xL = Math.round(this.plotL * hpr);
    const xR = Math.round((this.plotL + this.plotW) * hpr);
    const cross = this.cross;
    const showCross = cross !== null && this.opts.crosshair.mode !== 'hidden' && this.index.count > 0;
    // The crosshair fades in over 120 ms when it appears (opacity only; at once under reduced motion).
    const now = this.win.performance?.now?.() ?? 0;
    if (!showCross) this.crossShownAt = -1;
    else if (this.crossShownAt < 0) this.crossShownAt = now;
    const fade = showCross && !this.reducedMotion() ? Math.min(1, Math.max(0, (now - this.crossShownAt) / 120)) : 1;
    if (fade < 1) this.invalidate(OVERLAY);
    ctx.globalAlpha = fade;
    if (showCross) {
      const x = this.plotL + this.ts.indexToX(cross.slot);
      const cp = this.paneOf(cross.pane);
      const y = cp.top + this.crossY(cross);
      ctx.save();
      ctx.strokeStyle = c.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([Math.max(2, Math.round(4 * hpr)), Math.max(2, Math.round(3 * hpr))]);
      ctx.beginPath();
      const xd = Math.floor(x * hpr) + 0.5;
      if (xd >= xL && xd <= xR) for (const p of this.paneList) {
        ctx.moveTo(xd, Math.round(p.top * vpr));
        ctx.lineTo(xd, Math.round((p.top + p.height) * vpr));
      }
      const yd = Math.floor(y * vpr) + 0.5;
      if (y >= cp.top && y <= cp.top + cp.height) { ctx.moveTo(xL, yd); ctx.lineTo(xR, yd); }
      ctx.stroke();
      ctx.restore();

      // Dots on the hovered values of series that ask for one.
      this.paneList.forEach((pane, pi) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(xL, Math.round(pane.top * vpr), xR - xL, Math.round(pane.height * vpr));
        ctx.clip();
        for (const s of this.series) {
          if (s.paneIndex !== pi || !s.options.visible || !s.def.crosshairMarker) continue;
          const r = s.rowAtSlot(cross.slot);
          const row = r >= 0 ? s.rows[r] : null;
          if (!row) continue;
          const m = s.def.crosshairMarker(row, s.options, c);
          if (!m) continue;
          const my = this.scaleFor(s).priceToY(m.price);
          if (!Number.isFinite(my)) continue;
          const cy = (pane.top + my) * vpr;
          ctx.beginPath();
          ctx.arc(x * hpr, cy, 4.5 * hpr, 0, Math.PI * 2);
          ctx.fillStyle = c.background;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x * hpr, cy, 3 * hpr, 0, Math.PI * 2);
          ctx.fillStyle = m.color;
          ctx.fill();
        }
        ctx.restore();
      });
    }

    this.paneList.forEach((pane, pi) => {
      this.eachPrimitive(pi, (p, owner) => {
        if (!p.drawOverlay) return;
        ctx.save();
        ctx.setTransform(hpr, 0, 0, vpr, 0, 0);
        ctx.beginPath();
        ctx.rect(this.plotL, pane.top, this.plotW, pane.height);
        ctx.clip();
        const scope = this.primitiveScope(p, ctx, owner, pi, this.topText, hpr);
        const ch = showCross && cross
          ? { x: this.plotL + this.ts.indexToX(cross.slot), y: this.paneOf(cross.pane).top + this.crossY(cross), logical: cross.slot }
          : null;
        p.drawOverlay({ ...scope, crosshair: ch });
        ctx.restore();
      });
    });

    ctx.setTransform(hpr, 0, 0, vpr, 0, 0);
    if (showCross && this.opts.crosshair.labels && cross) {
      const pane = this.paneOf(cross.pane);
      const y = this.crossY(cross);
      for (const side of ['left', 'right'] as Side[]) {
        const scale = pane.scales.get(side) as PriceScaleModel;
        if (!pane.shown[side] || (side === 'left' ? this.leftW : this.rightW) <= 0 || !(y >= 0 && y <= pane.height)) continue;
        this.crossTag(pane, cross.pane, side, scale, y);
      }
      if (this.timeH > 0) {
        const label = this.stampText(cross.slot);
        const w = this.topText.measure(label, 500) + 2 * AXIS_PAD;
        const x = this.ts.indexToX(cross.slot);
        const left = this.plotL + Math.max(0, Math.min(this.plotW - w, x - w / 2));
        const h = this.tagHeight();
        let l = left;
        let r = left + w;
        for (const t of this.timeTicks) {
          const tl = this.plotL + t.textX - t.width / 2 - 2;
          const tr = this.plotL + t.textX + t.width / 2 + 2;
          if (tr > l && tl < r) { l = Math.min(l, tl); r = Math.max(r, tr); }
        }
        ctx.fillStyle = c.background;
        ctx.fillRect(Math.max(this.plotL, l), this.panesH, Math.min(this.plotL + this.plotW, r) - Math.max(this.plotL, l), this.timeH);
        ctx.fillStyle = c.tagBackground;
        ctx.beginPath();
        roundRect(ctx, left, this.panesH + (this.timeH - h) / 2, w, h, 4);
        ctx.fill();
        this.topText.draw(label, left + w / 2, this.panesH + this.timeH / 2, c.tagText, 500, 'center');
      }
    }
    ctx.globalAlpha = 1;
    if (this.focusVisible()) {
      ctx.strokeStyle = c.focusRing;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(1, 1, this.cssW - 2, this.cssH - 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** The crosshair's price tag on one axis; the axis under it is blanked to whole labels first. y is pane-relative. */
  private crossTag(pane: Pane, pi: number, side: Side, scale: PriceScaleModel, y: number): void {
    const ctx = this.top.ctx;
    const h = this.tagHeight();
    const ty = Math.max(h / 2, Math.min(pane.height - h / 2, y));
    let top = ty - h / 2;
    let bottom = ty + h / 2;
    const half = this.opts.fontSize / 2 + 2;
    for (const t of pane.ticks[side]) {
      const ly = scale.priceToY(t.price);
      if (ly + half > top && ly - half < bottom) { top = Math.min(top, ly - half); bottom = Math.max(bottom, ly + half); }
    }
    for (const t of pane.tags[side]) {
      if (t.y + h / 2 > top && t.y - h / 2 < bottom) { top = Math.min(top, t.y - h / 2); bottom = Math.max(bottom, t.y + h / 2); }
    }
    const box = this.axisBox(side);
    ctx.fillStyle = this.colors.background;
    const t0 = Math.max(0, top);
    ctx.fillRect(box.x, pane.top + t0, box.w, Math.min(pane.height, bottom) - t0);
    this.drawTag(this.topText, ctx, side, pane.top + ty, this.priceText(scale, scale.yToPrice(y), pi), this.colors.tagBackground, this.colors.tagText);
  }

  private focusVisible(): boolean { return focusVisibleOn(this.root); }

  /** The chart or one of its parts has focus (works inside a shadow root, where the document sees only the host). */
  hasFocus(): boolean {
    try { return this.root.matches(':focus-within'); } catch { return false; }
  }

  /** Could the page scroll by (dx, dy) from the chart's position? Walks the scrollable ancestors and the page. */
  pageCanScroll(dx: number, dy: number): boolean {
    let el: Element | null = this.root.parentElement ?? ((this.root.getRootNode() as ShadowRoot).host ?? null);
    const scroller = this.doc.scrollingElement;
    while (el) {
      const st = this.win.getComputedStyle(el);
      const isPage = el === scroller;
      const canY = isPage || /(auto|scroll|overlay)/.test(st.overflowY);
      const canX = isPage || /(auto|scroll|overlay)/.test(st.overflowX);
      if (dy !== 0 && canY && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0)) return true;
      if (dx !== 0 && canX && (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0)) return true;
      el = el.parentElement ?? (((el.getRootNode() as ShadowRoot).host as Element | undefined) ?? null);
    }
    return false;
  }

  /** The first visible series of a pane, preferring the right scale. */
  private leadSeries(pi: number): AnyModel | null {
    return this.mainSeriesOf('right', pi) ?? this.mainSeriesOf('left', pi) ?? this.seriesIn(pi).find(s => s.options.visible) ?? null;
  }

  private crossY(cross: { y: number; slot: number; pane: number }): number {
    if (this.opts.crosshair.mode !== 'magnet' && !this.inspect) return cross.y;
    const s = this.leadSeries(cross.pane);
    if (!s) return cross.y;
    const r = s.rowAtSlot(cross.slot);
    const row = r >= 0 ? s.rows[r] : null;
    if (!row) return cross.y;
    const y = this.scaleFor(s).priceToY(s.def.value(row));
    return Number.isFinite(y) ? y : cross.y;
  }

  private stampText(slot: number): string {
    const f = this.opts.localization.timeFormatter;
    if (f) {
      const t = this.timeAt(slot);
      if (t !== undefined) return f(t);
    }
    const cal = this.index.cal;
    if (!cal.ok[slot]) return '';
    return formatStamp(
      { year: cal.year[slot], month: cal.month[slot], day: cal.day[slot], minute: cal.minute[slot], weekday: weekdayOfDay(cal.dayNum[slot]) },
      this.index.kind,
      { hours12: this.opts.localization.hours12, dateOrder: this.opts.localization.dateOrder },
    );
  }

  // ── legend ──

  /** Write each pane's legend (DOM); a pane's box is touched only when its text or place changed. */
  private syncLegends(): void {
    const c = this.colors;
    const st = { fontFamily: this.opts.fontFamily, fontSize: this.opts.fontSize, text: c.text, muted: c.mutedText, up: c.upText, down: c.downText, background: c.background };
    const slot = this.cross ? this.cross.slot : -1;
    this.paneList.forEach((pane, pi) => {
      const titled = this.series.filter(s => s.paneIndex === pi && s.options.visible && s.options.title);
      if (!this.opts.legend.visible || titled.length === 0 || !(this.plotW > 0)) { pane.legend?.hide(); return; }
      if (!pane.legend) pane.legend = new LegendBox(this.doc, this.root);
      const entries: LegendEntry[] = titled.map(s => {
        let r = slot >= 0 ? s.rowAtSlot(slot) : s.count - 1;
        if (slot < 0) while (r >= 0 && !s.rows[r]) r--;
        const row = r >= 0 ? s.rows[r] : null;
        let prev: RowBase | null = null;
        for (let k = r - 1; k >= 0 && k >= r - 64; k--) if (s.rows[k]) { prev = s.rows[k]; break; }
        const precision = resolvePriceFormat(s.options.priceFormat).precision;
        const f = this.opts.localization.priceFormatter;
        const fmt = (v: number): string => (f ? f(v) : formatPrice(v, precision));
        const d = describeRow(row as unknown as Record<string, unknown> | null, prev as unknown as Record<string, unknown> | null, fmt, x => s.def.value(x as unknown as RowBase));
        const colourRow = row ?? s.lastRow();
        const dot = !colourRow || isOhlc(colourRow as unknown as Record<string, unknown>) ? '' : s.def.lastValueColor(colourRow, s.options, c);
        return { title: s.options.title, dot, values: d.values, change: d.change };
      });
      pane.legend.update(entries, { left: this.plotL + 6, top: pane.top + 6, maxWidth: Math.floor(this.plotW - 12) }, st);
    });
  }

  // ── keyboard inspect mode and the live region ──

  /** Spoken text for a bar: its stamp, then each series' values ("open, high, low, close" or one value). */
  describeSlot(slot: number): string {
    const parts: string[] = [this.stampText(slot)];
    for (const s of this.series) {
      if (!s.options.visible) continue;
      const r = s.rowAtSlot(slot);
      const row = (r >= 0 ? s.rows[r] : null) as (RowBase & Record<string, unknown>) | null;
      if (!row) continue;
      const fmt = (v: number): string => {
        const f = this.opts.localization.priceFormatter;
        return f ? f(v) : formatPrice(v, this.precisionOf(s.options.priceScaleId, s.paneIndex));
      };
      const name = s.options.title || s.def.type;
      const ohlc = ['open', 'high', 'low', 'close'].every(k => typeof row[k] === 'number');
      parts.push(ohlc
        ? `${name}: open ${fmt(row.open as number)}, high ${fmt(row.high as number)}, low ${fmt(row.low as number)}, close ${fmt(row.close as number)}`
        : `${name} ${fmt(s.def.value(row))}`);
    }
    return parts.filter(Boolean).join('; ');
  }

  inspecting(): boolean { return this.inspect; }

  toggleInspect(): void {
    if (this.inspect) { this.endInspect(); return; }
    if (this.index.count === 0) return;
    this.inspect = true;
    const vis = this.ts.visibleBars();
    const slot = this.cross ? this.cross.slot : vis ? Math.min(vis.to, this.index.count - 1) : this.index.count - 1;
    this.inspectAt(slot);
  }

  private endInspect(): void {
    this.inspect = false;
    this.cross = null;
    this.live.textContent = '';
    this.invalidate(OVERLAY);
    this.fireCross(null);
  }

  inspectStep(bars: number): void {
    if (!this.cross) return;
    this.inspectAt(this.cross.slot + bars);
  }

  inspectEdge(edge: 'first' | 'last'): void {
    this.inspectAt(edge === 'first' ? 0 : this.index.count - 1);
  }

  private inspectAt(slot: number): void {
    const s = Math.max(0, Math.min(this.index.count - 1, Math.round(slot)));
    // Keep the bar on screen: scroll by whole bars when it would leave the plot.
    const x = this.ts.indexToX(s);
    const margin = this.ts.barSpacing;
    if (x < margin || x > this.plotW - margin) {
      const shift = x < margin ? (x - margin) / this.ts.barSpacing : (x - (this.plotW - margin)) / this.ts.barSpacing;
      this.ts.rightOffset += Math.sign(shift) * Math.ceil(Math.abs(shift));
      this.ts.clamp();
      this.invalidate(MAIN);
    }
    this.cross = { x: this.ts.indexToX(s), y: this.paneOf(0).height / 2, slot: s, pane: 0 };
    this.live.textContent = this.describeSlot(s);
    this.invalidate(OVERLAY);
    this.fireCross({ x: this.cross.x, y: this.crossY(this.cross) });
  }

  // ── plugin input (drawing tools) ──

  pointerHandlers(): readonly ChartPointerHandler[] { return this.handlers; }

  addPointerHandler(h: ChartPointerHandler): () => void {
    this.handlers.push(h);
    this.syncDom();
    return () => {
      const i = this.handlers.indexOf(h);
      if (i >= 0) this.handlers.splice(i, 1);
      if (!this.removed) this.syncDom();
    };
  }

  setCursor(cursor: string | null): void {
    this.forcedCursor = cursor;
    this.setRootCursor(this.rootCursor);
    this.syncDom(); // touch-action follows the handlers' blocksTouch()
  }

  setRootCursor(cursor: string): void {
    this.rootCursor = cursor;
    css(this.root, { cursor: this.forcedCursor ?? (cursor || 'default') });
  }

  pluginEvent(p: { x: number; y: number }, e: { pointerType?: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }, pane?: number): ChartPointerEvent {
    const pi = pane !== undefined && pane >= 0 && pane < this.paneList.length ? pane : paneAt(this.paneList, p.y);
    const x = p.x - this.plotL;
    return {
      point: { x, y: pi >= 0 ? p.y - this.paneList[pi].top : p.y },
      paneIndex: pi, logical: this.ts.xToIndex(x), area: this.hit(p.x, p.y), pointerType: e.pointerType ?? 'mouse',
      shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
    };
  }

  /** Median gap of the last bars (seconds), for extrapolating times past the data. */
  private barStep(): number {
    const { times, count } = this.index;
    if (this.index.ordinal) return this.index.span(() => (this.index.businessDays ? 86_400 : 60));
    if (count < 2) return 60;
    const gaps: number[] = [];
    for (let i = Math.max(1, count - 64); i < count; i++) gaps.push(times[i] - times[i - 1]);
    gaps.sort((a, b) => a - b);
    return gaps[gaps.length >> 1] || 60;
  }

  timeToLogical(time: Time | number): number | null {
    if (this.index.count === 0) return null;
    return this.index.logicalOf(typeof time === 'number' ? time : timeToSeconds(time), () => this.barStep());
  }

  logicalToTime(logical: number): number | null {
    return this.index.timeOf(logical, () => this.barStep());
  }

  // ── input target ──

  interaction() { return this.opts.interaction; }

  hit(x: number, y: number): HitArea {
    if (x < 0 || y < 0 || x > this.cssW || y > this.cssH) return 'none';
    const inPlot = x >= this.plotL && x <= this.plotL + this.plotW;
    if (y >= this.panesH) return inPlot ? 'time' : 'none';
    if (paneAt(this.paneList, y) < 0) return 'none';
    return inPlot ? 'pane' : 'price';
  }

  gestureStart(p: { x: number; y: number }): void {
    const pane = Math.max(0, paneAt(this.paneList, p.y));
    const pn = this.paneOf(pane);
    const side: Side = p.x < this.plotL ? 'left' : p.x > this.plotL + this.plotW ? 'right' : pn.shown.right || !pn.shown.left ? 'right' : 'left';
    this.drag = { pane, side };
  }

  private eventParams(cross: { x: number; y: number; slot: number; pane: number } | null, point: { x: number; y: number } | null): MouseEventParams {
    const seriesData = new Map<SeriesApi<AnySeriesDefinition>, RowBase>();
    if (!point || !cross || this.index.count === 0) return { seriesData };
    const slot = cross.slot;
    for (const s of this.series) {
      const r = s.rowAtSlot(slot);
      const row = r >= 0 ? s.rows[r] : null;
      const h = this.handles.get(s);
      if (row && h) seriesData.set(h, row);
    }
    return { time: this.timeAt(slot), logical: slot, point, paneIndex: cross.pane, seriesData };
  }

  private fireCross(point: { x: number; y: number } | null): void {
    if (this.crossSubs.size === 0) return;
    const params = this.eventParams(this.cross, point);
    for (const h of this.crossSubs) h(params);
  }

  /** `point` is chart-relative (from the input layer). */
  setCrosshair(point: { x: number; y: number } | null): void {
    if (this.inspect) { this.inspect = false; this.live.textContent = ''; }
    const prev = this.cross;
    const pane = point ? paneAt(this.paneList, point.y) : -1;
    if (point && pane >= 0 && this.index.count > 0 && point.x >= this.plotL && point.x <= this.plotL + this.plotW) {
      const x = point.x - this.plotL;
      const slot = Math.max(0, Math.min(this.index.count - 1, Math.round(this.ts.xToIndex(x))));
      this.cross = { x, y: point.y - this.paneList[pane].top, slot, pane };
    } else this.cross = null;
    if (prev === null && this.cross === null) return;
    this.invalidate(OVERLAY);
    this.fireCross(this.cross ? { x: this.cross.x, y: this.cross.y } : null);
  }

  private refreshCrossSlot(): void {
    if (!this.cross || this.inspect) return;
    this.cross.slot = Math.max(0, Math.min(this.index.count - 1, Math.round(this.ts.xToIndex(this.cross.x))));
  }

  private dragScale(): PriceScaleModel {
    const pane = this.paneOf(this.drag.pane);
    return pane.scales.get(this.drag.side) as PriceScaleModel;
  }

  pan(dx: number, dy: number): void {
    this.ts.pan(dx);
    if (dy !== 0) {
      const scale = this.dragScale();
      if (!scale.options.autoScale) scale.shiftBy(dy);
    }
    this.refreshCrossSlot();
    this.invalidate(MAIN | OVERLAY);
  }

  zoom(anchorX: number, factor: number): void {
    this.ts.zoom(Math.max(0, anchorX - this.plotL), factor);
    this.refreshCrossSlot();
    this.invalidate(MAIN | OVERLAY);
  }

  stretchPrice(dy: number): void {
    const scale = this.dragScale();
    if (scale.isEmpty()) return;
    scale.options.autoScale = false;
    scale.scaleBy(Math.exp(dy * 0.005));
    this.invalidate(MAIN | OVERLAY);
  }

  resetView(): void {
    this.ts.reset();
    for (const p of this.paneList) for (const s of p.scales.values()) s.options.autoScale = true;
    this.invalidate(LAYOUT | MAIN | OVERLAY);
  }

  panBars(bars: number): void { this.pan(-bars * this.ts.barSpacing, 0); }
  zoomCentre(factor: number): void { this.zoom(this.plotL + this.plotW / 2, factor); }
  home(): void {
    if (this.index.count === 0) return;
    this.ts.rightOffset = -this.ts.last() + this.plotW / this.ts.barSpacing - 1;
    this.ts.clamp();
    this.invalidate(MAIN | OVERLAY);
  }
  end(): void { this.ts.scrollToRealTime(); this.invalidate(MAIN | OVERLAY); }
  click(point: { x: number; y: number }): void {
    if (this.clickSubs.size === 0) return;
    const pane = paneAt(this.paneList, point.y);
    if (pane < 0) return;
    const x = point.x - this.plotL;
    const slot = Math.max(0, Math.min(this.index.count - 1, Math.round(this.ts.xToIndex(x))));
    const local = { x, y: point.y - this.paneList[pane].top };
    const params = this.eventParams({ ...local, slot, pane }, local);
    for (const h of this.clickSubs) h(params);
  }
  paneWidth(): number { return this.plotL + this.plotW; }
  reducedMotion(): boolean { return !!this.motionQuery?.matches; }
  focusChanged(): void { this.invalidate(OVERLAY); }

  // ── public API ──

  private applyView(v: PendingView): void {
    const ts = this.ts;
    if (v.kind === 'fit') ts.fitContent();
    else if (v.kind === 'logical') ts.setVisibleLogicalRange(v.range);
    else if (v.kind === 'span') {
      const ix = this.index;
      // At least five bars, so a 1D span on daily bars does not zoom to a single candle.
      const first = Math.max(0, Math.min(spanFirstIndex(v.span, ix.times, ix.count, ix.displayZone()), ix.count - 5));
      ts.setVisibleLogicalRange({ from: first - 0.5, to: ix.count - 1 + ts.options.rightOffset });
    }
    else {
      const a = this.index.lowerBound(timeToSeconds(v.range.from));
      // Every slot dated in [from, to] (on a brick axis all bricks of a repeated time).
      const b = this.index.lowerBound(timeToSeconds(v.range.to), true) - 1;
      if (b >= a) ts.setVisibleLogicalRange({ from: a, to: b });
    }
  }

  timeScale(): TimeScaleApi {
    const chart = this;
    const ts = this.ts;
    const done = (): void => { chart.refreshCrossSlot(); chart.invalidate(MAIN | OVERLAY); };
    const ensureWidth = (): void => { if (!(ts.width > 0) || chart.dirty & LAYOUT) { chart.measure(); chart.layout(); } };
    // With no width or no data yet the request is kept and applied by the first layout that can (`pendingView`).
    const request = (v: PendingView): void => {
      ensureWidth();
      if (ts.width > 0 && chart.index.count > 0) { chart.pendingView = null; chart.needsInitialView = false; chart.applyView(v); }
      else chart.pendingView = v;
      done();
    };
    return {
      fitContent() { request({ kind: 'fit' }); },
      scrollToRealTime() { ts.scrollToRealTime(); done(); },
      resetTimeScale() { ts.reset(); done(); },
      getVisibleRange(): TimeRange | null {
        const r = ts.visibleLogicalRange();
        if (!r || chart.index.count === 0) return null;
        const a = Math.max(0, Math.ceil(r.from - 0.5));
        const b = Math.min(chart.index.count - 1, Math.floor(r.to + 0.5));
        if (a > b) return null;
        return { from: chart.timeAt(a) as Time, to: chart.timeAt(b) as Time };
      },
      setVisibleRange(range: TimeRange) { request({ kind: 'time', range: { from: range.from, to: range.to } }); },
      getVisibleLogicalRange: () => { const r = ts.visibleLogicalRange(); return r ? { ...r } : null; },
      setVisibleLogicalRange(range: LogicalRange) { request({ kind: 'logical', range: { from: range.from, to: range.to } }); },
      setVisibleSpan(span: SpanInput) {
        const p = parseSpan(span);
        if (!p) throw new RangeError(`Chartist Lite: unknown span ${JSON.stringify(span)}; use '1D', '5D', '1M', 'YTD', 'All' or { days }`);
        request({ kind: 'span', span: p });
      },
      isAtRealTime: () => chart.atRealTime(),
      isOrdinal: () => chart.index.ordinal,
      subscribeRealTimeChange(h: (atRealTime: boolean) => void) { chart.rtSubs.add(h); },
      unsubscribeRealTimeChange(h: (atRealTime: boolean) => void) { chart.rtSubs.delete(h); },
      scrollPosition: () => ts.rightOffset,
      timeToCoordinate(time: Time) {
        const slot = chart.index.indexOf(timeToSeconds(time));
        return slot >= 0 ? ts.indexToX(slot) : null;
      },
      coordinateToTime(x: number) {
        const slot = Math.round(ts.xToIndex(x));
        return chart.timeAt(slot) ?? null;
      },
      logicalToCoordinate: (l: number) => (ts.width > 0 ? ts.indexToX(l) : null),
      coordinateToLogical: (x: number) => (ts.width > 0 ? ts.xToIndex(x) : null),
      timeToLogical: (time: Time | number) => chart.timeToLogical(time),
      logicalToTime: (logical: number) => chart.logicalToTime(logical),
      width: () => chart.plotW,
      applyOptions(o: DeepPartial<ChartTimeScaleOptions>) { chart.applyOptions({ timeScale: o }); },
      options: () => chart.opts.timeScale,
      subscribeVisibleLogicalRangeChange(h: LogicalRangeChangeHandler) { chart.rangeSubs.add(h); },
      unsubscribeVisibleLogicalRangeChange(h: LogicalRangeChangeHandler) { chart.rangeSubs.delete(h); },
    };
  }

  /**
   * A handle on one scale of one pane. A pane that does not exist is an error (RangeError), never silently pane 0.
   * The handle stays bound to that scale: after `series.moveToPane`, take a new one with `series.priceScale()`.
   */
  priceScale(id = 'right', paneIndex = 0): PriceScaleApi {
    if (!Number.isInteger(paneIndex) || paneIndex < 0 || paneIndex >= this.paneList.length) {
      throw new RangeError(`Chartist Lite: there is no pane ${paneIndex} (the chart has ${this.paneList.length}); add a series to it first`);
    }
    const scale = this.ensureScale(id, paneIndex);
    const chart = this;
    return {
      applyOptions(o: DeepPartial<PriceScaleOptions>) {
        const mode = scale.options.mode;
        mergeInto(scale.options, o);
        // A new mode needs a new range even when autoscale is off.
        if (scale.options.mode !== mode) { scale.min = NaN; scale.max = NaN; }
        chart.invalidate(LAYOUT | MAIN | OVERLAY);
      },
      options: () => scale.options,
      width: () => {
        const pane = chart.paneOf(paneIndex);
        if (id === 'right') return pane.shown.right ? chart.rightW : 0;
        if (id === 'left') return pane.shown.left ? chart.leftW : 0;
        return 0;
      },
    };
  }

  panes(): PaneApi[] {
    return this.paneList.map((pane) => {
      const chart = this;
      const idx = (): number => chart.paneList.indexOf(pane);
      const api: PaneApi = {
        paneIndex: idx,
        getHeight: () => pane.height,
        setHeight(height: number) {
          const i = idx();
          if (i < 0 || chart.paneList.length < 2) return;
          const avail = chart.panesH - SEPARATOR * (chart.paneList.length - 1);
          pane.stretch = stretchForHeight(chart.paneList.map(p => p.stretch), i, height, avail);
          chart.invalidate(LAYOUT | MAIN | OVERLAY);
        },
        getStretchFactor: () => pane.stretch,
        setStretchFactor(f: number) {
          if (!(f > 0) || !Number.isFinite(f)) return;
          pane.stretch = f;
          chart.invalidate(LAYOUT | MAIN | OVERLAY);
        },
        getSeries: () => chart.series.filter(s => s.paneIndex === idx()).map(s => chart.handles.get(s) as SeriesApi<AnySeriesDefinition>),
        priceScale: (id = 'right') => chart.priceScale(id, Math.max(0, idx())),
        attachPrimitive: p => chart.attachTo(pane.prims, p, null),
        detachPrimitive: p => chart.detachFrom(pane.prims, p),
      };
      return api;
    });
  }

  resize(width: number, height: number): void {
    this.opts.autoSize = false;
    this.opts.width = Math.max(0, width);
    this.opts.height = Math.max(0, height);
    this.syncDom();
    this.invalidate(LAYOUT | MAIN | OVERLAY);
  }

  subscribeCrosshairMove(h: MouseEventHandler): void { this.crossSubs.add(h); }
  unsubscribeCrosshairMove(h: MouseEventHandler): void { this.crossSubs.delete(h); }
  subscribeClick(h: MouseEventHandler): void { this.clickSubs.add(h); }
  unsubscribeClick(h: MouseEventHandler): void { this.clickSubs.delete(h); }

  takeScreenshot(): HTMLCanvasElement {
    this.paint();
    const out = this.doc.createElement('canvas');
    out.width = this.main.canvas.width;
    out.height = this.main.canvas.height;
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.drawImage(this.main.canvas, 0, 0);
      ctx.drawImage(this.top.canvas, 0, 0);
    }
    return out;
  }

  element(): HTMLElement { return this.root; }

  /** Run `fn` once when the chart is removed (plugins drop their own listeners there). Returns an unsubscribe. */
  onRemove(fn: () => void): () => void {
    if (this.removed) { try { fn(); } catch { /* a plugin's cleanup must not break the caller */ } return () => {}; }
    this.removeSubs.add(fn);
    return () => { this.removeSubs.delete(fn); };
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    for (const f of [...this.removeSubs]) { try { f(); } catch { /* keep removing */ } }
    this.removeSubs.clear();
    if (this.raf) this.win.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.input.destroy();
    for (const f of this.cleanups) f();
    this.cleanups = [];
    // Every primitive, those on hidden series included.
    const all: ChartPrimitive[] = [];
    for (const p of this.paneList) all.push(...p.prims);
    for (const s of this.series) all.push(...s.primitives);
    for (const p of this.paneList) p.prims = [];
    for (const s of this.series) s.primitives = [];
    for (const p of all) p.detached?.();
    this.crossSubs.clear();
    this.clickSubs.clear();
    this.rangeSubs.clear();
    this.rtSubs.clear();
    this.main.destroy();
    this.top.destroy();
    for (const p of this.paneList) p.legend?.remove();
    this.root.remove();
    this.series = [];
    this.handles.clear();
  }
}

/** An id is generated by us (letters, digits, dashes), so escaping is a no-op kept for safety. */
function CSS_ESCAPE(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Keyboard focus on `el` (`:focus-visible`), read on the element itself so it also works inside a shadow root. */
function focusVisibleOn(el: Element): boolean {
  try { return el.matches(':focus-visible'); } catch { try { return el.matches(':focus'); } catch { return false; } }
}
