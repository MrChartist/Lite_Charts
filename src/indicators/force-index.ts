// Force index.
//
//   forceIndex(rows, period = 13) -> IndicatorPoint[]
//
// EMA(period) of (close - previous close) * volume, seeded with the simple mean of the first `period` changes. First value
// on bar `period`. Needs rows with volume. Guide: 0.

import { closeCol, volCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { emaOf, nanArray } from './series';

export function forceIndex(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const { x, bad } = closeCol(rows);
  const v = volCol(rows);
  const raw = nanArray(x.length);
  for (let i = 1; i < x.length; i++) raw[i] = (x[i] - x[i - 1]) * v[i];
  return points(rows, emaOf(raw, clampPeriod(period, 13, rows.length + 1)), bad);
}
