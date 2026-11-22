// Money flow index.
//
//   mfi(rows, period = 14) -> IndicatorPoint[]
//
// A volume-weighted RSI: 100 * positive money flow / (positive + negative) over `period` bars, money flow = typical price
// (high + low + close) / 3 times volume, positive when the typical price rose. 50 when nothing moved. First value on bar
// `period`. Needs candlestick rows with volume. Guides: 20 and 80.

import { hlc, volCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export function mfi(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const p = clampPeriod(period, 14, rows.length + 1);
  const { h, l, c, bad } = hlc(rows);
  const v = volCol(rows);
  const tp = c.map((x, i) => (h[i] + l[i] + x) / 3);
  const out = nanArray(c.length);
  for (let i = p; i < c.length; i++) {
    let pos = 0, neg = 0;
    for (let j = i - p + 1; j <= i; j++) {
      const mf = tp[j] * v[j];
      if (tp[j] > tp[j - 1]) pos += mf;
      else if (tp[j] < tp[j - 1]) neg += mf;
    }
    const total = pos + neg;
    out[i] = total === 0 ? 50 : (pos / total) * 100;
  }
  return points(rows, out, bad);
}
