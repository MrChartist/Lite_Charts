// Williams %R.
//
//   williamsR(rows, period = 14) -> IndicatorPoint[]
//
// -100 * (highest high - close) / (highest high - lowest low) over `period` bars: where the close sits in the recent range,
// from -100 (at the low) to 0 (at the high); -50 when the range is zero. First value on bar `period - 1`. Needs
// candlestick rows. Usual guides: -80 and -20.

import { hlc } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { slidingExtremeIndex } from './rolling';
import { nanArray } from './series';

export function williamsR(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const p = clampPeriod(period, 14, rows.length + 1);
  const { h, l, c, bad } = hlc(rows);
  const hi = slidingExtremeIndex(h, p, 'max'), lo = slidingExtremeIndex(l, p, 'min');
  const out = nanArray(c.length);
  for (let i = 0; i < c.length; i++) {
    if (hi[i] < 0) continue;
    const hh = h[hi[i]], ll = l[lo[i]];
    out[i] = hh === ll ? -50 : ((hh - c[i]) / (hh - ll)) * -100;
  }
  return points(rows, out, bad);
}
