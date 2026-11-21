// The chart: DOM, state, the paint scheduler and the two painters. See ARCHITECTURE.md "Render pipeline".
//
// Two canvases cover the whole chart. MAIN holds the grid, series, primitives and axes and is repainted only when
// data, scales, size or options change. OVERLAY holds the crosshair, its axis tags and focus ring, and is the only
// thing repainted on a pointer move. Every invalidation is coalesced into one requestAnimationFrame.

import type {
  AnySeriesDefinition, ChartApi, LogicalRangeChangeHandler, MouseEventHandler, MouseEventParams, PriceScaleApi,
  SeriesApi, TimeRange, TimeScaleApi,
} from '../api';
import { formatPercent, formatPrice, formatStamp, precisionOfMinMove } from '../core/format';
import { defaultChartOptions, mergeInto, MIN_FONT_SIZE, type ChartOptions, type ChartTimeScaleOptions, type DeepPartial } from '../core/options';
import { darkTheme, lightTheme, readableTextOn, type ThemeColors } from '../core/theme';
import { timeToSeconds, type Time } from '../core/time';
import { TimeIndex } from '../core/time-index';
import { isValidTimeZone, localTimeZone, weekdayOfDay } from '../core/zone';
import type { ChartPrimitive, PrimitiveDrawScope } from '../plugins/primitive';
import { CanvasLayer } from '../render/canvas';
import { TextPainter } from '../render/text';
import { priceTicks, type PriceTick } from '../scales/price-ticks';
import { PriceScaleModel, type PriceScaleOptions } from '../scales/price-scale';
import { planTimeTicks, tickWeight, type TimeTick } from '../scales/time-ticks';
import { TimeScaleModel, type LogicalRange } from '../scales/time-scale';
import type { RowBase, SeriesCommonOptions, SeriesDefinition, SeriesDrawScope } from '../series/definition';
import { SeriesModel } from '../series/series-model';
import { InputController, type HitArea, type InputTarget } from './input';

const OVERLAY = 1;
const MAIN = 2;
const LAYOUT = 4;

const AXIS_PAD = 8;
const ATTRIBUTION_URL = 'https://mrchartist.com';

type AnyModel = SeriesModel<RowBase, object>;

interface Tag { y: number; text: string; fill: string; color: string }

function commonDefaults(): SeriesCommonOptions {
  return {
    priceScaleId: 'right', visible: true, lastValueVisible: true, priceLineVisible: true,
    priceFormat: { precision: 2, minMove: 0.01 }, title: '',
  };
}

function cloneDefaults<T extends object>(o: T): T {
  return mergeInto({} as T, o);
}

class SeriesHandle<D extends AnySeriesDefinition> implements SeriesApi<D> {
  constructor(private chart: Chart, readonly model: AnyModel) {}
  seriesType(): string { return this.model.def.type; }
  setData(data: readonly unknown[]): void { this.chart.setSeriesData(this.model, data as never); }
  update(row: unknown): void { this.chart.updateSeries(this.model, row as never); }
  data(): never[] { return this.model.rows.slice(0, this.model.count).filter(r => r !== null) as never[]; }
  applyOptions(options: object): void {
    const before = this.model.options.priceScaleId;
    mergeInto(this.model.options, options);
    if (this.model.options.priceScaleId !== before) this.chart.ensureScale(this.model.options.priceScaleId);
    this.chart.invalidate(MAIN | OVERLAY);
  }
  options(): never { return this.model.options as never; }
  priceScale(): PriceScaleApi { return this.chart.priceScale(this.model.options.priceScaleId); }
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
  private input: InputController;

  readonly index = new TimeIndex();
  readonly ts: TimeScaleModel;
  private scales = new Map<string, PriceScaleModel>();
  private series: AnyModel[] = [];
  private handles = new Map<AnyModel, SeriesHandle<AnySeriesDefinition>>();
  private panePrims: ChartPrimitive[] = [];

  private cssW = 0;
  private cssH = 0;
  private paneW = 0;
  private paneH = 0;
  private axisW = 0;
  private timeH = 0;
  private colors: ThemeColors = { ...lightTheme };
  private rightTicks: PriceTick[] = [];
  private timeTicks: TimeTick[] = [];
  private axisTags: Tag[] = [];
  private needsInitialView = true;
  private lastRange: LogicalRange | null = null;

