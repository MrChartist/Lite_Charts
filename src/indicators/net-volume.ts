// Net volume.
//
//   netVolume(rows) -> IndicatorPoint[]
//
// +volume on a bar that closed above the previous close, -volume below it, 0 when unchanged. First value on bar 1. Draw as a
// histogram. A bar with a bad close (or a bad previous close) or volume has no value. Needs candlestick rows with volume.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export function netVolume(rows: readonly IndicatorRow[]): IndicatorPoint[] {
  const c = rawCol(rows, r => r.close as number), v = rawCol(rows, r => r.volume as number);
  const out = nanArray(c.length);
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    if (!Number.isFinite(d) || !Number.isFinite(v[i])) continue;
    out[i] = d > 0 ? v[i] : d < 0 ? -v[i] : 0;
  }
  return points(rows, out, null);
}
