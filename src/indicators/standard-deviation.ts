// Standard deviation.
//
//   standardDeviation(rows, period = 20, { source }?) -> IndicatorPoint[]
//
// The population standard deviation (divide by `period`) of the input over a rolling window. First value on bar
// `period - 1`. A flat window is exactly 0.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { rollingMeanStd } from './rolling';

export function standardDeviation(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  const { x, bad } = closeCol(rows, options.source);
  return points(rows, rollingMeanStd(x, clampPeriod(period, 20, rows.length + 1)).std, bad);
}
