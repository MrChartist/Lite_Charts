// Double exponential moving average.
//
//   dema(rows, period = 20, { source }?) -> IndicatorPoint[]
//
// 2 * EMA(x) - EMA(EMA(x)), both EMAs seeded with the simple mean of their first `period` values. First value on bar
// `2 * period - 2`.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { emaCore, emaOf } from './series';

export function dema(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  const p = clampPeriod(period, 20, rows.length + 1);
  const { x, bad } = closeCol(rows, options.source);
  const e1 = emaCore(x, p), e2 = emaOf(e1, p);
  return points(rows, e1.map((v, i) => 2 * v - e2[i]), bad);
}
