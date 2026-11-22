// Choppiness index.
//
//   choppiness(rows, period = 14) -> IndicatorPoint[]
//
// 100 * log10(sum of true range over `period` bars / (highest high - lowest low)) / log10(period): high (toward 100) when
// price moves sideways, low (toward 0) when it trends; 50 when the range is zero. True range of bar 0 is its high - low.
// First value on bar `period - 1`. Needs candlestick rows. Guides: 38.2 and 61.8.

import { hlc } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { atrValues } from './atr';
import { slidingExtremeIndex } from './rolling';
import { nanArray } from './series';

export function choppiness(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const p = clampPeriod(period, 14, rows.length + 1);
  const { h, l, c, bad } = hlc(rows);
  const tr = atrValues(h, l, c, 1);
  const hi = slidingExtremeIndex(h, p, 'max'), lo = slidingExtremeIndex(l, p, 'min');
  const out = nanArray(c.length);
  for (let i = p - 1; i < c.length; i++) {
    let sum = 0;
    for (let j = i - p + 1; j <= i; j++) sum += Number.isNaN(tr[j]) ? h[j] - l[j] : tr[j];
    const range = h[hi[i]] - l[lo[i]];
    out[i] = range === 0 ? 50 : (100 * Math.log10(sum / range)) / Math.log10(p);
  }
  return points(rows, out, bad);
}
