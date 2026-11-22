// Know sure thing.
//
//   kst(rows, { source }?) -> { kst, signal }
//
// kst = SMA(ROC 10, 10) + 2 * SMA(ROC 15, 10) + 3 * SMA(ROC 20, 10) + 4 * SMA(ROC 30, 15); signal = SMA(kst, 9). First kst
// on bar 44 (30 + 15 - 1), signal on bar 52. Guide: 0.

import { closeCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { rocValues } from './roc';
import { nanArray, smaOf } from './series';

export interface KstResult {
  kst: IndicatorPoint[];
  signal: IndicatorPoint[];
}

export function kst(rows: readonly IndicatorRow[], options: SourceOptions = {}): KstResult {
  const { x, bad } = closeCol(rows, options.source);
  const rcma = (r: number, s: number): number[] => smaOf(rocValues(x, r), s);
  const a = rcma(10, 10), b = rcma(15, 10), c = rcma(20, 10), d = rcma(30, 15);
  const line = nanArray(x.length);
  for (let i = 0; i < x.length; i++) if (!Number.isNaN(a[i]) && !Number.isNaN(b[i]) && !Number.isNaN(c[i]) && !Number.isNaN(d[i])) line[i] = a[i] + 2 * b[i] + 3 * c[i] + 4 * d[i];
  const sig = smaOf(line, 9);
  return { kst: points(rows, line, bad), signal: points(rows, line.map((v, i) => (Number.isNaN(v) ? NaN : sig[i])), bad) };
}
