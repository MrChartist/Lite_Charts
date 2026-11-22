// Shared engine of the negative and positive volume indexes.
//
// The index only moves on bars whose volume moved in the tracked direction against the previous bar, by that bar's percent
// price change. A bar (or previous bar) with unusable data holds the index flat; an unusable current bar has no value.

import { rawCol } from './cols';
import { finiteOr, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export function volumeIndex(rows: readonly IndicatorRow[], start: number | undefined, tracksLower: boolean): IndicatorPoint[] {
  const c = rawCol(rows, r => r.close as number), v = rawCol(rows, r => r.volume as number);
  const out = nanArray(c.length);
  let idx = finiteOr(start, 1000);
  if (c.length > 0) out[0] = Number.isFinite(c[0]) ? idx : NaN;
  for (let i = 1; i < c.length; i++) {
    if (!Number.isFinite(c[i]) || !Number.isFinite(v[i])) continue;
    const hasPrev = Number.isFinite(c[i - 1]) && c[i - 1] !== 0 && Number.isFinite(v[i - 1]);
    const moved = hasPrev && (tracksLower ? v[i] < v[i - 1] : v[i] > v[i - 1]);
    if (moved) idx += (idx * (c[i] - c[i - 1])) / c[i - 1];
    out[i] = idx;
  }
  return points(rows, out, null);
}
