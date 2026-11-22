// High-low series: a floating column from each bar's low to its high (a range bar without open and close ticks).
// Coloured by direction: close vs open when the row has them, else the midpoint against the previous midpoint. One
// path per colour; under 3 device px per bar the rows fold into one-pixel columns (lowest low to highest high).

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { candleLayout } from '../render/pixel';
import { createColumns, decimateColumns } from '../render/decimate';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';

export interface HighLowData extends RowBase {
  time: Time;
  high: number;
  low: number;
  /** Optional, for the direction colour. */
  open?: number;
  close?: number;
}

export interface HighLowOptions {
  /** Defaults follow the theme's up and down colours. */
  upColor?: string;
  downColor?: string;
}

const ACCESS = {
  high: (r: HighLowData) => r.high,
  low: (r: HighLowData) => r.low,
  first: (r: HighLowData) => (r.high + r.low) / 2,
  last: (r: HighLowData) => (r.high + r.low) / 2,
};
const folded = createColumns();

function opt(row: Record<string, unknown>, key: string): number | undefined {
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function isUp(rows: readonly (HighLowData | null)[], i: number): boolean {
  const r = rows[i] as HighLowData;
  if (r.open !== undefined && r.close !== undefined) return r.close >= r.open;
  for (let j = i - 1, n = 0; j >= 0 && n < 8; j--, n++) {
    const p = rows[j];
    if (p) return r.high + r.low >= p.high + p.low;
  }
  return true;
}

function drawHighLow(s: SeriesDrawScope<HighLowData, HighLowOptions>): void {
  const { ctx, rows, from, to, x, y, options: o, colors } = s;
  const up = o.upColor ?? colors.up;
  const down = o.downColor ?? colors.down;
  const layout = candleLayout(s.barSpacing, s.pixelRatio);
  if (layout.mode === 'columns') {
    const cols = s.decimate ? s.decimate(ACCESS) : decimateColumns(rows, from, to, x, ACCESS, folded);
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
  const width = layout.body;
  for (let pass = 0; pass < 2; pass++) {
    const wantUp = pass === 0;
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r || isUp(rows, i) !== wantUp) continue;
      const top = Math.round(y(r.high));
      const bottom = Math.round(y(r.low));
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
      ctx.rect(Math.round(x(i) - width / 2), top, width, Math.max(1, bottom - top));
    }
    ctx.fillStyle = wantUp ? up : down;
    ctx.fill();
  }
}

export const HighLowSeries: SeriesDefinition<HighLowData, HighLowOptions> = {
  type: 'highLow',
  defaults: {},
  normalize(input) {
    if (input.high === undefined && input.low === undefined) return null;
    const a = input.high;
    const b = input.low;
    if (typeof a !== 'number' || !Number.isFinite(a)) throw new TypeError(`Chartist Lite: high-low row needs a finite "high" (time ${JSON.stringify(input.time)})`);
    if (typeof b !== 'number' || !Number.isFinite(b)) throw new TypeError(`Chartist Lite: high-low row needs a finite "low" (time ${JSON.stringify(input.time)})`);
    const row: HighLowData = { time: copyTime(input.time), high: Math.max(a, b), low: Math.min(a, b) };
    const open = opt(input, 'open');
    const close = opt(input, 'close');
    if (open !== undefined && close !== undefined) { row.open = open; row.close = close; }
    return row;
  },
  value: r => r.close ?? (r.high + r.low) / 2,
  low: r => r.low,
  high: r => r.high,
  lastValueColor: (r, o, c) => (r.open !== undefined && r.close !== undefined && r.close < r.open ? o.downColor ?? c.down : o.upColor ?? c.up),
  draw: drawHighLow,
};
