// Bollinger %B.
//
//   percentB(rows, { period = 20, mult = 2, source }?) -> IndicatorPoint[]
//
// (x - lower band) / (upper band - lower band): 1 at the upper band, 0 at the lower, outside 0 to 1 when price is outside
// the bands. First value on bar `period - 1`; no value where the bands have no width (flat price). A window holding a bad
// value has no value. Guides: 0 and 1.

import { rawPrice } from './cols';
import { finiteOr, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { len, nanArray, smaN, stdevN } from './series';

export interface PercentBOptions extends SourceOptions {
  period?: number;
  mult?: number;
}

export function percentB(rows: readonly IndicatorRow[], options: PercentBOptions = {}): IndicatorPoint[] {
  const src = rawPrice(rows, options.source);
  const p = len(options.period, 20), m = finiteOr(options.mult, 2);
  const basis = smaN(src, p), dev = stdevN(src, p);
  const out = nanArray(src.length);
  for (let i = 0; i < src.length; i++) {
    const width = 2 * m * dev[i];
    if (!(width > 1e-9 * Math.abs(basis[i]))) continue;
    const v = (src[i] - (basis[i] - m * dev[i])) / width;
    if (Number.isFinite(v)) out[i] = v;
  }
  return points(rows, out, null);
}
