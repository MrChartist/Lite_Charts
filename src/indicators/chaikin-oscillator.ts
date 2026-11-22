// Chaikin oscillator.
//
//   chaikinOscillator(rows, { fast = 3, slow = 10 }?) -> IndicatorPoint[]
//
// EMA(fast) - EMA(slow) of the accumulation / distribution line (each EMA seeded with the simple mean of its first values).
// First value on bar `max(fast, slow) - 1`. Needs candlestick rows with volume. Guide: 0.

import { hlc, volCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { emaCore } from './series';

export interface ChaikinOptions {
  fast?: number;
  slow?: number;
}

export function chaikinOscillator(rows: readonly IndicatorRow[], options: ChaikinOptions = {}): IndicatorPoint[] {
  const n = rows.length;
  const { h, l, c, bad } = hlc(rows);
  const v = volCol(rows);
  const adl = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const rng = h[i] - l[i];
    const mfm = rng > 0 ? ((c[i] - l[i]) - (h[i] - c[i])) / rng : 0;
    adl[i] = (i > 0 ? adl[i - 1] : 0) + mfm * v[i];
  }
  const f = emaCore(adl, clampPeriod(options.fast, 3, n + 1)), s = emaCore(adl, clampPeriod(options.slow, 10, n + 1));
  return points(rows, f.map((x, i) => x - s[i]), bad);
}
