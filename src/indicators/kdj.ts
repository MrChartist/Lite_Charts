// KDJ (a smoothed stochastic with a J line).
//
//   kdj(rows, { period = 14, kSmooth = 3, dSmooth = 3 }?) -> { k, d, j }
//
// raw = 100 * (close - lowest low) / (highest high - lowest low) over `period` bars (50 when flat); K = mean of `kSmooth` raw
// values; D = mean of `dSmooth` values of K; J = 3K - 2D. First K on bar `period + kSmooth - 2`, D and J `dSmooth - 1` later.
// Needs candlestick rows. Guides: 20 and 80.

import { hlc } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { slidingExtremeIndex } from './rolling';
import { nanArray, smaOf } from './series';

export interface KdjOptions {
  period?: number;
  kSmooth?: number;
  dSmooth?: number;
}

export interface KdjResult {
  k: IndicatorPoint[];
  d: IndicatorPoint[];
  j: IndicatorPoint[];
}

export function kdj(rows: readonly IndicatorRow[], options: KdjOptions = {}): KdjResult {
  const n = rows.length;
  const p = clampPeriod(options.period, 14, n + 1), ks = clampPeriod(options.kSmooth, 3, n + 1), ds = clampPeriod(options.dSmooth, 3, n + 1);
  const { h, l, c, bad } = hlc(rows);
  const hi = slidingExtremeIndex(h, p, 'max'), lo = slidingExtremeIndex(l, p, 'min');
  const raw = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (hi[i] < 0) continue;
    const hh = h[hi[i]], ll = l[lo[i]];
    raw[i] = hh === ll ? 50 : ((c[i] - ll) / (hh - ll)) * 100;
  }
  const k = smaOf(raw, ks), d = smaOf(k, ds);
  return { k: points(rows, k, bad), d: points(rows, d, bad), j: points(rows, k.map((v, i) => 3 * v - 2 * d[i]), bad) };
}
