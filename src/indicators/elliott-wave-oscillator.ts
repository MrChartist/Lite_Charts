// Elliott wave oscillator.
//
//   elliottWaveOscillator(rows, { fast = 5, slow = 34, source }?) -> IndicatorPoint[]
//
// EMA(fast) - EMA(slow) of the input (the EMA variant, each seeded with the simple mean of its first values). First value on
// bar `max(fast, slow) - 1`. Draw as a histogram. Guide: 0.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { emaCore } from './series';

export interface EwoOptions extends SourceOptions {
  fast?: number;
  slow?: number;
}

export function elliottWaveOscillator(rows: readonly IndicatorRow[], options: EwoOptions = {}): IndicatorPoint[] {
  const n = rows.length;
  const { x, bad } = closeCol(rows, options.source);
  const f = emaCore(x, clampPeriod(options.fast, 5, n + 1)), s = emaCore(x, clampPeriod(options.slow, 34, n + 1));
  return points(rows, f.map((v, i) => v - s[i]), bad);
}
