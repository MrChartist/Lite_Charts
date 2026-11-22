// Commodity channel index.
//
//   cci(rows, period = 14) -> IndicatorPoint[]
//
// (TP - mean(TP)) / (0.015 * mean absolute deviation of TP) over `period` bars, TP = (high + low + close) / 3. First value
// on bar `period - 1`. A flat window is 0. Needs candlestick rows. Usual guides: -100 and 100.

import { hlc } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export function cci(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const p = clampPeriod(period, 14, rows.length + 1);
  const { h, l, c, bad } = hlc(rows);
  const tp = c.map((v, i) => (h[i] + l[i] + v) / 3);
  const out = nanArray(tp.length);
  for (let i = p - 1; i < tp.length; i++) {
    let sum = 0, lo = tp[i], hi = tp[i];
    for (let j = i - p + 1; j <= i; j++) { sum += tp[j]; if (tp[j] < lo) lo = tp[j]; if (tp[j] > hi) hi = tp[j]; }
    const mean = sum / p;
    let dev = 0;
    for (let j = i - p + 1; j <= i; j++) dev += Math.abs(tp[j] - mean);
    dev /= p;
    const flat = hi - lo <= 1e-12 * Math.max(1, Math.abs(hi), Math.abs(lo));
    out[i] = flat || dev === 0 ? 0 : (tp[i] - mean) / (0.015 * dev);
  }
  return points(rows, out, bad);
}
