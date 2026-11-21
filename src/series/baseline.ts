// Baseline series: a line around `baseValue`, drawn and filled in the up colour above it and the down colour below.
// The line is cut exactly where it crosses the base level (in screen space, so log and percent scales stay right),
// which is also where each colour's fill polygon starts and ends. Four paths per frame: two strokes, two fills.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { deviceWidth } from '../render/pixel';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';
import { collectPoints, withAlpha } from './area';

export interface BaselineData extends RowBase {
  time: Time;
  value: number;
}

export interface BaselineOptions {
  /** The level the line is split around. Default 0. */
  baseValue: number;
  /** Colour above the base. Defaults to the theme's up colour. */
  upColor?: string;
  /** Colour below the base. Defaults to the theme's down colour. */
  downColor?: string;
  /** CSS px. */
  lineWidth: number;
  /** Opacity of the fills between the line and the base, 0 to 1. Default 0.18. */
  fillOpacity: number;
  crosshairMarkerVisible: boolean;
}

/**
 * x where the segment (x0,y0)-(x1,y1) meets the horizontal level `level`. The caller guarantees the ends are on
 * opposite sides; a flat or already-touching segment returns the nearer end.
 */
export function crossingX(x0: number, y0: number, x1: number, y1: number, level: number): number {
  const dy = y1 - y0;
  if (dy === 0) return x0;
  const t = (level - y0) / dy;
  return x0 + (x1 - x0) * (t < 0 ? 0 : t > 1 ? 1 : t);
}

/** 0 above the level (smaller y), 1 below it, `prev` when exactly on it. */
export function sideOf(y: number, level: number, prev: number): number {
  return y < level ? 0 : y > level ? 1 : prev;
}

/**
 * Trace the parts of the polyline that lie on `side` into the current path: strokes (fill = false) or polygons
 * closed along the level (fill = true). NaN y entries are gaps. Exported for tests through a recording sink.
 */
export function traceSide(
  sink: Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo' | 'closePath'>,
  xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, level: number, side: number, fill: boolean,
): void {
  let have = false;
  let open = false;
  let px = 0;
  let py = 0;
  let ps = 0;
  const begin = (bx: number, by: number): void => {
    if (fill) { sink.moveTo(bx, level); sink.lineTo(bx, by); } else sink.moveTo(bx, by);
    open = true;
  };
  const end = (ex: number): void => {
    if (!open) return;
    if (fill) { sink.lineTo(ex, level); sink.closePath(); }
    open = false;
  };
  for (let k = 0; k < n; k++) {
    const y = ys[k];
    if (Number.isNaN(y)) { end(px); have = false; continue; }
    const x = xs[k];
    const s = sideOf(y, level, have ? ps : 0);
    if (!have) {
      if (s === side) begin(x, y);
    } else if (s === ps) {
      if (s === side) sink.lineTo(x, y);
    } else {
      const xc = crossingX(px, py, x, y, level);
      if (ps === side) { sink.lineTo(xc, level); end(xc); }
      if (s === side) { begin(xc, level); sink.lineTo(x, y); }
    }
    have = true;
    px = x; py = y; ps = s;
  }
  end(px);
}

function drawBaseline(s: SeriesDrawScope<BaselineData, BaselineOptions>): void {
  const { ctx, options: o, colors } = s;
  const level = s.y(o.baseValue);
  if (!Number.isFinite(level)) return;
  const { n, xs, ys } = collectPoints(s, r => r.value);
  if (n === 0) return;
  const colorOf = [o.upColor ?? colors.up, o.downColor ?? colors.down];
  for (let side = 0; side < 2; side++) {
    ctx.beginPath();
    traceSide(ctx, xs, ys, n, level, side, true);
    ctx.fillStyle = withAlpha(colorOf[side], o.fillOpacity);
    ctx.fill();
  }
  ctx.lineWidth = deviceWidth(o.lineWidth, s.pixelRatio);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  for (let side = 0; side < 2; side++) {
    ctx.beginPath();
    traceSide(ctx, xs, ys, n, level, side, false);
    ctx.strokeStyle = colorOf[side];
    ctx.stroke();
  }
}

export const BaselineSeries: SeriesDefinition<BaselineData, BaselineOptions> = {
  type: 'baseline',
  defaults: { baseValue: 0, lineWidth: 2, fillOpacity: 0.18, crosshairMarkerVisible: true },
  normalize(input) {
    if (input.value === undefined) return null;
    const v = input.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`Chartist Lite: baseline row needs a finite "value" (time ${JSON.stringify(input.time)})`);
    }
    return { time: copyTime(input.time), value: v };
  },
  value: r => r.value,
  low: r => r.value,
  high: r => r.value,
  lastValueColor: (r, o, c) => (r.value >= o.baseValue ? o.upColor ?? c.up : o.downColor ?? c.down),
  draw: drawBaseline,
  crosshairMarker: (r, o, c) => (o.crosshairMarkerVisible
    ? { price: r.value, color: r.value >= o.baseValue ? o.upColor ?? c.up : o.downColor ?? c.down }
    : null),
};
