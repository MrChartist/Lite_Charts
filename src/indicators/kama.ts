// Kaufman adaptive moving average.
//
//   kama(rows, { er = 10, fast = 2, slow = 30, source }?) -> IndicatorPoint[]
//
// Efficiency ratio ER = |x - x[er]| / sum of the last `er` absolute bar changes; smoothing sc =
// (ER * (2 / (fast + 1) - 2 / (slow + 1)) + 2 / (slow + 1))^2; kama = kama[1] + sc * (x - kama[1]). Fast in a clean trend,
// flat in chop. First value on bar `er`, seeded with the previous bar's input.

import { rawPrice } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { len, nanArray } from './series';

export interface KamaOptions extends SourceOptions {
  er?: number;
  fast?: number;
  slow?: number;
}

export function kama(rows: readonly IndicatorRow[], options: KamaOptions = {}): IndicatorPoint[] {
  const src = rawPrice(rows, options.source);
  const n = len(options.er, 10);
  const fastAlpha = 2 / (len(options.fast, 2) + 1);
  const slowAlpha = 2 / (len(options.slow, 30) + 1);
  const out = nanArray(src.length);
  let prev = NaN;
  for (let i = n; i < src.length; i++) {
    let path = 0;
    for (let j = i - n + 1; j <= i; j++) path += Math.abs(src[j] - src[j - 1]);
    if (!Number.isFinite(path)) { prev = NaN; continue; }
    const ratio = path === 0 ? 0 : Math.abs(src[i] - src[i - n]) / path;
    const sc = (ratio * (fastAlpha - slowAlpha) + slowAlpha) ** 2;
    if (Number.isNaN(prev)) prev = src[i - 1];
    prev = prev + sc * (src[i] - prev);
    out[i] = prev;
  }
  return points(rows, out, null);
}
