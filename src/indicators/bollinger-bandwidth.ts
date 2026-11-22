// Bollinger band width.
//
//   bollingerBandwidth(rows, { period = 20, mult = 2, source }?) -> IndicatorPoint[]
//
// 100 * (upper band - lower band) / basis, with the bands of `bollinger` (basis +/- mult * population deviation). First value
// on bar `period - 1`; no value where the basis is 0. Low readings mark a squeeze.

import { closeCol } from './cols';
import { finiteOr, period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { rollingMeanStd } from './rolling';
import { nanArray } from './series';

export interface BandwidthOptions extends SourceOptions {
  period?: number;
  mult?: number;
}

export function bollingerBandwidth(rows: readonly IndicatorRow[], options: BandwidthOptions = {}): IndicatorPoint[] {
  const { x, bad } = closeCol(rows, options.source);
  const mult = finiteOr(options.mult, 2);
  const { mean, std } = rollingMeanStd(x, clampPeriod(options.period, 20, rows.length + 1));
  const out = nanArray(x.length);
  for (let i = 0; i < x.length; i++) {
    const up = mean[i] + mult * std[i], lo = mean[i] - mult * std[i];
    if (mean[i] !== 0) out[i] = ((up - lo) / mean[i]) * 100;
  }
  return points(rows, out, bad);
}
