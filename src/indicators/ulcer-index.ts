// Ulcer index.
//
//   ulcerIndex(rows, period = 14, { source }?) -> IndicatorPoint[]
//
// sqrt(mean of squared drawdowns over `period` bars), a drawdown being the percent distance of the input below the highest
// input of the last `period` bars. First value on bar `2 * period - 2`. Low means shallow, short dips.

import { rawPrice } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { highestN, len, nanArray, smaN } from './series';

export function ulcerIndex(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  const src = rawPrice(rows, options.source);
  const p = len(period, 14);
  const peak = highestN(src, p);
  const dd2 = nanArray(src.length);
  for (let i = 0; i < src.length; i++) {
    if (!(peak[i] > 0)) continue;
    const d = (100 * (src[i] - peak[i])) / peak[i];
    if (Number.isFinite(d)) dd2[i] = d * d;
  }
  return points(rows, smaN(dd2, p).map(Math.sqrt), null);
}
