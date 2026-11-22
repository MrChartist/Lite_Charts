// Fisher transform.
//
//   fisher(rows, period = 9) -> { fisher, trigger }
//
// On the midpoint hl2: x = clamp(0.66 * ((hl2 - lowest) / max(highest - lowest, 0.001) - 0.5) + 0.67 * x[1]) (|x| above 0.99
// becomes +/-0.999), fisher = 0.5 * ln((1 + x) / (1 - x)) + 0.5 * fisher[1]; trigger = fisher one bar earlier. First fisher on
// bar `period - 1` (the trigger starts a bar later). Needs candlestick rows. Guide: 0.

import { hl } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { slidingExtremeIndex } from './rolling';
import { nanArray } from './series';

export interface FisherResult {
  fisher: IndicatorPoint[];
  trigger: IndicatorPoint[];
}

export function fisher(rows: readonly IndicatorRow[], period?: number): FisherResult {
  const n = rows.length;
  const p = clampPeriod(period, 9, n + 1);
  const { h, l, bad } = hl(rows);
  const hl2 = h.map((v, i) => (v + l[i]) / 2);
  const hi = slidingExtremeIndex(hl2, p, 'max'), lo = slidingExtremeIndex(hl2, p, 'min');
  const f = nanArray(n), t = nanArray(n);
  let x = 0, fish = 0;
  for (let i = p - 1; i < n; i++) {
    const top = hl2[hi[i]], bottom = hl2[lo[i]];
    x = 0.66 * ((hl2[i] - bottom) / Math.max(top - bottom, 0.001) - 0.5) + 0.67 * x;
    x = x > 0.99 ? 0.999 : x < -0.99 ? -0.999 : x;
    const prev = i === p - 1 ? NaN : fish;
    fish = 0.5 * Math.log((1 + x) / (1 - x)) + 0.5 * fish;
    f[i] = fish; t[i] = prev;
  }
  return { fisher: points(rows, f, bad), trigger: points(rows, t, bad) };
}
