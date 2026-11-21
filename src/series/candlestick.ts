// Candlestick series: flat bodies and wicks on whole device pixels. When bars are closer than 3 device px they are
// folded into one-pixel columns (lowest low to highest high per column), so a zoomed-out 100k-bar chart costs one
// rectangle per pixel column, not one per bar.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { candleLayout } from '../render/pixel';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';

export interface CandlestickData extends RowBase {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandlestickOptions {
  /** Defaults follow the theme's up and down colours. */
  upColor?: string;
  downColor?: string;
  wickVisible: boolean;
  wickUpColor?: string;
  wickDownColor?: string;
}

// Scratch columns for the zoomed-out path, grown on demand and reused every frame (no per-frame allocation).
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
    throw new TypeError(`Chartist Lite: candlestick row needs a finite "${key}" (time ${JSON.stringify(row.time)})`);
  }
  return v;
}

function drawCandles(s: SeriesDrawScope<CandlestickData, CandlestickOptions>): void {
  const { ctx, rows, from, to, x, y, options: o, colors } = s;
  const up = o.upColor ?? colors.up;
  const down = o.downColor ?? colors.down;
  const layout = candleLayout(s.barSpacing, s.pixelRatio);

  if (layout.mode === 'columns') {
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

  const { body, wick } = layout;
  // Wicks first (under the bodies), then bodies; one path per colour.
  for (let pass = 0; pass < 4; pass++) {
    const isWick = pass < 2;
    if (isWick && !o.wickVisible) continue;
    const wantUp = pass % 2 === 0;
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r || (r.close >= r.open) !== wantUp) continue;
      const left = Math.round(x(i) - body / 2);
      if (isWick) {
        const top = Math.round(y(r.high));
        const bottom = Math.round(y(r.low));
        if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
        ctx.rect(left + (body - wick) / 2, top, wick, Math.max(1, bottom - top));
      } else {
        const yo = y(r.open);
        const yc = y(r.close);
        if (!Number.isFinite(yo) || !Number.isFinite(yc)) continue;
        const top = Math.round(Math.min(yo, yc));
        ctx.rect(left, top, body, Math.max(1, Math.round(Math.max(yo, yc)) - top));
      }
    }
    ctx.fillStyle = isWick
      ? (wantUp ? o.wickUpColor ?? up : o.wickDownColor ?? down)
      : (wantUp ? up : down);
    ctx.fill();
  }
}

export const CandlestickSeries: SeriesDefinition<CandlestickData, CandlestickOptions> = {
  type: 'candlestick',
  defaults: { wickVisible: true },
  normalize(input) {
    if (input.open === undefined && input.high === undefined && input.low === undefined && input.close === undefined) return null;
    const open = num(input, 'open');
    const high = num(input, 'high');
    const low = num(input, 'low');
    const close = num(input, 'close');
    // A range that does not contain its own open and close is repaired, not rejected.
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
  draw: drawCandles,
};
