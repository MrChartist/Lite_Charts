// Volume rate of change.
//
//   volumeRoc(rows, period = 14) -> IndicatorPoint[]
//
// 100 * (volume - volume[period]) / volume[period]. First value on bar `period`; no value where the earlier volume is 0. A bar
// whose volume is not a number is `{ time }` (it counts as 0 in other bars' look-back).

import { isNum, period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export function volumeRoc(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const p = clampPeriod(period, 14, rows.length + 1);
  const bad = rows.map(r => !r || !isNum(r.volume));
  const v = rows.map((r, i) => (!bad[i] && (r.volume as number) >= 0 ? (r.volume as number) : 0));
  const out = nanArray(v.length);
  for (let i = p; i < v.length; i++) { const prev = v[i - p]; if (prev !== 0) out[i] = ((v[i] - prev) / prev) * 100; }
  return points(rows, out, bad.some(Boolean) ? bad : null);
}
