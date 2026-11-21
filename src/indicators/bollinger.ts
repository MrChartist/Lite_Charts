// Bollinger bands.
//
//   bollinger(rows, { period = 20, mult = 2, source }?) -> { basis, upper, lower }
//
// basis = simple mean, bands = basis +/- mult * population standard deviation (divide by `period`), first value on
// bar `period - 1`. A flat window has a deviation of exactly 0. Three `lineSeries` arrays.

import { column, finiteOr, period as clampPeriod, pick, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { rollingMeanStd } from './rolling';

export interface BollingerOptions extends SourceOptions {
  period?: number;
  /** Width in standard deviations. Default 2. */
  mult?: number;
}

export interface BollingerResult {
  basis: IndicatorPoint[];
  upper: IndicatorPoint[];
  lower: IndicatorPoint[];
}

export function bollinger(rows: readonly IndicatorRow[], options: BollingerOptions = {}): BollingerResult {
  const p = clampPeriod(options.period, 20, rows.length + 1);
  const mult = finiteOr(options.mult, 2);
  const { x, bad } = column(rows, r => pick(r, options.source));
  const { mean, std } = rollingMeanStd(x, p);
  const upper = new Array<number>(x.length), lower = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++) {
    upper[i] = mean[i] + mult * std[i];
    lower[i] = mean[i] - mult * std[i];
  }
  return { basis: points(rows, mean, bad), upper: points(rows, upper, bad), lower: points(rows, lower, bad) };
}
