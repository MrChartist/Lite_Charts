// Small canvas primitives: a filled band between two line datasets (Bollinger, Keltner), a price line that starts at a
// bar and runs to the right edge, thin vertical session breaks at day boundaries, and a vertical line at a time with a
// label. No DOM; each returns a handle that takes it away.

import type { ChartApi } from '../../api';
import type { Time } from '../../core/time';
import { timeToSeconds } from '../../core/time';
import { readableTextOn } from '../../core/theme';
import { zoneDayNumber } from '../../core/zone';
import type { ChartPrimitive, PriceAxisLabel, PrimitiveDrawScope, PrimitiveHost } from '../primitive';
import type { PriceLineStyle } from '../price-line';
import { dashPattern } from '../price-line';
import type { AnySeries, Removable } from './common';
import { lowerBoundRows, removable, withAlpha, zoneOf } from './common';

const SERIES_REMOVE = (series: AnySeries, prim: ChartPrimitive): void => { try { series.detachPrimitive(prim); } catch { /* series removed */ } };

// ── bands ──

export interface BandRow { time: Time; value?: number }

export interface BandsOptions {
  /** The upper edge. Rows without a `value` (whitespace) break the band. */
  upper: readonly BandRow[];
  lower: readonly BandRow[];
  /** CSS colour of the fill. Default: the theme's line colour at 14%. */
  fill?: string;
  /** Draw the two edges too (CSS colour). Default none: add line series for the edges if you want them. */
  lineColor?: string;
  /** Pass the chart to make autoscale keep the whole band in view. */
  chart?: ChartApi;
}

export interface BandsHandle extends Removable {
  setData(upper: readonly BandRow[], lower: readonly BandRow[]): void;
  applyOptions(options: Partial<BandsOptions>): void;
}

interface Edge { t: Float64Array; v: Float64Array }

function toEdge(rows: readonly BandRow[]): Edge {
  const t = new Float64Array(rows.length);
  const v = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    t[i] = timeToSeconds(rows[i].time);
    v[i] = typeof rows[i].value === 'number' && Number.isFinite(rows[i].value) ? (rows[i].value as number) : NaN;
  }
  return { t, v };
}

/**
 * Pair two edges by time into parallel arrays (rows where either side is missing become NaN pairs), so the draw loop
 * walks one index. Times from both edges are merged; the result is ascending. Pure.
 */
export function pairEdges(a: Edge, b: Edge): { t: Float64Array; up: Float64Array; lo: Float64Array } {
  const times: number[] = [];
  const up: number[] = [];
  const lo: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.t.length || j < b.t.length) {
    const ta = i < a.t.length ? a.t[i] : Infinity;
    const tb = j < b.t.length ? b.t[j] : Infinity;
    const t = Math.min(ta, tb);
    times.push(t);
    up.push(ta === t ? a.v[i] : NaN);
    lo.push(tb === t ? b.v[j] : NaN);
    if (ta === t) i++;
    if (tb === t) j++;
  }
  return { t: Float64Array.from(times), up: Float64Array.from(up), lo: Float64Array.from(lo) };
}

/** Min and max of the band between logical indices (rows paired by `pairEdges`), or null when none is finite. Pure. */
export function bandExtent(up: Float64Array, lo: Float64Array, from: number, to: number): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = Math.max(0, from); i <= Math.min(up.length - 1, to); i++) {
    if (!Number.isFinite(up[i]) || !Number.isFinite(lo[i])) continue;
    min = Math.min(min, up[i], lo[i]);
    max = Math.max(max, up[i], lo[i]);
  }
  return min <= max ? { min, max } : null;
}

