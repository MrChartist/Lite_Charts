// Aroon.
//
//   aroon(rows, period = 25) -> { up, down }
//
// up = 100 * (period - bars since the highest high) / period, down likewise for the lowest low, over the last `period + 1`
// bars (a tie takes the most recent bar). First value on bar `period`. 0 to 100. Needs candlestick rows. Guides: 30 and 70.

import { hl } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { slidingExtremeIndex } from './rolling';
import { nanArray } from './series';

export interface AroonResult {
  up: IndicatorPoint[];
  down: IndicatorPoint[];
}

export function aroon(rows: readonly IndicatorRow[], period?: number): AroonResult {
  const p = clampPeriod(period, 25, rows.length + 1);
  const { h, l, bad } = hl(rows);
  const hi = slidingExtremeIndex(h, p + 1, 'max'), lo = slidingExtremeIndex(l, p + 1, 'min');
  const up = nanArray(h.length), down = nanArray(h.length);
  for (let i = 0; i < h.length; i++) {
    if (hi[i] < 0) continue;
    up[i] = ((p - (i - hi[i])) / p) * 100;
    down[i] = ((p - (i - lo[i])) / p) * 100;
  }
  return { up: points(rows, up, bad), down: points(rows, down, bad) };
}
