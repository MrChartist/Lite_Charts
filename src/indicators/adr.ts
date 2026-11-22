// Average daily range.
//
//   adr(rows, period = 14) -> IndicatorPoint[]
//
// SMA(high - low, period) on the chart's own bars, in price. First value on bar `period - 1`. A window holding a bad bar has
// no value. Needs candlestick rows.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { len, smaN } from './series';

export function adr(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const h = rawCol(rows, r => r.high as number), l = rawCol(rows, r => r.low as number);
  return points(rows, smaN(h.map((v, i) => v - l[i]), len(period, 14)), null);
}
