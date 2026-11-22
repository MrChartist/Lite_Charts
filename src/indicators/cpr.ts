// Central pivot range from the previous completed period.
//
//   cpr(rows, { period = 'auto', zone = 'UTC' }?) -> { top, pivot, bottom }
//
// pivot = (H+L+C)/3, BC = (H+L)/2, TC = 2 * pivot - BC, from the previous period's high H, low L and last close C; `top`
// is the larger of TC and BC, `bottom` the smaller. Held flat on every bar of the current period. A narrow range
// suggests a trending day. `period` and `zone` as for `pivotPoints`. No value until one period has completed.

import { levelInput } from './levels';
import type { LevelOptions } from './levels';
import { stepped } from './period';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export interface CprResult {
  top: IndicatorPoint[];
  pivot: IndicatorPoint[];
  bottom: IndicatorPoint[];
}

export function cpr(rows: readonly IndicatorRow[], options: LevelOptions = {}): CprResult {
  const n = rows.length;
  const { keys, hi, lo, cl } = levelInput(rows, options);
  const per = stepped(keys, hi, lo, cl, h => {
    const pivot = (h.high + h.low + h.close) / 3;
    const b = (h.high + h.low) / 2;
    const t = 2 * pivot - b;
    return { top: Math.max(t, b), pivot, bottom: Math.min(t, b) };
  });
  const top = nanArray(n), pivot = nanArray(n), bottom = nanArray(n);
  for (let i = 0; i < n; i++) { const v = per[i]; if (v) { top[i] = v.top; pivot[i] = v.pivot; bottom[i] = v.bottom; } }
  return { top: points(rows, top, null), pivot: points(rows, pivot, null), bottom: points(rows, bottom, null) };
}
