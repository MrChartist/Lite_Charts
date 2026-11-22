// Price volume trend.
//
//   priceVolumeTrend(rows) -> IndicatorPoint[]
//
// A running sum of (close - previous close) / previous close * volume. First value on bar 1. A bar with a bad close or
// volume has no value (and adds nothing). Needs candlestick rows with volume.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export function priceVolumeTrend(rows: readonly IndicatorRow[]): IndicatorPoint[] {
  const c = rawCol(rows, r => r.close as number), v = rawCol(rows, r => r.volume as number);
  const out = nanArray(c.length);
  let acc = 0;
  for (let i = 1; i < c.length; i++) {
    const step = ((c[i] - c[i - 1]) / c[i - 1]) * v[i];
    if (Number.isFinite(step)) { acc += step; out[i] = acc; }
  }
  return points(rows, out, null);
}
