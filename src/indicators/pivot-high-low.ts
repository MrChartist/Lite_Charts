// Swing highs and lows.
//
//   pivotHighLow(rows, { left = 10, right = 10 }?) -> { high, low }
//
// A bar is a pivot high when its high is not exceeded by any of the `left` bars before it or the `right` bars after it (a pivot
// low mirrors this on lows; equal highs both count). The value is on the pivot bar itself (draw as markers). A pivot is known
// only `right` bars after it printed, so the last `right` bars never have one and appending bars never changes a pivot already
// shown. A window holding a bad bar is never a pivot. Needs candlestick rows.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export interface PivotHighLowOptions {
  left?: number;
  right?: number;
}

export interface PivotHighLowResult {
  high: IndicatorPoint[];
  low: IndicatorPoint[];
}

const bars = (v: number | undefined, fallback: number): number => Math.max(0, Math.floor(Number.isFinite(v) ? (v as number) : fallback));

function isPivot(values: readonly number[], i: number, left: number, right: number, high: boolean): boolean {
  const centre = values[i];
  if (!Number.isFinite(centre)) return false;
  for (let j = i - left; j <= i + right; j++) {
    const v = values[j];
    if (!Number.isFinite(v)) return false;
    if (high ? v > centre : v < centre) return false;
  }
  return true;
}

/** The pivots of raw high / low columns: `high[i]` / `low[i]` hold the price on a pivot bar, NaN elsewhere. */
export function scanPivots(highs: readonly number[], lows: readonly number[], left: number, right: number): { high: number[]; low: number[] } {
  const n = highs.length;
  const high = nanArray(n), low = nanArray(n);
  for (let i = left; i + right < n; i++) {
    if (isPivot(highs, i, left, right, true)) high[i] = highs[i];
    if (isPivot(lows, i, left, right, false)) low[i] = lows[i];
  }
  return { high, low };
}

export function pivotHighLow(rows: readonly IndicatorRow[], options: PivotHighLowOptions = {}): PivotHighLowResult {
  const p = scanPivots(rawCol(rows, r => r.high as number), rawCol(rows, r => r.low as number), bars(options.left, 10), bars(options.right, 10));
  return { high: points(rows, p.high, null), low: points(rows, p.low, null) };
}
