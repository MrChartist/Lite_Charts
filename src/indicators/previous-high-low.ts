// Previous period high, low and close.
//
//   previousHighLow(rows, { period = 'auto', zone = 'UTC' }?) -> { high, low, close }
//
// The high, low and last close of the previous completed period, held flat on every bar of the current one. `period` and
// `zone` as for `pivotPoints`. No value until one period has completed.

import { levelInput } from './levels';
import type { LevelOptions } from './levels';
import { stepped } from './period';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export interface PreviousHighLowResult {
  high: IndicatorPoint[];
  low: IndicatorPoint[];
  close: IndicatorPoint[];
}

export function previousHighLow(rows: readonly IndicatorRow[], options: LevelOptions = {}): PreviousHighLowResult {
  const n = rows.length;
  const { keys, hi, lo, cl } = levelInput(rows, options);
  const per = stepped(keys, hi, lo, cl, h => h);
  const high = nanArray(n), low = nanArray(n), close = nanArray(n);
  for (let i = 0; i < n; i++) { const v = per[i]; if (v) { high[i] = v.high; low[i] = v.low; close[i] = v.close; } }
  return { high: points(rows, high, null), low: points(rows, low, null), close: points(rows, close, null) };
}
