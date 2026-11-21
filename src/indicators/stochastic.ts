// Stochastic oscillator.
//
//   stochastic(rows, { kPeriod = 14, dPeriod = 3 }?) -> { k, d }
//
// %K = 100 * (close - lowest low) / (highest high - lowest low) over `kPeriod` bars (50 when the range is zero),
// first value on bar `kPeriod - 1`; %D = simple mean of the last `dPeriod` values of %K. Needs candlestick rows
// (high, low, close). Two `lineSeries` arrays on a 0 to 100 scale.

import { anyBad, column, period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { slidingExtremeIndex } from './rolling';

export interface StochasticOptions {
  kPeriod?: number;
  dPeriod?: number;
}

export interface StochasticResult {
  k: IndicatorPoint[];
  d: IndicatorPoint[];
}

export function stochastic(rows: readonly IndicatorRow[], options: StochasticOptions = {}): StochasticResult {
  const len = rows.length;
  const kp = clampPeriod(options.kPeriod, 14, len + 1);
  const dp = clampPeriod(options.dPeriod, 3, len + 1);
  const h = column(rows, r => r.high as number);
  const l = column(rows, r => r.low as number);
  const c = column(rows, r => r.close as number);
  const bad = anyBad([h, l, c], len);
  const hiIdx = slidingExtremeIndex(h.x, kp, 'max');
  const loIdx = slidingExtremeIndex(l.x, kp, 'min');
  const k = new Array<number>(len).fill(NaN);
  const d = new Array<number>(len).fill(NaN);
  for (let i = kp - 1; i < len; i++) {
    const hh = h.x[hiIdx[i]], ll = l.x[loIdx[i]];
    k[i] = hh === ll ? 50 : ((c.x[i] - ll) / (hh - ll)) * 100;
    if (i >= kp - 1 + dp - 1) {
      let sum = 0;
      for (let j = i - dp + 1; j <= i; j++) sum += k[j];
      d[i] = sum / dp;
    }
  }
  return { k: points(rows, k, bad), d: points(rows, d, bad) };
}
