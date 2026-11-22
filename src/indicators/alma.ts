// Arnaud Legoux moving average.
//
//   alma(rows, { window = 9, offset = 0.85, sigma = 6, source }?) -> IndicatorPoint[]
//
// A Gaussian-weighted window: weight(i) = exp(-(i - m)^2 / (2 s^2)) with m = floor(offset * (window - 1)) and
// s = window / sigma (i = 0 is the oldest bar). Smooth, and weighted toward recent bars when offset is near 1. First value
// on bar `window - 1`. A window holding a bad value has no value.

import { rawPrice } from './cols';
import { finiteOr, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { len, nanArray } from './series';

export interface AlmaOptions extends SourceOptions {
  window?: number;
  offset?: number;
  sigma?: number;
}

export function alma(rows: readonly IndicatorRow[], options: AlmaOptions = {}): IndicatorPoint[] {
  const src = rawPrice(rows, options.source);
  const n = len(options.window, 9);
  const off = finiteOr(options.offset, 0.85);
  const sg = finiteOr(options.sigma, 6) > 0 ? finiteOr(options.sigma, 6) : 6;
  const out = nanArray(src.length);
  if (n <= src.length) {
    const m = Math.floor(off * (n - 1));
    const s = n / sg;
    const weights: number[] = [];
    let norm = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.exp(-((i - m) ** 2) / (2 * s * s));
      weights.push(w);
      norm += w;
    }
    for (let i = n - 1; i < src.length; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += src[i - n + 1 + j] * weights[j];
      const v = sum / norm;
      if (Number.isFinite(v)) out[i] = v;
    }
  }
  return points(rows, out, null);
}
