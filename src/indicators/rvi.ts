// Relative vigor index.
//
//   rvi(rows, period = 10) -> { rvi, signal }
//
// rvi = SMA(swma(close - open), period) / SMA(swma(high - low), period), swma weighting the last four bars 1-2-2-1 (divided
// by 6); signal = swma(rvi). First rvi on bar `period + 2`, signal three bars later. A window holding a bad bar has no
// value. Needs candlestick rows. Guide: 0.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { len, smaN, swmaN } from './series';

export interface RviResult {
  rvi: IndicatorPoint[];
  signal: IndicatorPoint[];
}

export function rvi(rows: readonly IndicatorRow[], period?: number): RviResult {
  const p = len(period, 10);
  const body = rawCol(rows, r => (r.close as number) - (r.open as number));
  const range = rawCol(rows, r => (r.high as number) - (r.low as number));
  const num = smaN(swmaN(body), p), den = smaN(swmaN(range), p);
  const line = num.map((v, i) => (den[i] !== 0 ? v / den[i] : NaN));
  return { rvi: points(rows, line, null), signal: points(rows, swmaN(line), null) };
}
