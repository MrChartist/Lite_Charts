// Linearly weighted moving average (the newest bar weighs `period`, the oldest 1).
//
//   wma(rows, period = 20, { source }?) -> IndicatorPoint[]
//
// First value on bar `period - 1`. O(n * period); no incremental form.

import { column, period as clampPeriod, pick, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';

export function wma(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  const p = clampPeriod(period, 20, rows.length + 1);
  const { x, bad } = column(rows, r => pick(r, options.source));
  const out = new Array<number>(x.length).fill(NaN);
  const denom = (p * (p + 1)) / 2;
  for (let i = p - 1; i < x.length; i++) {
    let sum = 0;
    for (let j = 0; j < p; j++) sum += x[i - p + 1 + j] * (j + 1);
    out[i] = sum / denom;
  }
  return points(rows, out, bad);
}
