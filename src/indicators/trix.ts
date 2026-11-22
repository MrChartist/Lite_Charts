// TRIX.
//
//   trix(rows, period = 18, { source }?) -> IndicatorPoint[]
//
// 10000 * the one-bar change of EMA(EMA(EMA(ln x))): about 100 times the percent change of a triple-smoothed average. Each
// EMA is seeded with the simple mean of its first `period` values. First value on bar `3 * period - 2`. A non-positive
// input has no logarithm and gives no value on its bar. Guide: 0.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { carry, emaCore, emaOf, nanArray } from './series';

export function trix(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  const p = clampPeriod(period, 18, rows.length + 1);
  const { x, bad } = closeCol(rows, options.source);
  const logs = carry(x.map(c => (c > 0 ? Math.log(c) : NaN)));
  const e3 = emaOf(emaOf(emaCore(logs, p), p), p);
  const out = nanArray(x.length);
  for (let i = 1; i < x.length; i++) if (!Number.isNaN(e3[i]) && !Number.isNaN(e3[i - 1]) && x[i] > 0) out[i] = 10000 * (e3[i] - e3[i - 1]);
  return points(rows, out, bad);
}
