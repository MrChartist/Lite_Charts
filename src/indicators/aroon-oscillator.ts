// Aroon oscillator.
//
//   aroonOscillator(rows, period = 14) -> IndicatorPoint[]
//
// Aroon up - Aroon down, from -100 to 100, over the last `period + 1` bars (a tie takes the most recent bar). First value
// on bar `period`. A window holding a bad high or low has no value. Needs candlestick rows. Guide: 0.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { len, nanArray } from './series';

export function aroonOscillator(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const p = len(period, 14);
  const h = rawCol(rows, r => r.high as number), l = rawCol(rows, r => r.low as number);
  const out = nanArray(h.length);
  for (let i = p; i < h.length; i++) {
    let hi = i, lo = i, ok = true;
    for (let j = i - p; j <= i; j++) {
      if (!Number.isFinite(h[j]) || !Number.isFinite(l[j])) { ok = false; break; }
      if (h[j] >= h[hi]) hi = j;
      if (l[j] <= l[lo]) lo = j;
    }
    if (ok) out[i] = (100 * ((i - lo) - (i - hi))) / p;
  }
  return points(rows, out, null);
}
