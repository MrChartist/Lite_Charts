// Donchian channel.
//
//   donchian(rows, period = 20) -> { upper, lower, middle }
//
// upper = highest high and lower = lowest low of the last `period` bars (this bar included), middle = their mean.
// First value on bar `period - 1`. Needs candlestick rows (high, low). Three `lineSeries` arrays.

import { anyBad, column, period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { slidingExtremeIndex } from './rolling';

export interface DonchianResult {
  upper: IndicatorPoint[];
  lower: IndicatorPoint[];
  middle: IndicatorPoint[];
}

export function donchian(rows: readonly IndicatorRow[], period?: number): DonchianResult {
  const p = clampPeriod(period, 20, rows.length + 1);
  const hi = column(rows, r => r.high as number);
  const lo = column(rows, r => r.low as number);
  const bad = anyBad([hi, lo], rows.length);
  const hiIdx = slidingExtremeIndex(hi.x, p, 'max');
  const loIdx = slidingExtremeIndex(lo.x, p, 'min');
  const n = rows.length;
  const upper = new Array<number>(n).fill(NaN), lower = new Array<number>(n).fill(NaN), middle = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (hiIdx[i] < 0) continue;
    const h = hi.x[hiIdx[i]], l = lo.x[loIdx[i]];
    upper[i] = h; lower[i] = l; middle[i] = (h + l) / 2;
  }
  return { upper: points(rows, upper, bad), lower: points(rows, lower, bad), middle: points(rows, middle, bad) };
}
