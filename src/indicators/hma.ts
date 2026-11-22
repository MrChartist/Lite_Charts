// Hull moving average.
//
//   hma(rows, period = 14, { source }?) -> IndicatorPoint[]
//
// WMA(2 * WMA(floor(period / 2)) - WMA(period), round(sqrt(period))): smooth, and quicker to turn than a plain average.
// First value on bar `period + round(sqrt(period)) - 2`. A bar whose input is not a number is `{ time }`.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { wmaN, wmaOf } from './series';

export function hma(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  const p = clampPeriod(period, 14, rows.length + 1);
  const { x, bad } = closeCol(rows, options.source);
  const half = Math.max(1, Math.floor(p / 2));
  const diff = hmaDiff(x, half, p);
  return points(rows, wmaOf(diff, Math.max(1, Math.round(Math.sqrt(p)))), bad);
}

function hmaDiff(x: number[], half: number, p: number): number[] {
  const a = wmaN(x, half), b = wmaN(x, p);
  return a.map((v, i) => 2 * v - b[i]);
}
