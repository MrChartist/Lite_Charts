// Rate of change.
//
//   roc(rows, period = 14, { source }?) -> IndicatorPoint[]
//
// 100 * (x - x[period]) / x[period]. First value on bar `period`; no value where x[period] is 0.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { nanArray } from './series';

/** Percent change over `p` bars of a finite series (NaN before bar `p` and where the earlier value is 0). */
export function rocValues(x: ArrayLike<number>, p: number): number[] {
  const out = nanArray(x.length);
  for (let i = p; i < x.length; i++) {
    const prev = x[i - p];
    if (prev !== 0) out[i] = ((x[i] - prev) / prev) * 100;
  }
  return out;
}

export function roc(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  const { x, bad } = closeCol(rows, options.source);
  return points(rows, rocValues(x, clampPeriod(period, 14, rows.length + 1)), bad);
}
