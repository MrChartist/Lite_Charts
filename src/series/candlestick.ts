// Candlestick series: flat bodies and wicks on whole device pixels. When bars are closer than 3 device px they are
// folded into one-pixel columns (lowest low to highest high per column), so a zoomed-out 100k-bar chart costs one
// rectangle per pixel column, not one per bar.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { candleLayout } from '../render/pixel';
import { decimateColumns } from '../render/decimate';
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

const ACCESS = {
  high: (r: CandlestickData) => r.high,
  low: (r: CandlestickData) => r.low,
  first: (r: CandlestickData) => r.open,
  last: (r: CandlestickData) => r.close,
};

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
    // Compressed form: one column per device pixel, lowest low to highest high, coloured by first open vs last close.
    const cols = s.decimate ? s.decimate(ACCESS) : decimateColumns(rows, from, to, x, ACCESS);
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let k = 0; k < cols.count; k++) {
        if ((cols.last[k] >= cols.first[k]) !== (pass === 0)) continue;
        const top = Math.round(y(cols.high[k]));
        const bottom = Math.round(y(cols.low[k]));
        if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
        ctx.rect(cols.x[k], top, 1, Math.max(1, bottom - top));
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
