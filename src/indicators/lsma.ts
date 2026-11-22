// Least-squares moving average (linear regression line).
//
//   lsma(rows, period = 25, { offset = 0, source }?) -> IndicatorPoint[]
//
// The end of the straight line fitted (least squares) through the last `period` values, read `offset` bars back from the
// newest (a negative offset projects forward). First value on bar `period - 1`. A window holding a bad value has no
// value. A period of 1 returns the input.

import { rawPrice } from './cols';
import { finiteOr, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { len, nanArray } from './series';

export interface LsmaOptions extends SourceOptions {
  offset?: number;
}

export function lsma(rows: readonly IndicatorRow[], period?: number, options: LsmaOptions = {}): IndicatorPoint[] {
  const src = rawPrice(rows, options.source);
  const n = len(period, 25);
  const off = finiteOr(options.offset, 0);
  const out = nanArray(src.length);
  if (n <= src.length) {
    const mid = (n - 1) / 2;
    let sxx = 0;
    for (let j = 0; j < n; j++) sxx += (j - mid) ** 2;
    for (let i = n - 1; i < src.length; i++) {
      let sum = 0, sxy = 0;
      for (let j = 0; j < n; j++) {
        const y = src[i - n + 1 + j];
        sum += y;
        sxy += (j - mid) * y;
      }
      const slope = sxx === 0 ? 0 : sxy / sxx;
      const v = sum / n + slope * (n - 1 - off - mid);
      if (Number.isFinite(v)) out[i] = v;
    }
  }
  return points(rows, out, null);
}