export function createBands(series: AnySeries, options: BandsOptions): BandsHandle {
  let opts = options;
  if (!opts || !Array.isArray(opts.upper) || !Array.isArray(opts.lower)) throw new TypeError('Chartist Lite: createBands needs "upper" and "lower" arrays of { time, value }');
  let pair = pairEdges(toEdge(opts.upper), toEdge(opts.lower));
  let host: PrimitiveHost | null = null;

  const prim: ChartPrimitive = {
    zOrder: 'bottom',
    attached(h) { host = h; },
    detached() { host = null; },
    draw(s) {
      const n = pair.t.length;
      if (n === 0) return;
      const { ctx, pane } = s;
      // Find the visible rows by x: the first row at or right of the pane's left edge, the last at or left of its right edge.
      const xAt = (i: number): number => { const x = s.timeToX(pair.t[i] as number); return x === null ? NaN : x; };
      const left = pane.x - 4;
      const right = pane.x + pane.width + 4;
      let lo = 0;
      let hi = n - 1;
      // Binary search over rows; a row whose time has no slot on the axis is skipped by looking at its neighbour.
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        let k = mid;
        let x = xAt(k);
        while (Number.isNaN(x) && k < hi) x = xAt(++k);
        if (Number.isNaN(x) || x >= left) hi = mid; else lo = k + 1;
      }
      const first = Math.max(0, lo - 1);
      const x0 = xAt(first);
      if (!Number.isFinite(x0) && first >= n - 1) return;
      // Rows per pixel decides the stride: a long zoomed-out band draws about one vertex per pixel.
      const lastGuess = Math.min(n - 1, first + Math.ceil(pane.width * 4));
      const xl = xAt(lastGuess);
      const rowsPerPx = Number.isFinite(xl) && xl > x0 ? (lastGuess - first) / (xl - x0) : 1;
      const stride = Math.max(1, Math.floor(rowsPerPx));
      const fill = opts.fill ?? withAlpha(s.colors.line, 0.14);
      ctx.save();
      ctx.fillStyle = fill;
      let segX: number[] = [];
      let segUp: number[] = [];
      let segLo: number[] = [];
      const flush = (): void => {
        if (segX.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(segX[0], segUp[0]);
          for (let k = 1; k < segX.length; k++) ctx.lineTo(segX[k], segUp[k]);
          for (let k = segX.length - 1; k >= 0; k--) ctx.lineTo(segX[k], segLo[k]);
          ctx.closePath();
          ctx.fill();
          if (opts.lineColor) {
            ctx.strokeStyle = opts.lineColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(segX[0], segUp[0]);
            for (let k = 1; k < segX.length; k++) ctx.lineTo(segX[k], segUp[k]);
            ctx.moveTo(segX[0], segLo[0]);
            for (let k = 1; k < segX.length; k++) ctx.lineTo(segX[k], segLo[k]);
            ctx.stroke();
          }
        }
        segX = []; segUp = []; segLo = [];
      };
      for (let i = first; i < n; i += stride) {
        const x = xAt(i);
        if (Number.isNaN(x)) continue;
        const u = pair.up[i];
        const l = pair.lo[i];
        const yu = Number.isFinite(u) ? s.priceToY(u) : null;
        const yl = Number.isFinite(l) ? s.priceToY(l) : null;
        if (yu === null || yl === null) { flush(); continue; }
        segX.push(x); segUp.push(yu); segLo.push(yl);
        if (x > right) break;
      }
      flush();
      ctx.restore();
    },
    autoscale(range) {
      const chart = opts.chart;
      if (!chart || pair.t.length === 0) return null;
      const ts = chart.timeScale();
      // Rows are ascending in time, and timeToLogical is increasing, so bisect for the first visible row.
      let lo = 0;
      let hi = pair.t.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const l = ts.timeToLogical(pair.t[mid]);
        if (l !== null && l < range.from - 1) lo = mid + 1; else hi = mid;
      }
      let end = lo;
      while (end < pair.t.length - 1) { const l = ts.timeToLogical(pair.t[end + 1]); if (l === null || l > range.to + 1) break; end++; }
      return bandExtent(pair.up, pair.lo, lo, end);
    },
  };
  series.attachPrimitive(prim);
  return removable({
    setData(upper: readonly BandRow[], lower: readonly BandRow[]) { pair = pairEdges(toEdge(upper), toEdge(lower)); host?.requestUpdate(); },
    applyOptions(patch: Partial<BandsOptions>) {
      opts = { ...opts, ...patch };
      if (patch.upper || patch.lower) pair = pairEdges(toEdge(opts.upper), toEdge(opts.lower));
      host?.requestUpdate();
    },
  }, () => SERIES_REMOVE(series, prim));
}

