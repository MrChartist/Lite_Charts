// Awesome oscillator.
//
//   awesomeOscillator(rows, { fast = 5, slow = 34 }?) -> IndicatorPoint[]
//
// SMA(fast) - SMA(slow) of the bar midpoint (high + low) / 2. First value on bar `slow - 1`. Draw as a histogram. Guide: 0.
// Needs candlestick rows.

import { hl } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { smaCore } from './series';

export interface AwesomeOptions {
  fast?: number;
  slow?: number;
}

export function awesomeOscillator(rows: readonly IndicatorRow[], options: AwesomeOptions = {}): IndicatorPoint[] {
  const n = rows.length;
  const { h, l, bad } = hl(rows);
  const mp = h.map((v, i) => (v + l[i]) / 2);
  const f = smaCore(mp, clampPeriod(options.fast, 5, n + 1)), s = smaCore(mp, clampPeriod(options.slow, 34, n + 1));
  return points(rows, f.map((v, i) => v - s[i]), bad);
}
