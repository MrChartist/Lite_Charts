// Stochastic momentum index.
//
//   smi(rows, { kPeriod = 10, dPeriod = 3, emaPeriod = 3 }?) -> { smi, signal }
//
// rel = close - (highest high + lowest low) / 2 over `kPeriod` bars; range = highest high - lowest low.
// smi = 100 * EMA(EMA(rel, d), d) / (EMA(EMA(range, d), d) / 2); signal = EMA(smi, emaPeriod). About -100 to 100; no value
// where the smoothed range is 0. First smi on bar `kPeriod + 2 * dPeriod - 3`. A bad bar breaks the EMAs (they seed again).
// Needs candlestick rows. Guides: -40 and 40.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { emaN, highestN, len, lowestN } from './series';

export interface SmiOptions {
  kPeriod?: number;
  dPeriod?: number;
  emaPeriod?: number;
}

export interface SmiResult {
  smi: IndicatorPoint[];
  signal: IndicatorPoint[];
}

export function smi(rows: readonly IndicatorRow[], options: SmiOptions = {}): SmiResult {
  const h = rawCol(rows, r => r.high as number), l = rawCol(rows, r => r.low as number), c = rawCol(rows, r => r.close as number);
  const k = len(options.kPeriod, 10), d = len(options.dPeriod, 3);
  const hh = highestN(h, k), ll = lowestN(l, k);
  const rel = c.map((v, i) => v - (hh[i] + ll[i]) / 2);
  const diff = c.map((_, i) => hh[i] - ll[i]);
  const avgRel = emaN(emaN(rel, d), d), avgDiff = emaN(emaN(diff, d), d);
  const line = avgRel.map((v, i) => (avgDiff[i] !== 0 ? (100 * v) / (avgDiff[i] / 2) : NaN));
  return { smi: points(rows, line, null), signal: points(rows, emaN(line, len(options.emaPeriod, 3)), null) };
}
