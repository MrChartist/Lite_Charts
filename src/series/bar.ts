// OHLC bar series: a vertical high-low stem, an open tick on the left and a close tick on the right, all drawn as
// whole-device-pixel rectangles, one path per colour. Under 3 device px per bar the bars fold into one-pixel
// columns (as candlesticks do); in "thin" mode (narrow bars) the stem is one device pixel wide.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { COLUMN_MODE_BELOW, deviceWidth } from '../render/pixel';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';

export interface BarData extends RowBase {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface BarOptions {
  /** Defaults follow the theme's up and down colours. */
  upColor?: string;
  downColor?: string;
  /** Draw the open tick. Default true. */
  openVisible: boolean;
  /** Use a one-device-pixel stem when bars are narrow (under 8 CSS px apart). Default true. */
  thinBars: boolean;
}

/** Bars closer than this many CSS px count as narrow for `thinBars`. */
export const THIN_BELOW_CSS = 8;

export interface BarGeometry {
  /** Stem width, whole device px. */
  stem: number;
  /** Length of each tick, beyond the stem, whole device px. */
  tick: number;
}

/** Stem width and tick length for a spacing in device px (pure, tested). */
export function barGeometry(spacingDev: number, ratio: number, thin: boolean): BarGeometry {
  const narrow = thin && spacingDev < THIN_BELOW_CSS * ratio;
  const stem = narrow ? 1 : deviceWidth(1.5, ratio);
  const half = Math.floor(spacingDev * 0.42);
  return { stem, tick: Math.max(1, half - Math.ceil(stem / 2)) };
}

let colX = new Float64Array(256);
let colHi = new Float64Array(256);
let colLo = new Float64Array(256);
let colUp = new Uint8Array(256);

function growColumns(n: number): void {
  if (n <= colX.length) return;
  let cap = colX.length;
  while (cap < n) cap *= 2;
  colX = new Float64Array(cap);
  colHi = new Float64Array(cap);
  colLo = new Float64Array(cap);
  colUp = new Uint8Array(cap);
}

function num(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`Chartist Lite: bar row needs a finite "${key}" (time ${JSON.stringify(row.time)})`);
  }
  return v;
}

function drawBars(s: SeriesDrawScope<BarData, BarOptions>): void {
  const { ctx, rows, from, to, x, y, options: o, colors } = s;
  const up = o.upColor ?? colors.up;
  const down = o.downColor ?? colors.down;

  if (s.barSpacing < COLUMN_MODE_BELOW) {
    growColumns(to - from + 2);
    let n = 0;
    let cur = NaN;
    let open = 0;
    let close = 0;
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r) continue;
      const col = Math.floor(x(i));
      if (col !== cur) {
        if (n > 0) colUp[n - 1] = close >= open ? 1 : 0;
        cur = col;
        colX[n] = col;
        colHi[n] = r.high;
        colLo[n] = r.low;
        open = r.open;
        n++;
      } else {
        if (r.high > colHi[n - 1]) colHi[n - 1] = r.high;
        if (r.low < colLo[n - 1]) colLo[n - 1] = r.low;
      }
      close = r.close;
    }
    if (n > 0) colUp[n - 1] = close >= open ? 1 : 0;
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        if (colUp[k] !== (pass === 0 ? 1 : 0)) continue;
        const top = Math.round(y(colHi[k]));
        const bottom = Math.round(y(colLo[k]));
        if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
        ctx.rect(colX[k], top, 1, Math.max(1, bottom - top));
      }
      ctx.fillStyle = pass === 0 ? up : down;
      ctx.fill();
    }
    return;
  }

  const { stem, tick } = barGeometry(s.barSpacing, s.pixelRatio, o.thinBars);
  for (let pass = 0; pass < 2; pass++) {
    const wantUp = pass === 0;
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r || (r.close >= r.open) !== wantUp) continue;
      const hi = Math.round(y(r.high));
      const lo = Math.round(y(r.low));
      if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;
      const left = Math.round(x(i) - stem / 2);
      ctx.rect(left, hi, stem, Math.max(1, lo - hi));
      if (o.openVisible) {
        const yo = Math.round(y(r.open) - stem / 2);
        if (Number.isFinite(yo)) ctx.rect(left - tick, yo, tick, stem);
      }
      const yc = Math.round(y(r.close) - stem / 2);
      if (Number.isFinite(yc)) ctx.rect(left + stem, yc, tick, stem);
    }
    ctx.fillStyle = wantUp ? up : down;
    ctx.fill();
  }
}

export const BarSeries: SeriesDefinition<BarData, BarOptions> = {
  type: 'bar',
  defaults: { openVisible: true, thinBars: true },
  normalize(input) {
    if (input.open === undefined && input.high === undefined && input.low === undefined && input.close === undefined) return null;
    const open = num(input, 'open');
    const high = num(input, 'high');
    const low = num(input, 'low');
    const close = num(input, 'close');
    return {
      time: copyTime(input.time),
      open,
      high: Math.max(open, high, low, close),
      low: Math.min(open, high, low, close),
      close,
    };
  },
  value: r => r.close,
  low: r => r.low,
  high: r => r.high,
  lastValueColor: (r, o, c) => (r.close >= r.open ? o.upColor ?? c.up : o.downColor ?? c.down),
  draw: drawBars,
};
