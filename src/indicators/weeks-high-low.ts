// Rolling N-week high and low (52 weeks by default).
//
//   weeksHighLow(rows, { weeks = 52 }?) -> { high, low }
//
// The highest high and lowest low of the bars stamped within the `weeks * 7` days up to and including this bar. No value
// until the loaded history reaches back that far (a bar at least `weeks * 7 - 1` days older exists), so a short history
// never shows a "52-week" line that is really a 3-month one. `weeks` is 1 to 260. Needs candlestick rows with readable times.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';
import { secondsOf } from './period';

export interface WeeksHighLowOptions {
  weeks?: number;
}

export interface WeeksHighLowResult {
  high: IndicatorPoint[];
  low: IndicatorPoint[];
}

const DAY = 86_400_000;

export function weeksHighLow(rows: readonly IndicatorRow[], options: WeeksHighLowOptions = {}): WeeksHighLowResult {
  const n = rows.length;
  const weeks = Number.isFinite(options.weeks) ? Math.min(260, Math.max(1, Math.round(options.weeks as number))) : 52;
  const span = weeks * 7 * DAY;
  const t = secondsOf(rows).map(s => s * 1000);
  const H = rawCol(rows, r => r.high as number), L = rawCol(rows, r => r.low as number);
  const high = nanArray(n), low = nanArray(n);
  const hi: number[] = [], lo: number[] = [];
  let firstDate = NaN, start = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(t[i])) continue;
    if (!Number.isFinite(firstDate)) firstDate = t[i];
    const from = t[i] - span + 1;
    while (start < i && !(Number.isFinite(t[start]) && t[start] >= from)) start++;
    if (Number.isFinite(H[i])) { while (hi.length && H[hi[hi.length - 1]] <= H[i]) hi.pop(); hi.push(i); }
    if (Number.isFinite(L[i])) { while (lo.length && L[lo[lo.length - 1]] >= L[i]) lo.pop(); lo.push(i); }
    while (hi.length && hi[0] < start) hi.shift();
    while (lo.length && lo[0] < start) lo.shift();
    if (t[i] - firstDate < span - DAY) continue;
    if (hi.length) high[i] = H[hi[0]];
    if (lo.length) low[i] = L[lo[0]];
  }
  return { high: points(rows, high, null), low: points(rows, low, null) };
}
