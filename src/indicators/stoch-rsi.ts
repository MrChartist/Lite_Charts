// Stochastic RSI.
//
//   stochRsi(rows, { rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3, source }?) -> { k, d }
//
// The stochastic of the RSI: raw = 100 * (RSI - lowest RSI) / (highest RSI - lowest RSI) over `stochPeriod` bars (50 when
// flat), %K = mean of `kSmooth` raw values, %D = mean of `dSmooth` values of %K. First raw value on bar `rsiPeriod +
// stochPeriod - 1`, %K `kSmooth - 1` bars later, %D `dSmooth - 1` after that. Guides: 20 and 80.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { nanArray, rsiCore, smaOf } from './series';

export interface StochRsiOptions extends SourceOptions {
  rsiPeriod?: number;
  stochPeriod?: number;
  kSmooth?: number;
  dSmooth?: number;
}

export interface StochRsiResult {
  k: IndicatorPoint[];
  d: IndicatorPoint[];
}

export function stochRsi(rows: readonly IndicatorRow[], options: StochRsiOptions = {}): StochRsiResult {
  const n = rows.length;
  const rp = clampPeriod(options.rsiPeriod, 14, n + 1), sp = clampPeriod(options.stochPeriod, 14, n + 1);
  const ks = clampPeriod(options.kSmooth, 3, n + 1), ds = clampPeriod(options.dSmooth, 3, n + 1);
  const { x, bad } = closeCol(rows, options.source);
  const rsi = rsiCore(x, rp);
  const raw = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (i < rp + sp - 1 || Number.isNaN(rsi[i])) continue;
    let lo = Infinity, hi = -Infinity;
    for (let j = i - sp + 1; j <= i; j++) {
      const v = rsi[j];
      if (!Number.isNaN(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    raw[i] = hi !== lo ? ((rsi[i] - lo) / (hi - lo)) * 100 : 50;
  }
  const k = smaOf(raw, ks);
  return { k: points(rows, k, bad), d: points(rows, smaOf(k, ds), bad) };
}
