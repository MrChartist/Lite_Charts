// Triple exponential moving average.
//
//   tema(rows, period = 20, { source }?) -> IndicatorPoint[]
//
// 3 * EMA - 3 * EMA(EMA) + EMA(EMA(EMA)), each EMA seeded with the simple mean of its first `period` values. First
// value on bar `3 * period - 3`.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { emaCore, emaOf } from './series';

export function tema(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  const p = clampPeriod(period, 20, rows.length + 1);
  const { x, bad } = closeCol(rows, options.source);
  const e1 = emaCore(x, p), e2 = emaOf(e1, p), e3 = emaOf(e2, p);
  return points(rows, e1.map((v, i) => 3 * v - 3 * e2[i] + e3[i]), bad);
}
