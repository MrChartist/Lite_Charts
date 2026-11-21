// Area series: a line with a vertical gradient fill down to the pane bottom. The fill is one path (one polygon per
// unbroken run of values) and the line one stroke, so a frame costs two draw calls whatever the zoom. Rows closer
// than one device pixel fold to the first, highest, lowest and last value of each pixel column (render/decimate.ts).

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { parseColor } from '../core/theme';
import { deviceWidth } from '../render/pixel';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';
import { decimateColumns } from '../render/decimate';

export interface AreaData extends RowBase {
  time: Time;
  value: number;
}

export interface AreaOptions {
  /** Line colour. Defaults to the theme's line colour. */
  lineColor?: string;
  /** CSS px. */
  lineWidth: number;
  /** Fill colour at the top of the gradient. Defaults to the line colour at 28% opacity. */
  topColor?: string;
  /** Fill colour at the pane bottom. Defaults to the line colour fully transparent. */
  bottomColor?: string;
  /** Dot at the hovered value while the crosshair is on. */
  crosshairMarkerVisible: boolean;
}

/** `color` with its alpha replaced; a colour that cannot be parsed is returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
}

// Scratch points for the visible rows, reused every frame. A NaN y is a gap marker.
let ptX = new Float64Array(512);
let ptY = new Float64Array(512);

/**
 * Visible rows as device points in the scratch arrays (one per pixel column, a single NaN entry per gap).
 * `valueOf` picks the number a row plots. Returns the point count. Shared by area and baseline.
 */
export function collectPoints<R extends RowBase>(
  s: Pick<SeriesDrawScope<R, unknown>, 'rows' | 'from' | 'to' | 'x' | 'y'> & { barSpacing?: number },
  valueOf: (r: R) => number,
): { n: number; xs: Float64Array; ys: Float64Array } {
  // Closer than one device pixel: per pixel column the first, highest, lowest and last value (the shared min/max
  // decimation), so a spike inside a column is not lost when zoomed far out.
  if (s.barSpacing !== undefined && s.barSpacing < 1) return collectDecimated(s, valueOf);
  const need = s.to - s.from + 2;
  if (need > ptX.length) {
    let cap = ptX.length;
    while (cap < need) cap *= 2;
    ptX = new Float64Array(cap);
    ptY = new Float64Array(cap);
  }
  let n = 0;
  let col = NaN;
  for (let i = s.from; i <= s.to; i++) {
    const r = s.rows[i];
    const yy = r ? s.y(valueOf(r)) : NaN;
    if (!Number.isFinite(yy)) {
      if (n > 0 && !Number.isNaN(ptY[n - 1])) { ptX[n] = 0; ptY[n] = NaN; n++; }
      col = NaN;
      continue;
    }
    const xx = s.x(i);
    const c = Math.floor(xx);
    if (c === col) { ptY[n - 1] = yy; continue; }
    col = c;
    ptX[n] = xx;
    ptY[n] = yy;
    n++;
  }
  return { n, xs: ptX, ys: ptY };
}

function collectDecimated<R extends RowBase>(
  s: Pick<SeriesDrawScope<R, unknown>, 'rows' | 'from' | 'to' | 'x' | 'y'>,
  valueOf: (r: R) => number,
): { n: number; xs: Float64Array; ys: Float64Array } {
  const ok = (i: number): boolean => { const r = s.rows[i]; return !!r && Number.isFinite(s.y(valueOf(r))); };
  const access = { high: valueOf, low: valueOf };
  let n = 0;
  const push = (x: number, y: number): void => {
    if (n + 1 >= ptX.length) {
      const nx = new Float64Array(ptX.length * 2); nx.set(ptX); ptX = nx;
      const ny = new Float64Array(ptY.length * 2); ny.set(ptY); ptY = ny;
    }
    ptX[n] = x; ptY[n] = y; n++;
  };
  let a = s.from;
  while (a <= s.to) {
    while (a <= s.to && !ok(a)) a++;
    if (a > s.to) break;
    let b = a;
    while (b + 1 <= s.to && ok(b + 1)) b++;
    if (n > 0) push(0, NaN);
    const cols = decimateColumns(s.rows, a, b, s.x, access);
    for (let k = 0; k < cols.count; k++) {
      const cx = cols.x[k] + 0.5;
      push(cx, s.y(cols.first[k]));
      if (cols.rows[k] > 1) {
        push(cx, s.y(cols.high[k]));
        push(cx, s.y(cols.low[k]));
        push(cx, s.y(cols.last[k]));
      }
    }
    a = b + 1;
  }
  return { n, xs: ptX, ys: ptY };
}

function drawArea(s: SeriesDrawScope<AreaData, AreaOptions>): void {
  const { ctx, options: o, colors, pane } = s;
  const { n, xs, ys } = collectPoints(s, r => r.value);
  if (n === 0) return;
  const line = o.lineColor ?? colors.line;
  const bottom = pane.y + pane.height;

  // Highest point on screen: the gradient starts there so its top colour is seen, not clipped away.
  let top = bottom;
  for (let k = 0; k < n; k++) if (ys[k] < top) top = ys[k];
  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, o.topColor ?? withAlpha(line, 0.28));
  grad.addColorStop(1, o.bottomColor ?? withAlpha(line, 0));

  // Fill: one polygon per run, closed along the pane bottom.
  ctx.beginPath();
  let start = -1;
  for (let k = 0; k <= n; k++) {
    const gap = k === n || Number.isNaN(ys[k]);
    if (gap) {
      if (start >= 0) {
        ctx.lineTo(xs[k - 1], bottom);
        ctx.lineTo(xs[start], bottom);
        ctx.closePath();
        start = -1;
      }
      continue;
    }
    if (start < 0) { start = k; ctx.moveTo(xs[k], ys[k]); } else ctx.lineTo(xs[k], ys[k]);
  }
  ctx.fillStyle = grad;
  ctx.fill();

  // Line on top.
  ctx.lineWidth = deviceWidth(o.lineWidth, s.pixelRatio);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = line;
  ctx.setLineDash([]);
  ctx.beginPath();
  let pen = false;
  for (let k = 0; k < n; k++) {
    if (Number.isNaN(ys[k])) { pen = false; continue; }
    if (!pen) { ctx.moveTo(xs[k], ys[k]); pen = true; } else ctx.lineTo(xs[k], ys[k]);
  }
  ctx.stroke();
}

export const AreaSeries: SeriesDefinition<AreaData, AreaOptions> = {
  type: 'area',
  defaults: { lineWidth: 2, crosshairMarkerVisible: true },
  normalize(input) {
    if (input.value === undefined) return null;
    const v = input.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`Chartist Lite: area row needs a finite "value" (time ${JSON.stringify(input.time)})`);
    }
    return { time: copyTime(input.time), value: v };
  },
  value: r => r.value,
  low: r => r.value,
  high: r => r.value,
  lastValueColor: (_r, o, c) => o.lineColor ?? c.line,
  draw: drawArea,
  crosshairMarker: (r, o, c) => (o.crosshairMarkerVisible ? { price: r.value, color: o.lineColor ?? c.line } : null),
};
