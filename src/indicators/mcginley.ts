// McGinley dynamic.
//
//   mcginley(rows, { period = 14, k = 0.6, source }?) -> IndicatorPoint[]
//
// md = md[1] + (x - md[1]) / max(1, k * period * (x / md[1])^4), seeded with the simple mean of the first `period` values
// (first value on bar `period - 1`). A self-adjusting average that hugs price; the divisor is held at 1 or more so a gap
// never throws the line past the price. A bad input starts it again.

import { rawPrice } from './cols';
import { finiteOr, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { len, recursiveN } from './series';

export interface McGinleyOptions extends SourceOptions {
  period?: number;
  k?: number;
}

export function mcginley(rows: readonly IndicatorRow[], options: McGinleyOptions = {}): IndicatorPoint[] {
  const n = len(options.period, 14);
  const factor = finiteOr(options.k, 0.6) > 0 ? finiteOr(options.k, 0.6) : 0.6;
  const out = recursiveN(rawPrice(rows, options.source), n, (prev, v) => {
    const divisor = factor * n * Math.pow(v / prev, 4);
    if (!Number.isFinite(divisor)) return v;
    return prev + (v - prev) / Math.max(1, divisor);
  });
  return points(rows, out, null);
}
