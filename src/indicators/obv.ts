// On-balance volume.
//
//   obv(rows) -> IndicatorPoint[]
//
// Starts at 0 on the first bar; adds the bar's volume when the close is above the previous close, subtracts it when
// below, keeps the value when equal. A missing, negative or non-numeric volume counts as 0. A bar whose close is not a
// number is `{ time }` only and the previous close carries on. Needs candlestick rows (close, volume).

import { column, isNum, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';

export function obv(rows: readonly IndicatorRow[]): IndicatorPoint[] {
  const { x, bad } = column(rows, r => r.close as number);
  const out = new Array<number>(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    const v = rows[i] ? rows[i].volume : undefined;
    const vol = isNum(v) && v >= 0 ? v : 0;
    if (i > 0) acc += x[i] > x[i - 1] ? vol : x[i] < x[i - 1] ? -vol : 0;
    out[i] = acc;
  }
  return points(rows, out, bad);
}
