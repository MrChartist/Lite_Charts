// Average daily range, percent.
//
//   adrPercent(rows, period = 14) -> IndicatorPoint[]
//
// 100 * (SMA(high / low, period) - 1): the average high-to-low range as a percent of price. First value on bar `period - 1`.
// A bar with a non-positive low has no ratio and blanks its window. Needs candlestick rows.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { len, smaN } from './series';

export function adrPercent(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const h = rawCol(rows, r => r.high as number), l = rawCol(rows, r => r.low as number);
  return points(rows, smaN(h.map((v, i) => (l[i] > 0 ? v / l[i] : NaN)), len(period, 14)).map(v => 100 * (v - 1)), null);
}
