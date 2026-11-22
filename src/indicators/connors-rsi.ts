// Connors RSI.
//
//   connorsRsi(rows, { rsiPeriod = 3, streakPeriod = 2, rankPeriod = 100, source }?) -> IndicatorPoint[]
//
// The mean of three 0 to 100 readings: RSI(rsiPeriod) of the price, RSI(streakPeriod) of the up / down streak length
// (+1, +2.. on rising closes, -1, -2.. on falling, 0 when flat), and the percent rank of the bar's one-bar percent change
// among the previous `rankPeriod` changes (ties count). First value on bar `rankPeriod + 1`. Guides: 10 and 90.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { nanArray, rsiCore } from './series';

export interface ConnorsRsiOptions extends SourceOptions {
  rsiPeriod?: number;
  streakPeriod?: number;
  rankPeriod?: number;
}

export function connorsRsi(rows: readonly IndicatorRow[], options: ConnorsRsiOptions = {}): IndicatorPoint[] {
  const n = rows.length;
  const rp = clampPeriod(options.rsiPeriod, 3, n + 1), sp = clampPeriod(options.streakPeriod, 2, n + 1), kp = clampPeriod(options.rankPeriod, 100, n + 1);
  const { x, bad } = closeCol(rows, options.source);
  const rsi = rsiCore(x, rp);
  const streak = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (x[i] > x[i - 1]) streak[i] = streak[i - 1] > 0 ? streak[i - 1] + 1 : 1;
    else if (x[i] < x[i - 1]) streak[i] = streak[i - 1] < 0 ? streak[i - 1] - 1 : -1;
    else streak[i] = 0;
  }
  const streakRsi = rsiCore(streak, sp);
  const roc = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) roc[i] = x[i - 1] !== 0 ? ((x[i] - x[i - 1]) / x[i - 1]) * 100 : 0;
  const out = nanArray(n);
  for (let i = kp + 1; i < n; i++) {
    if (Number.isNaN(rsi[i]) || Number.isNaN(streakRsi[i])) continue;
    let cnt = 0;
    for (let k = i - kp; k < i; k++) if (roc[k] <= roc[i]) cnt++;
    out[i] = (rsi[i] + streakRsi[i] + (cnt / kp) * 100) / 3;
  }
  return points(rows, out, bad);
}