// ── partial price line ──

export interface PartialPriceLineOptions {
  /** The bar the line starts at (the first bar at or after it when the time is not a bar). */
  fromTime: Time;
  price: number;
  /** CSS colour; default the theme's line colour. */
  color?: string;
  lineWidth: number;
  lineStyle: PriceLineStyle;
  /** Text at the right end, above the line. */
  title: string;
  /** A tag with the price on the axis. Default true. */
  axisLabelVisible: boolean;
}

export interface PartialPriceLineHandle extends Removable {
  applyOptions(options: Partial<PartialPriceLineOptions>): void;
  options(): Readonly<PartialPriceLineOptions>;
}

export function createPartialPriceLine(series: AnySeries, options: Partial<PartialPriceLineOptions> & { fromTime: Time; price: number }): PartialPriceLineHandle {
  const check = (o: PartialPriceLineOptions): void => {
    if (typeof o.price !== 'number' || !Number.isFinite(o.price)) throw new TypeError('Chartist Lite: partial price line "price" must be a finite number');
    timeToSeconds(o.fromTime);
    if (!(o.lineWidth > 0)) throw new TypeError('Chartist Lite: partial price line "lineWidth" must be above 0');
  };
  let opts: PartialPriceLineOptions = { lineWidth: 1, lineStyle: 'dashed', title: '', axisLabelVisible: true, ...options };
  check(opts);
  let host: PrimitiveHost | null = null;
  let cache: { n: number; at: number; t: number } | null = null;

  /** The bar the line starts at: the exact time, else the first row after it. */
  const startTime = (s: PrimitiveDrawScope): Time | null => {
    if (s.timeToX(opts.fromTime) !== null) return opts.fromTime;
    const rows = series.data() as readonly { time: Time }[];
    const sec = timeToSeconds(opts.fromTime);
    if (cache && cache.n === rows.length && cache.at === sec) return rows[cache.t]?.time ?? null;
    const i = lowerBoundRows(rows, sec);
    cache = { n: rows.length, at: sec, t: i };
    return i < rows.length ? rows[i].time : null;
  };

  const prim: ChartPrimitive = {
    zOrder: 'normal',
    attached(h) { host = h; },
    detached() { host = null; },
    draw(s) {
      const y = s.priceToY(opts.price);
      const t = startTime(s);
      if (y === null || t === null) return;
      const sx = s.timeToX(t);
      if (sx === null) return;
      const { ctx, pane, pixelRatio: r } = s;
      const x0 = Math.max(pane.x, sx);
      if (x0 > pane.x + pane.width) return;
      const color = opts.color ?? s.colors.line;
      const w = Math.max(1, Math.round(opts.lineWidth * r));
      const yc = (Math.floor(y * r) + 0.5) / r;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = w / r;
      ctx.setLineDash(dashPattern(opts.lineStyle, w).map(d => d / r));
      ctx.beginPath();
      ctx.moveTo(x0, yc);
      ctx.lineTo(pane.x + pane.width, yc);
      ctx.stroke();
      ctx.setLineDash([]);
      if (sx >= pane.x) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx, yc, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (opts.title) {
        const size = Math.max(12, s.fontSize);
        ctx.font = `500 ${size}px ${s.fontFamily}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        const tw = ctx.measureText(opts.title).width;
        const right = pane.x + pane.width - 6;
        const ty = yc - size / 2 - 4;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = s.colors.background;
        ctx.fillRect(right - tw - 4, ty - size / 2 - 1, tw + 8, size + 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.fillText(opts.title, right, ty);
      }
      ctx.restore();
    },
    priceAxisLabels(colors): readonly PriceAxisLabel[] {
      return opts.axisLabelVisible ? [{ price: opts.price, color: opts.color ?? colors.line }] : [];
    },
  };
  series.attachPrimitive(prim);
  return removable({
    applyOptions(patch: Partial<PartialPriceLineOptions>) {
      const next = { ...opts, ...patch };
      check(next);
      opts = next;
      cache = null;
      host?.requestUpdate();
    },
    options: () => ({ ...opts }),
  }, () => SERIES_REMOVE(series, prim));
}

// ── session breaks ──

export interface SessionBreaksOptions {
  /** IANA zone whose midnight is the break. Default: the chart's own time zone. */
  timeZone?: string;
  /** CSS colour. Default: the theme's pane separator. */
  color?: string;
  lineStyle: PriceLineStyle;
}

export interface SessionBreaksHandle extends Removable {
  applyOptions(options: Partial<SessionBreaksOptions>): void;
}

/** Logical indices (in `[from, to]`) of the first bar of each new local day, from the bars' day numbers. Pure. */
export function dayStarts(dayOf: (i: number) => number, from: number, to: number): number[] {
  const out: number[] = [];
  if (to <= from) return out;
  let prev = dayOf(from);
  for (let i = from + 1; i <= to; i++) {
    const d = dayOf(i);
    if (d !== prev) { out.push(i); prev = d; }
  }
  return out;
}

/** Bars are intraday when their median gap is under 90% of a day. */
export function isIntraday(gapsSeconds: readonly number[]): boolean {
  if (!gapsSeconds.length) return false;
  const g = [...gapsSeconds].sort((a, b) => a - b);
  return g[g.length >> 1] < 86_400 * 0.9;
}

export function createSessionBreaks(chart: ChartApi, options: Partial<SessionBreaksOptions> = {}): SessionBreaksHandle {
  let opts: SessionBreaksOptions = { lineStyle: 'solid', ...options };
  let host: PrimitiveHost | null = null;
  const prim: ChartPrimitive = {
    zOrder: 'bottom',
    attached(h) { host = h; },
    detached() { host = null; },
    draw(s) {
      const vr = s.visibleLogicalRange;
      if (!vr) return;
      const ts = chart.timeScale();
      const from = Math.max(0, Math.floor(vr.from));
      const to = Math.ceil(vr.to);
      // Too many bars to tell days apart: skip rather than paint a wall.
      if (to - from > 4000) return;
      const sec = (i: number): number => ts.logicalToTime(i) as number;
      const gaps: number[] = [];
      for (let i = from + 1; i <= Math.min(to, from + 40); i++) gaps.push(sec(i) - sec(i - 1));
      if (!isIntraday(gaps)) return;
      const zone = opts.timeZone === undefined ? zoneOf(chart) : opts.timeZone === 'local' ? zoneOf({ options: () => ({ timeScale: { timeZone: 'local' } }) } as unknown as ChartApi) : opts.timeZone;
      const spacing = s.logicalToX(1) - s.logicalToX(0);
      const starts = dayStarts(i => zoneDayNumber(zone, sec(i) * 1000), from, to);
      if (!starts.length) return;
      const { ctx, pane, pixelRatio: r } = s;
      const w = Math.max(1, Math.round(r));
      ctx.save();
      ctx.strokeStyle = opts.color ?? s.colors.paneSeparator;
      ctx.lineWidth = w / r;
      ctx.setLineDash(dashPattern(opts.lineStyle, w).map(d => d / r));
      ctx.beginPath();
      for (const i of starts) {
        const x = (Math.floor((s.logicalToX(i) - spacing / 2) * r) + 0.5) / r;
        if (x < pane.x || x > pane.x + pane.width) continue;
        ctx.moveTo(x, pane.y);
        ctx.lineTo(x, pane.y + pane.height);
      }
      ctx.stroke();
      ctx.restore();
    },
  };
  chart.attachPrimitive(prim);
  return removable({
    applyOptions(patch: Partial<SessionBreaksOptions>) { opts = { ...opts, ...patch }; host?.requestUpdate(); },
  }, () => { try { chart.detachPrimitive(prim); } catch { /* chart removed */ } });
}

// ── vertical line ──

export interface VerticalLineOptions {
  time: Time;
  /** Short text in a chip at the top of the line. */
  label?: string;
  /** CSS colour of the line and the chip. Default: muted ink for the line, the crosshair tag colours for the chip. */
  color?: string;
  lineStyle: PriceLineStyle;
  lineWidth: number;
}

export interface VerticalLineHandle extends Removable {
  applyOptions(options: Partial<VerticalLineOptions>): void;
  options(): Readonly<VerticalLineOptions>;
}

/** Left edge of a chip `w` wide for a line at `x`: right of the line unless it would pass `right`, else left of it. Pure. */
export function chipLeft(x: number, w: number, left: number, right: number): number {
  const gap = 4;
  if (x + gap + w <= right) return x + gap;
  return Math.max(left, x - gap - w);
}

export function createVerticalLine(chart: ChartApi, options: Partial<VerticalLineOptions> & { time: Time }): VerticalLineHandle {
  let opts: VerticalLineOptions = { lineStyle: 'dashed', lineWidth: 1, ...options };
  timeToSeconds(opts.time);
  let host: PrimitiveHost | null = null;
  const prim: ChartPrimitive = {
    zOrder: 'normal',
    attached(h) { host = h; },
    detached() { host = null; },
    draw(s) {
      const logical = chart.timeScale().timeToLogical(opts.time);
      if (logical === null) return;
      const x = s.logicalToX(logical);
      const { ctx, pane, pixelRatio: r } = s;
      if (x < pane.x - 1 || x > pane.x + pane.width + 1) return;
      const color = opts.color ?? s.colors.mutedText;
      const w = Math.max(1, Math.round(opts.lineWidth * r));
      const xc = (Math.floor(x * r) + 0.5) / r;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = w / r;
      ctx.setLineDash(dashPattern(opts.lineStyle, w).map(d => d / r));
      ctx.beginPath();
      ctx.moveTo(xc, pane.y);
      ctx.lineTo(xc, pane.y + pane.height);
      ctx.stroke();
      ctx.setLineDash([]);
      if (opts.label) {
        const size = Math.max(12, s.fontSize);
        ctx.font = `600 ${size}px ${s.fontFamily}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const tw = ctx.measureText(opts.label).width;
        const cw = Math.ceil(tw + 12);
        const ch = size + 8;
        const cx = chipLeft(xc, cw, pane.x + 2, pane.x + pane.width - 2);
        const cy = pane.y + 6;
        const fill = opts.color ?? s.colors.tagBackground;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(cx + 4, cy);
        ctx.arcTo(cx + cw, cy, cx + cw, cy + ch, 4);
        ctx.arcTo(cx + cw, cy + ch, cx, cy + ch, 4);
        ctx.arcTo(cx, cy + ch, cx, cy, 4);
        ctx.arcTo(cx, cy, cx + cw, cy, 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = opts.color ? readableTextOn(opts.color) : s.colors.tagText;
        ctx.fillText(opts.label, cx + 6, cy + ch / 2 + 0.5);
      }
      ctx.restore();
    },
  };
  chart.attachPrimitive(prim);
  return removable({
    applyOptions(patch: Partial<VerticalLineOptions>) { opts = { ...opts, ...patch }; timeToSeconds(opts.time); host?.requestUpdate(); },
    options: () => ({ ...opts }),
  }, () => { try { chart.detachPrimitive(prim); } catch { /* chart removed */ } });
}
