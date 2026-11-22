// Ease of movement.
//
//   easeOfMovement(rows, period = 14) -> IndicatorPoint[]
//
// SMA(period) of 10000 * (change of the midpoint (high + low) / 2) * (high - low) / volume. Bar 0 and any zero-volume bar
// have no raw value, and a window holding one has no value. First value on bar `period`. Needs candlestick rows with
// volume. Guide: 0.

import { hl, volCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { meanStrict, nanArray } from './series';

export function easeOfMovement(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const { h, l, bad } = hl(rows);
  const v = volCol(rows);
  const raw = nanArray(h.length);
  for (let i = 1; i < h.length; i++) {
    if (!(v[i] > 0)) continue;
    const dm = (h[i] + l[i]) / 2 - (h[i - 1] + l[i - 1]) / 2;
    raw[i] = (10000 * dm * (h[i] - l[i])) / v[i];
  }
  return points(rows, meanStrict(raw, clampPeriod(period, 14, rows.length + 1)), bad);
}
