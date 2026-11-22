// Momentum.
//
//   momentum(rows, period = 10, { source }?) -> IndicatorPoint[]
//
// x - x[period]. First value on bar `period`. A bar whose input is not a number is `{ time }`, and so is any bar whose
// look-back bar was bad.

import { rawPrice } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { changeN, len } from './series';

export function momentum(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  return points(rows, changeN(rawPrice(rows, options.source), len(period, 10)), null);
}
