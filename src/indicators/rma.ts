// Wilder moving average (RMA, also called SMMA).
//
//   rma(rows, period = 7, { source }?) -> IndicatorPoint[]      smma is the same function
//
// avg = (avg * (period - 1) + x) / period, seeded with the simple mean of the first `period` values (first value on
// bar `period - 1`). Very smooth and slow. A bar whose input is not a number is `{ time }` and the average starts again
// after it (re-seeds on the next `period` numbers).

import { rawPrice } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { len, rmaN } from './series';

export function rma(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  return points(rows, rmaN(rawPrice(rows, options.source), len(period, 7)), null);
}

export const smma = rma;
