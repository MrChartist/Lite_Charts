// HLC area: a translucent band from each bar's low to its high with the close drawn as a line through it. Three paths
// per frame (band fill, band edges, close line) whatever the zoom. Under one device pixel per bar the rows fold to one
// entry per pixel column (highest high, lowest low, last close) through the shared decimation.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { deviceWidth, hairline } from '../render/pixel';
import { createColumns, decimateColumns } from '../render/decimate';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';
import { withAlpha } from './area';

export interface HlcAreaData extends RowBase {
  time: Time;
  high: number;
  low: number;
  close: number;
}

export interface HlcAreaOptions {
  /** Colour of the close line and the band. Defaults to the theme's line colour. */
  lineColor?: string;
  /** CSS px, the close line. */
  lineWidth: number;
  /** Band fill. Defaults to the line colour at 16% opacity. */
  bandColor?: string;
  crosshairMarkerVisible: boolean;
}

const ACCESS = {
  high: (r: HlcAreaData) => r.high,
  low: (r: HlcAreaData) => r.low,
  first: (r: HlcAreaData) => r.close,
  last: (r: HlcAreaData) => r.close,
};
const folded = createColumns();

// Scratch: per point x, high y, low y, close y (NaN high = gap), reused every frame.
let px = new Float64Array(512);
let ph = new Float64Array(512);
let pl = new Float64Array(512);
let pc = new Float64Array(512);

function grow(n: number): void {
  if (n <= px.length) return;
  let cap = px.length;
  while (cap < n) cap *= 2;
  const copy = (a: Float64Array<ArrayBuffer>): Float64Array<ArrayBuffer> => { const b = new Float64Array(cap); b.set(a); return b; };
  px = copy(px); ph = copy(ph); pl = copy(pl); pc = copy(pc);
}

/** Visible rows as device points (one per bar, or per pixel column when dense), a NaN `ph` marking a gap. */
function collect(s: SeriesDrawScope<HlcAreaData, HlcAreaOptions>): number {
  const { rows, from, to, x, y } = s;
  grow(to - from + 3);
  let n = 0;
  if (s.barSpacing < 1) {
    // Dense: scan runs without a gap through the shared fold.
    let a = from;
    const ok = (i: number): boolean => { const r = rows[i]; return !!r && Number.isFinite(y(r.high)) && Number.isFinite(y(r.low)); };
    while (a <= to) {
      while (a <= to && !ok(a)) a++;
      if (a > to) break;
      let b = a;
      while (b + 1 <= to && ok(b + 1)) b++;
      if (n > 0) { grow(n + 2); ph[n] = NaN; n++; }
      const cols = decimateColumns(rows, a, b, x, ACCESS, folded);
      grow(n + cols.count + 2);
      for (let k = 0; k < cols.count; k++) {
        px[n] = cols.x[k] + 0.5; ph[n] = y(cols.high[k]); pl[n] = y(cols.low[k]); pc[n] = y(cols.last[k]); n++;
      }
      a = b + 1;
    }
    return n;
  }
  for (let i = from; i <= to; i++) {
    const r = rows[i];
    const yh = r ? y(r.high) : NaN;
    const yl = r ? y(r.low) : NaN;
    if (!Number.isFinite(yh) || !Number.isFinite(yl)) {
      if (n > 0 && ph[n - 1] === ph[n - 1]) { ph[n] = NaN; n++; }
      continue;
    }
    px[n] = x(i); ph[n] = yh; pl[n] = yl; pc[n] = y((r as HlcAreaData).close); n++;
  }
  return n;
}

function drawHlcArea(s: SeriesDrawScope<HlcAreaData, HlcAreaOptions>): void {
  const { ctx, options: o, colors } = s;
  const n = collect(s);
  if (n === 0) return;
  const line = o.lineColor ?? colors.line;

  // Band: one polygon per run, along the highs and back along the lows.
  ctx.beginPath();
  let start = -1;
  for (let k = 0; k <= n; k++) {
    if (k === n || ph[k] !== ph[k]) {
      if (start >= 0) {
        for (let j = k - 1; j >= start; j--) ctx.lineTo(px[j], pl[j]);
        ctx.closePath();
        start = -1;
      }
      continue;
    }
    if (start < 0) { start = k; ctx.moveTo(px[k], ph[k]); } else ctx.lineTo(px[k], ph[k]);
  }
  ctx.fillStyle = o.bandColor ?? withAlpha(line, 0.16);
  ctx.fill();

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  // Band edges: faint hairlines on the high and the low.
  ctx.lineWidth = hairline(s.pixelRatio);
  ctx.strokeStyle = withAlpha(line, 0.38);
  ctx.beginPath();
  for (let pass = 0; pass < 2; pass++) {
    const ys = pass === 0 ? ph : pl;
    let pen = false;
    for (let k = 0; k < n; k++) {
      if (ph[k] !== ph[k]) { pen = false; continue; }
      if (!pen) { ctx.moveTo(px[k], ys[k]); pen = true; } else ctx.lineTo(px[k], ys[k]);
    }
  }
  ctx.stroke();

  // Close line.
  ctx.lineWidth = deviceWidth(o.lineWidth, s.pixelRatio);
  ctx.strokeStyle = line;
  ctx.beginPath();
  let pen = false;
  for (let k = 0; k < n; k++) {
    if (ph[k] !== ph[k]) { pen = false; continue; }
    if (!pen) { ctx.moveTo(px[k], pc[k]); pen = true; } else ctx.lineTo(px[k], pc[k]);
  }
  ctx.stroke();
}

function num(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`Chartist Lite: HLC area row needs a finite "${key}" (time ${JSON.stringify(row.time)})`);
  }
  return v;
}

export const HlcAreaSeries: SeriesDefinition<HlcAreaData, HlcAreaOptions> = {
  type: 'hlcArea',
  defaults: { lineWidth: 2, crosshairMarkerVisible: true },
  normalize(input) {
    if (input.high === undefined && input.low === undefined && input.close === undefined) return null;
    const high = num(input, 'high');
    const low = num(input, 'low');
    const close = num(input, 'close');
    // A range that does not contain the close is repaired, not rejected.
    return { time: copyTime(input.time), high: Math.max(high, low, close), low: Math.min(high, low, close), close };
  },
  value: r => r.close,
  low: r => r.low,
  high: r => r.high,
  lastValueColor: (_r, o, c) => o.lineColor ?? c.line,
  draw: drawHlcArea,
  crosshairMarker: (r, o, c) => (o.crosshairMarkerVisible ? { price: r.close, color: o.lineColor ?? c.line } : null),
};
