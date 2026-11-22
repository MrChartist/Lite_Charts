// Keltner channels.
//
//   keltner(rows, { period = 20, mult = 2, atrPeriod = 10 }?) -> { upper, middle, lower }
//
// middle = EMA(close, period) (seeded with the simple mean of the first `period` closes); upper and lower = middle +/-
// mult * ATR(atrPeriod) (Wilder). First value on bar `max(period, atrPeriod) - 1`. Needs candlestick rows.

import { hlc } from './cols';
import { finiteOr, period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { atrValues } from './atr';
import { emaCore } from './series';

export interface KeltnerOptions {
  period?: number;
  mult?: number;
  atrPeriod?: number;
}

export interface KeltnerResult {
  upper: IndicatorPoint[];
  middle: IndicatorPoint[];
  lower: IndicatorPoint[];
}

export function keltner(rows: readonly IndicatorRow[], options: KeltnerOptions = {}): KeltnerResult {
  const n = rows.length;
  const p = clampPeriod(options.period, 20, n + 1);
  const ap = clampPeriod(options.atrPeriod, 10, n + 1);
  const mult = finiteOr(options.mult, 2);
  const { h, l, c, bad } = hlc(rows);
  const mid = emaCore(c, p), a = atrValues(h, l, c, ap);
  return {
    upper: points(rows, mid.map((m, i) => m + mult * a[i]), bad),
    middle: points(rows, mid.map((m, i) => (Number.isNaN(a[i]) ? NaN : m)), bad),
    lower: points(rows, mid.map((m, i) => m - mult * a[i]), bad),
  };
}
