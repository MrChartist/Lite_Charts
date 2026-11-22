// Linear regression channel.
//
//   linRegChannel(rows, { period = 100, deviations = 2, source }?) -> { upper, middle, lower }
//
// Per bar, the least-squares line through the last `period` values (x = 0 .. period - 1, the current bar last):
// middle = the line's value on the current bar, upper and lower = middle +/- deviations * the POPULATION standard
// deviation of the residuals. First value on bar `period - 1`. Causal: bar i reads only bars up to i. A window holding a
// bad value has no value.

import { rawPrice } from './cols';
import { finiteOr, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { len, nanArray } from './series';

export interface LinRegChannelOptions extends SourceOptions {
  period?: number;
  deviations?: number;
}

export interface LinRegChannelResult {
  upper: IndicatorPoint[];
  middle: IndicatorPoint[];
  lower: IndicatorPoint[];
}

export function linRegChannel(rows: readonly IndicatorRow[], options: LinRegChannelOptions = {}): LinRegChannelResult {
  const n = len(options.period, 100);
  const mult = finiteOr(options.deviations, 2);
  const src = rawPrice(rows, options.source);
  const mid = nanArray(src.length), upper = nanArray(src.length), lower = nanArray(src.length);
  for (let i = n - 1; i < src.length; i++) {
    const start = i - n + 1;
    let sumY = 0, ok = true;
    for (let k = 0; k < n; k++) { const v = src[start + k]; if (!Number.isFinite(v)) { ok = false; break; } sumY += v; }
    if (!ok) continue;
    const meanY = sumY / n, meanX = (n - 1) / 2;
    let sxx = 0, sxy = 0;
    for (let x = 0; x < n; x++) { const dx = x - meanX; sxx += dx * dx; sxy += dx * (src[start + x] - meanY); }
    const slope = sxx === 0 ? 0 : sxy / sxx;
    const intercept = meanY - slope * meanX;
    let sse = 0;
    for (let x = 0; x < n; x++) { const r = src[start + x] - (intercept + slope * x); sse += r * r; }
    const end = intercept + slope * (n - 1), sd = Math.sqrt(sse / n);
    mid[i] = end; upper[i] = end + mult * sd; lower[i] = end - mult * sd;
  }
  return { upper: points(rows, upper, null), middle: points(rows, mid, null), lower: points(rows, lower, null) };
}
