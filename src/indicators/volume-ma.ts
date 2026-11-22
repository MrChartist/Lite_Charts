// Volume with a moving average.
//
//   volumeMa(rows, period = 20) -> { volume, ma }
//
// `volume` is each bar's volume (`{ time }` where it is not a number); `ma` is the simple average of the last `period`
// volumes, first value on bar `period - 1`, none while the window holds a bad volume. Needs rows with volume. Draw `volume`
// as a histogram and `ma` as a line.

import { isNum, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { len, nanArray } from './series';

export interface VolumeMaResult {
  volume: IndicatorPoint[];
  ma: IndicatorPoint[];
}

export function volumeMa(rows: readonly IndicatorRow[], period?: number): VolumeMaResult {
  const n = len(period, 20);
  const vol = rows.map(r => (r && isNum(r.volume) ? r.volume : NaN));
  const ma = nanArray(vol.length);
  let sum = 0, bad = 0;
  for (let i = 0; i < vol.length; i++) {
    if (Number.isNaN(vol[i])) bad++; else sum += vol[i];
    if (i >= n) { if (Number.isNaN(vol[i - n])) bad--; else sum -= vol[i - n]; }
    if (i >= n - 1 && bad === 0) ma[i] = sum / n;
  }
  return { volume: points(rows, vol, null), ma: points(rows, ma, null) };
}