  private cross: { x: number; y: number; slot: number } | null = null;
  private dirty = 0;
  private raf = 0;
  private removed = false;
  private crossSubs = new Set<MouseEventHandler>();
  private clickSubs = new Set<MouseEventHandler>();
  private rangeSubs = new Set<LogicalRangeChangeHandler>();
  private cleanups: (() => void)[] = [];
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
    this.ts = new TimeScaleModel(this.opts.timeScale);
    this.scales.set('right', new PriceScaleModel('right', this.opts.rightPriceScale));
    this.index.setZone(this.zone());

    const root = this.doc.createElement('div');
    const st = root.style;
    st.position = 'relative';
    st.overflow = 'hidden';
    st.userSelect = 'none';
    st.webkitUserSelect = 'none';
    st.touchAction = 'pan-y';
    st.outline = 'none';
    (st as CSSStyleDeclaration & { webkitTapHighlightColor: string }).webkitTapHighlightColor = 'transparent';
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
    container.appendChild(root);

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
    this.root.style.width = o.autoSize ? '100%' : `${o.width}px`;
    this.root.style.height = o.autoSize ? '100%' : `${o.height}px`;
    if (o.attribution.visible && !this.link) {
      const a = this.doc.createElement('a');
      a.href = ATTRIBUTION_URL;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Chartist';
      a.title = 'Chart by Chartist Lite';
      const s = a.style;
      s.position = 'absolute';
      s.zIndex = '1';
      s.padding = '2px 4px';
      s.borderRadius = '4px';
      s.textDecoration = 'none';
      s.lineHeight = '16px';
      s.opacity = '0.75';
      this.root.appendChild(a);
      this.link = a;
    } else if (!o.attribution.visible && this.link) {
      this.link.remove();
      this.link = null;
    }
  }

  private placeLink(): void {
    const a = this.link;
    if (!a) return;
    const s = a.style;
    s.font = `400 ${MIN_FONT_SIZE}px ${this.opts.fontFamily}`;
    s.color = this.colors.mutedText;
    const pos = this.opts.attribution.position;
    const inset = 6;
    s.left = s.right = s.top = s.bottom = '';
    if (pos.endsWith('left')) s.left = `${inset}px`; else s.right = `${this.axisW + inset}px`;
    if (pos.startsWith('bottom')) s.bottom = `${this.timeH + inset}px`; else s.top = `${inset}px`;
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

  // ── data ──

  ensureScale(id: string): PriceScaleModel {
    let s = this.scales.get(id);
    if (!s) {
      s = new PriceScaleModel(id, { mode: 'linear', autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 }, visible: false });
      this.scales.set(id, s);
    }
    return s;
  }

  scaleFor(m: AnyModel): PriceScaleModel { return this.ensureScale(m.options.priceScaleId); }

  addSeries<D extends AnySeriesDefinition>(def: D, options?: object): SeriesApi<D> {
    if (!def || typeof def.draw !== 'function' || typeof def.normalize !== 'function') {
      throw new TypeError('Chartist Lite: addSeries needs a series definition, e.g. CandlestickSeries');
    }
    const opts = mergeInto(mergeInto(commonDefaults(), cloneDefaults(def.defaults as object)), options) as object & SeriesCommonOptions;
    const model = new SeriesModel(def as SeriesDefinition<RowBase, object>, opts);
    this.series.push(model);
    this.ensureScale(opts.priceScaleId);
    const handle = new SeriesHandle<D>(this, model);
    this.handles.set(model, handle as unknown as SeriesHandle<AnySeriesDefinition>);
    this.invalidate(MAIN | OVERLAY);
    return handle;
  }

  removeSeries(api: SeriesApi<AnySeriesDefinition>): void {
    const model = (api as unknown as SeriesHandle<AnySeriesDefinition>).model;
    const i = this.series.indexOf(model);
    if (i < 0) return;
    for (const p of model.primitives) p.detached?.();
    this.series.splice(i, 1);
    this.handles.delete(model);
    this.rebuildIndex();
  }

  private checkKind(model: AnyModel): void {
    for (const s of this.series) {
      if (s !== model && s.businessDays !== null && model.businessDays !== null && s.businessDays !== model.businessDays) {
        throw new TypeError('Chartist Lite: all series must use the same kind of time (business days or timestamps)');
      }
    }
  }

  setSeriesData(model: AnyModel, data: readonly (Record<string, unknown> & { time: Time })[]): void {
    if (!Array.isArray(data)) throw new TypeError('Chartist Lite: setData needs an array of rows');
    model.setData(data);
    this.checkKind(model);
    this.rebuildIndex();
  }

  updateSeries(model: AnyModel, row: Record<string, unknown> & { time: Time }): void {
    const { kind, t } = model.update(row);
    this.checkKind(model);
    if (kind === 'replace') { this.invalidate(MAIN | OVERLAY); return; }
    const idx = this.index;
    if (idx.count === 0 || t > idx.times[idx.count - 1]) {
      if (idx.count === 0) idx.businessDays = !!model.businessDays;
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

  private rebuildIndex(): void {
    const hadData = this.index.count > 0;
    const business = this.series.some(s => s.businessDays === true);
    this.index.setZone(this.zone());
    this.index.rebuild(this.series.map(s => ({ times: s.times, count: s.count })), business);
    for (const s of this.series) s.remap(this.index);
    this.ts.count = this.index.count;
    if (!hadData && this.index.count > 0) this.needsInitialView = true;
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
    p.attached?.({ requestUpdate: () => this.invalidate(MAIN | OVERLAY), series });
    this.invalidate(MAIN | OVERLAY);
  }

  detachFrom(list: ChartPrimitive[], p: ChartPrimitive): void {
    const i = list.indexOf(p);
    if (i < 0) return;
    list.splice(i, 1);
    p.detached?.();
    this.invalidate(MAIN | OVERLAY);
  }

  attachPrimitive(p: ChartPrimitive): void { this.attachTo(this.panePrims, p, null); }
  detachPrimitive(p: ChartPrimitive): void { this.detachFrom(this.panePrims, p); }

  // ── scales and layout ──

  private mainSeriesOf(scaleId: string): AnyModel | null {
    for (const s of this.series) if (s.options.priceScaleId === scaleId && s.options.visible) return s;
    return null;
  }

  private precisionOf(scaleId: string): number {
    const s = this.mainSeriesOf(scaleId);
    if (!s) return 2;
    const pf = s.options.priceFormat;
    return Number.isFinite(pf.precision) ? pf.precision : precisionOfMinMove(pf.minMove);
  }

  /** Axis / tag / crosshair text for a price on a scale. */
  private priceText(scale: PriceScaleModel, price: number): string {
    if (scale.options.mode === 'percent') return formatPercent(scale.toScale(price), 2);
    const f = this.opts.localization.priceFormatter;
    return f ? f(price) : formatPrice(price, this.precisionOf(scale.id));
  }

  private autoscale(): void {
    const r = this.ts.visibleLogicalRange();
    const from = r ? Math.max(0, Math.ceil(r.from - 0.5)) : 0;
    const to = r ? Math.min(this.index.count - 1, Math.floor(r.to + 0.5)) : -1;
    for (const scale of this.scales.values()) {
      scale.height = this.paneH;
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
        if (s.options.priceScaleId !== scale.id || !s.options.visible || s.count === 0 || to < from) continue;
        const rr = s.rowRange(from, to);
        if (rr) {
          const def = s.def;
          for (let i = rr.from; i <= rr.to; i++) {
            const row = s.rows[i];
            if (!row) continue;
            take(def.low(row), def.high(row));
            if (Number.isNaN(base)) base = def.value(row);
          }
        }
        if (r) for (const p of s.primitives) { const a = p.autoscale?.(r); if (a) take(a.min, a.max); }
      }
      if (r) {
        for (const p of this.panePrims) {
          if ((p.priceScaleId ?? 'right') !== scale.id) continue;
          const a = p.autoscale?.(r);
          if (a) take(a.min, a.max);
        }
      }
      if (!(hi >= lo)) continue;
      if (!Number.isNaN(base)) scale.base = base;
      scale.fit(lo, hi);
    }
  }

  private layout(): void {
    const fs = this.opts.fontSize;
    this.timeH = this.opts.timeScale.visible ? Math.round(fs + 16) : 0;
    const right = this.scales.get('right') as PriceScaleModel;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.paneW = Math.max(0, this.cssW - this.axisW);
      this.paneH = Math.max(0, this.cssH - this.timeH);
      this.ts.width = this.paneW;
      this.ts.count = this.index.count;
      if (this.needsInitialView && this.index.count > 0 && this.paneW > 0) {
        this.ts.reset();
        this.needsInitialView = false;
      }
      this.ts.clamp();
      this.autoscale();
      this.rightTicks = [];
      let need = 0;
      if (right.options.visible) {
        if (!right.isEmpty()) {
          const { lo, hi } = right.edgePrices();
          const pMin = Math.min(lo, hi);
          const pMax = Math.max(lo, hi);
          const minMove = Math.pow(10, -this.precisionOf('right'));
          this.rightTicks = priceTicks({
            pMin, pMax, priceH: this.paneH, mode: right.options.mode, minGapPx: fs * 2.6,
            anchor: right.base, minStep: right.options.mode === 'linear' ? minMove : 0,
          });
          for (const t of this.rightTicks) need = Math.max(need, this.mainText.measure(this.priceText(right, t.price)));
          for (const p of [pMin, pMax]) need = Math.max(need, this.mainText.measure(this.priceText(right, p)));
        }
        need = Math.max(Math.ceil(need + 2 * AXIS_PAD), fs * 4);
      }
      if (need > this.axisW || need < this.axisW - 8) {
        this.axisW = need;
        continue;
      }
      break;
    }
    this.timeTicks = [];
    const vis = this.ts.visibleBars();
    if (this.opts.timeScale.visible && vis) {
      this.timeTicks = planTimeTicks({
        cal: this.index.cal, count: this.index.count, from: vis.from, to: vis.to,
        xOf: i => this.ts.indexToX(i), barSpacing: this.ts.barSpacing, plotW: this.paneW, kind: this.index.kind,
        measure: (text, weight) => this.mainText.measure(text, weight),
        text: { hours12: this.opts.localization.hours12, dateOrder: this.opts.localization.dateOrder },
      });
    }
    this.placeLink();
  }

  // ── painting ──

  private paintMain(): void {
    this.layout();
    const { ctx } = this.main;
    const hpr = this.main.hpr;
    const vpr = this.main.vpr;
    const bw = this.main.canvas.width;
    const bh = this.main.canvas.height;
    const c = this.colors;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.background;
    ctx.fillRect(0, 0, bw, bh);
    const paneDW = Math.round(this.paneW * hpr);
    const paneDH = Math.round(this.paneH * vpr);
    const right = this.scales.get('right') as PriceScaleModel;

    // Grid, one device pixel.
    ctx.fillStyle = c.grid;
    if (this.opts.grid.horzLines) for (const t of this.rightTicks) {
      const y = Math.round(right.priceToY(t.price) * vpr);
      if (y >= 0 && y < paneDH) ctx.fillRect(0, y, paneDW, 1);
    }
    if (this.opts.grid.vertLines) for (const t of this.timeTicks) ctx.fillRect(Math.floor(t.x * hpr), 0, 1, paneDH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, paneDW, paneDH);
    ctx.clip();
    this.drawPrimitives('bottom');
    const vis = this.ts.visibleBars();
    if (vis) for (const s of this.series) this.drawSeries(s, vis, paneDW, paneDH);
    this.drawPrimitives('normal');
    this.drawPriceLines(paneDW);
    this.drawPrimitives('top');
    ctx.restore();

    // Axes, in CSS px.
    ctx.setTransform(hpr, 0, 0, vpr, 0, 0);
    if (right.options.visible && this.axisW > 0) this.drawPriceAxis(right);
    if (this.timeH > 0) {
      const y = this.paneH + this.timeH / 2;
      for (const t of this.timeTicks) this.mainText.draw(t.text, t.textX, y, t.level === 1 ? c.mutedText : c.text, tickWeight(t.level), 'center');
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const range = this.ts.visibleLogicalRange();
    if (this.rangeSubs.size > 0 && (range?.from !== this.lastRange?.from || range?.to !== this.lastRange?.to)) {
      for (const h of this.rangeSubs) h(range ? { ...range } : null);
    }
    this.lastRange = range;
  }

  private drawSeries(s: AnyModel, vis: { from: number; to: number }, paneDW: number, paneDH: number): void {
    if (!s.options.visible || s.count === 0) return;
    const rr = s.rowRange(vis.from, vis.to);
    if (!rr) return;
    const scale = this.scaleFor(s);
    if (scale.isEmpty()) return;
    const hpr = this.main.hpr;
    const vpr = this.main.vpr;
    const ts = this.ts;
    const pos = s.pos;
    const scope: SeriesDrawScope<RowBase, object> = {
      ctx: this.main.ctx,
      pixelRatio: hpr,
      rows: s.rows,
      from: Math.max(0, rr.from - 1),
      to: Math.min(s.count - 1, rr.to + 1),
      x: i => ts.indexToX(pos[i]) * hpr,
      y: p => scale.priceToY(p) * vpr,
      barSpacing: ts.barSpacing * hpr,
      options: s.options,
      colors: this.colors,
      pane: { x: 0, y: 0, width: paneDW, height: paneDH },
    };
    this.main.ctx.save();
    s.def.draw(scope);
    this.main.ctx.restore();
  }

  private drawPriceLines(paneDW: number): void {
    const ctx = this.main.ctx;
    const vpr = this.main.vpr;
    const hpr = this.main.hpr;
    for (const s of this.series) {
      if (!s.options.visible || !s.options.priceLineVisible) continue;
      const row = s.lastRow();
      if (!row) continue;
      const y = this.scaleFor(s).priceToY(s.def.value(row));
      if (!Number.isFinite(y)) continue;
      const yd = Math.floor(y * vpr) + 0.5;
      ctx.save();
      ctx.strokeStyle = s.def.lastValueColor(row, s.options, this.colors);
      ctx.lineWidth = 1;
      ctx.setLineDash([Math.max(1, Math.round(2 * hpr)), Math.max(1, Math.round(3 * hpr))]);
      ctx.beginPath();
      ctx.moveTo(0, yd);
      ctx.lineTo(paneDW, yd);
      ctx.stroke();
      ctx.restore();
    }
  }

  private primitiveScope(p: ChartPrimitive, ctx: CanvasRenderingContext2D, owner: AnyModel | null, text: TextPainter, hpr: number): PrimitiveDrawScope {
    const scale = owner ? this.scaleFor(owner) : this.ensureScale(p.priceScaleId ?? 'right');
    return {
      ctx,
      pixelRatio: hpr,
      pane: { x: 0, y: 0, width: this.paneW, height: this.paneH },
      colors: this.colors,
      fontFamily: this.opts.fontFamily,
      fontSize: this.opts.fontSize,
      visibleLogicalRange: this.ts.visibleLogicalRange(),
      timeToX: time => {
        const slot = this.index.indexOf(timeToSeconds(time));
        return slot >= 0 ? this.ts.indexToX(slot) : null;
      },
      logicalToX: l => this.ts.indexToX(l),
      priceToY: price => { const y = scale.priceToY(price); return Number.isFinite(y) ? y : null; },
      text: (t, x, y, color, weight, align) => text.draw(t, x, y, color, weight, align),
      measureText: (t, weight) => text.measure(t, weight),
      formatPrice: price => this.priceText(scale, price),
    };
  }

  private eachPrimitive(fn: (p: ChartPrimitive, owner: AnyModel | null) => void): void {
    for (const p of this.panePrims) fn(p, null);
    for (const s of this.series) if (s.options.visible) for (const p of s.primitives) fn(p, s);
  }

  private drawPrimitives(z: 'bottom' | 'normal' | 'top'): void {
    const { ctx, hpr, vpr } = this.main;
    this.eachPrimitive((p, owner) => {
      if (!p.draw || (p.zOrder ?? 'normal') !== z) return;
      ctx.save();
      ctx.setTransform(hpr, 0, 0, vpr, 0, 0);
      p.draw(this.primitiveScope(p, ctx, owner, this.mainText, hpr));
      ctx.restore();
    });
  }

  private tagHeight(): number { return this.opts.fontSize + 8; }

  private drawTag(text: TextPainter, ctx: CanvasRenderingContext2D, y: number, label: string, fill: string, color: string): void {
    const h = this.tagHeight();
    const x = this.paneW + 1;
    const w = this.axisW - 2;
    ctx.fillStyle = fill;
    ctx.beginPath();
    roundRect(ctx, x, y - h / 2, w, h, 4);
    ctx.fill();
    text.draw(label, this.cssW - AXIS_PAD, y, color, 500, 'right');
  }

  private drawPriceAxis(right: PriceScaleModel): void {
    const ctx = this.main.ctx;
    const fs = this.opts.fontSize;
    const h = this.tagHeight();
    const tags: Tag[] = [];
    for (const s of this.series) {
      if (!s.options.visible || !s.options.lastValueVisible || s.options.priceScaleId !== 'right') continue;
      const row = s.lastRow();
      if (!row) continue;
      const v = s.def.value(row);
      const y = right.priceToY(v);
      if (!Number.isFinite(y)) continue;
      const fill = s.def.lastValueColor(row, s.options, this.colors);
      tags.push({ y, text: this.priceText(right, v), fill, color: readableTextOn(fill) });
    }
    this.eachPrimitive((p, owner) => {
      if (!p.priceAxisLabels) return;
      const scale = owner ? this.scaleFor(owner) : this.ensureScale(p.priceScaleId ?? 'right');
      if (scale !== right) return;
      for (const l of p.priceAxisLabels()) {
        const y = right.priceToY(l.price);
        if (!Number.isFinite(y)) continue;
        tags.push({ y, text: l.text ?? this.priceText(right, l.price), fill: l.color, color: l.textColor ?? readableTextOn(l.color) });
      }
    });
    // Tags never overlap: pushed apart, top to bottom, then kept inside the pane.
    tags.sort((a, b) => a.y - b.y);
    for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < h) tags[i].y = tags[i - 1].y + h;
    for (const t of tags) t.y = Math.max(h / 2, Math.min(this.paneH - h / 2, t.y));

    for (const t of this.rightTicks) {
      const y = right.priceToY(t.price);
      if (!(y >= fs / 2 + 1 && y <= this.paneH - fs / 2 - 1)) continue;
      if (tags.some(tag => Math.abs(tag.y - y) < h * 0.9)) continue;
      this.mainText.draw(this.priceText(right, t.price), this.cssW - AXIS_PAD, y, this.colors.text, 400, 'right');
    }
    for (const t of tags) this.drawTag(this.mainText, ctx, t.y, t.text, t.fill, t.color);
    this.axisTags = tags;
  }

  private paintOverlay(): void {
    const { ctx, hpr, vpr } = this.top;
    const c = this.colors;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.top.canvas.width, this.top.canvas.height);
    const paneDW = Math.round(this.paneW * hpr);
    const paneDH = Math.round(this.paneH * vpr);
    const cross = this.cross;
    const showCross = cross !== null && this.opts.crosshair.mode !== 'hidden' && this.index.count > 0;
    if (showCross) {
      const x = this.ts.indexToX(cross.slot);
      const y = this.crossY(cross);
      ctx.save();
      ctx.strokeStyle = c.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([Math.max(2, Math.round(4 * hpr)), Math.max(2, Math.round(3 * hpr))]);
      ctx.beginPath();
      const xd = Math.floor(x * hpr) + 0.5;
      if (xd >= 0 && xd <= paneDW) { ctx.moveTo(xd, 0); ctx.lineTo(xd, paneDH); }
      const yd = Math.floor(y * vpr) + 0.5;
      if (yd >= 0 && yd <= paneDH) { ctx.moveTo(0, yd); ctx.lineTo(paneDW, yd); }
      ctx.stroke();
      ctx.restore();

      // Dots on the hovered values of series that ask for one.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, paneDW, paneDH);
      ctx.clip();
      for (const s of this.series) {
        if (!s.options.visible || !s.def.crosshairMarker) continue;
        const r = s.rowAtSlot(cross.slot);
        const row = r >= 0 ? s.rows[r] : null;
        if (!row) continue;
        const m = s.def.crosshairMarker(row, s.options, c);
        if (!m) continue;
        const my = this.scaleFor(s).priceToY(m.price);
        if (!Number.isFinite(my)) continue;
        ctx.beginPath();
        ctx.arc(x * hpr, my * vpr, 4.5 * hpr, 0, Math.PI * 2);
        ctx.fillStyle = c.background;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x * hpr, my * vpr, 3 * hpr, 0, Math.PI * 2);
        ctx.fillStyle = m.color;
        ctx.fill();
      }
      ctx.restore();
    }

    this.eachPrimitive((p, owner) => {
      if (!p.drawOverlay) return;
      ctx.save();
      ctx.setTransform(hpr, 0, 0, vpr, 0, 0);
      ctx.beginPath();
      ctx.rect(0, 0, this.paneW, this.paneH);
      ctx.clip();
      const scope = this.primitiveScope(p, ctx, owner, this.topText, hpr);
      p.drawOverlay({ ...scope, crosshair: showCross && cross ? { x: this.ts.indexToX(cross.slot), y: this.crossY(cross), logical: cross.slot } : null });
      ctx.restore();
    });

    ctx.setTransform(hpr, 0, 0, vpr, 0, 0);
    if (showCross && this.opts.crosshair.labels && cross) {
      const right = this.scales.get('right') as PriceScaleModel;
      const y = this.crossY(cross);
      if (right.options.visible && !right.isEmpty() && y >= 0 && y <= this.paneH) {
        const h = this.tagHeight();
        const ty = Math.max(h / 2, Math.min(this.paneH - h / 2, y));
        // Blank the axis under the tag, widened to whole labels: nothing shows half cut around it.
        let top = ty - h / 2;
        let bottom = ty + h / 2;
        const half = this.opts.fontSize / 2 + 2;
        for (const t of this.rightTicks) {
          const ly = right.priceToY(t.price);
          if (ly + half > top && ly - half < bottom) { top = Math.min(top, ly - half); bottom = Math.max(bottom, ly + half); }
        }
        for (const t of this.axisTags) {
          if (t.y + h / 2 > top && t.y - h / 2 < bottom) { top = Math.min(top, t.y - h / 2); bottom = Math.max(bottom, t.y + h / 2); }
        }
        ctx.fillStyle = c.background;
        ctx.fillRect(this.paneW, Math.max(0, top), this.axisW, Math.min(this.paneH, bottom) - Math.max(0, top));
        this.drawTag(this.topText, ctx, ty, this.priceText(right, right.yToPrice(y)), c.tagBackground, c.tagText);
      }
      if (this.timeH > 0) {
        const label = this.stampText(cross.slot);
        const w = this.topText.measure(label, 500) + 2 * AXIS_PAD;
        const x = this.ts.indexToX(cross.slot);
        const left = Math.max(0, Math.min(this.paneW - w, x - w / 2));
        const h = this.tagHeight();
        let l = left;
        let r = left + w;
        for (const t of this.timeTicks) {
          const tl = t.textX - t.width / 2 - 2;
          const tr = t.textX + t.width / 2 + 2;
          if (tr > l && tl < r) { l = Math.min(l, tl); r = Math.max(r, tr); }
        }
        ctx.fillStyle = c.background;
        ctx.fillRect(Math.max(0, l), this.paneH, Math.min(this.paneW, r) - Math.max(0, l), this.timeH);
        ctx.fillStyle = c.tagBackground;
        ctx.beginPath();
        roundRect(ctx, left, this.paneH + (this.timeH - h) / 2, w, h, 4);
        ctx.fill();
        this.topText.draw(label, left + w / 2, this.paneH + this.timeH / 2, c.tagText, 500, 'center');
      }
    }
    if (this.focusVisible()) {
      ctx.strokeStyle = c.focusRing;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(1, 1, this.cssW - 2, this.cssH - 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private focusVisible(): boolean {
    if (this.doc.activeElement !== this.root) return false;
    try { return this.root.matches(':focus-visible'); } catch { return true; }
  }

  private crossY(cross: { y: number; slot: number }): number {
    if (this.opts.crosshair.mode !== 'magnet') return cross.y;
    const s = this.mainSeriesOf('right');
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

  // ── input target ──

  interaction() { return this.opts.interaction; }

  hit(x: number, y: number): HitArea {
    if (x < 0 || y < 0 || x > this.cssW || y > this.cssH) return 'none';
    if (y > this.paneH) return x <= this.paneW ? 'time' : 'none';
    return x > this.paneW ? 'price' : 'pane';
  }

  private eventParams(point: { x: number; y: number } | null): MouseEventParams {
    const seriesData = new Map<SeriesApi<AnySeriesDefinition>, RowBase>();
    if (!point || this.index.count === 0) return { seriesData };
    const slot = Math.round(this.ts.xToIndex(point.x));
    if (slot < 0 || slot >= this.index.count) return { point, logical: slot, seriesData };
    for (const s of this.series) {
      const r = s.rowAtSlot(slot);
      const row = r >= 0 ? s.rows[r] : null;
      const h = this.handles.get(s);
      if (row && h) seriesData.set(h, row);
    }
    return { time: this.timeAt(slot), logical: slot, point, seriesData };
  }

  setCrosshair(point: { x: number; y: number } | null): void {
    const prev = this.cross;
    if (point && this.index.count > 0 && point.x <= this.paneW && point.y <= this.paneH) {
      const slot = Math.max(0, Math.min(this.index.count - 1, Math.round(this.ts.xToIndex(point.x))));
      this.cross = { x: point.x, y: point.y, slot };
    } else this.cross = null;
    if (prev === null && this.cross === null) return;
    this.invalidate(OVERLAY);
    if (this.crossSubs.size > 0) {
      const params = this.eventParams(this.cross ? point : null);
      for (const h of this.crossSubs) h(params);
    }
  }

  private refreshCrossSlot(): void {
    if (!this.cross) return;
    this.cross.slot = Math.max(0, Math.min(this.index.count - 1, Math.round(this.ts.xToIndex(this.cross.x))));
  }

  pan(dx: number, dy: number): void {
    this.ts.pan(dx);
    if (dy !== 0) {
      const right = this.scales.get('right') as PriceScaleModel;
      if (!right.options.autoScale) right.shiftBy(dy);
    }
    this.refreshCrossSlot();
    this.invalidate(MAIN | OVERLAY);
  }

  zoom(anchorX: number, factor: number): void {
    this.ts.zoom(anchorX, factor);
    this.refreshCrossSlot();
    this.invalidate(MAIN | OVERLAY);
  }

  stretchPrice(dy: number): void {
    const right = this.scales.get('right') as PriceScaleModel;
    if (right.isEmpty()) return;
    right.options.autoScale = false;
    right.scaleBy(Math.exp(dy * 0.005));
    this.invalidate(MAIN | OVERLAY);
  }

  resetView(): void {
    this.ts.reset();
    for (const s of this.scales.values()) s.options.autoScale = true;
    this.invalidate(MAIN | OVERLAY);
  }

  panBars(bars: number): void { this.pan(-bars * this.ts.barSpacing, 0); }
  zoomCentre(factor: number): void { this.zoom(this.paneW / 2, factor); }
  home(): void {
    if (this.index.count === 0) return;
    this.ts.rightOffset = -this.ts.last() + this.paneW / this.ts.barSpacing - 1;
    this.ts.clamp();
    this.invalidate(MAIN | OVERLAY);
  }
  end(): void { this.ts.scrollToRealTime(); this.invalidate(MAIN | OVERLAY); }
  click(point: { x: number; y: number }): void {
    if (this.clickSubs.size === 0) return;
    const params = this.eventParams(point);
    for (const h of this.clickSubs) h(params);
  }
  paneWidth(): number { return this.paneW; }
  reducedMotion(): boolean { return !!this.motionQuery?.matches; }
  focusChanged(): void { this.invalidate(OVERLAY); }

  // ── public API ──

  timeScale(): TimeScaleApi {
    const chart = this;
    const ts = this.ts;
    const done = (): void => { chart.refreshCrossSlot(); chart.invalidate(MAIN | OVERLAY); };
    const ensureWidth = (): void => { if (!(ts.width > 0) || chart.dirty & LAYOUT) { chart.measure(); chart.layout(); } };
    return {
      fitContent() { ensureWidth(); ts.fitContent(); chart.needsInitialView = false; done(); },
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
      setVisibleRange(range: TimeRange) {
        ensureWidth();
        const a = chart.index.lowerBound(timeToSeconds(range.from));
        let b = chart.index.lowerBound(timeToSeconds(range.to));
        if (b >= chart.index.count || chart.index.times[b] > timeToSeconds(range.to)) b -= 1;
        if (b < a) return;
        ts.setVisibleLogicalRange({ from: a, to: b });
        chart.needsInitialView = false;
        done();
      },
      getVisibleLogicalRange: () => { const r = ts.visibleLogicalRange(); return r ? { ...r } : null; },
      setVisibleLogicalRange(range: LogicalRange) { ensureWidth(); ts.setVisibleLogicalRange(range); chart.needsInitialView = false; done(); },
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
      width: () => chart.paneW,
      applyOptions(o: DeepPartial<ChartTimeScaleOptions>) { chart.applyOptions({ timeScale: o }); },
      options: () => chart.opts.timeScale,
      subscribeVisibleLogicalRangeChange(h: LogicalRangeChangeHandler) { chart.rangeSubs.add(h); },
      unsubscribeVisibleLogicalRangeChange(h: LogicalRangeChangeHandler) { chart.rangeSubs.delete(h); },
    };
  }

  priceScale(id = 'right'): PriceScaleApi {
    const scale = this.ensureScale(id);
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
      width: () => (id === 'right' && scale.options.visible ? chart.axisW : 0),
    };
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

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    if (this.raf) this.win.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.input.destroy();
    for (const f of this.cleanups) f();
    this.cleanups = [];
    this.eachPrimitive(p => p.detached?.());
    this.panePrims = [];
    this.crossSubs.clear();
    this.clickSubs.clear();
    this.rangeSubs.clear();
    this.main.destroy();
    this.top.destroy();
    this.link?.remove();
    this.root.remove();
    this.series = [];
    this.handles.clear();
  }
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
