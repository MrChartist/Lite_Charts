// Ultimate oscillator.
//
//   ultimateOscillator(rows, { p1 = 7, p2 = 14, p3 = 28 }?) -> IndicatorPoint[]
//
// 100 * (4 * A1 + 2 * A2 + A3) / 7 where Ak = sum of buying pressure / sum of true range over `pk` bars; buying pressure =
// close - min(low, previous close), true range = max(high, previous close) - min(low, previous close). First value on bar
// `p3`. 0 to 100. Needs candlestick rows. Guides: 30 and 70.

import { hlc } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export interface UltimateOptions {
  p1?: number;
  p2?: number;
  p3?: number;
}

export function ultimateOscillator(rows: readonly IndicatorRow[], options: UltimateOptions = {}): IndicatorPoint[] {
  const n = rows.length;
  const p1 = clampPeriod(options.p1, 7, n + 1), p2 = clampPeriod(options.p2, 14, n + 1), p3 = clampPeriod(options.p3, 28, n + 1);
  const { h, l, c, bad } = hlc(rows);
  const bp = new Array<number>(n).fill(0), tr = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const pc = c[i - 1];
    bp[i] = c[i] - Math.min(l[i], pc);
    tr[i] = Math.max(h[i], pc) - Math.min(l[i], pc);
  }
  const win = (a: number[], i: number, p: number): number => { let s = 0; for (let k = i - p + 1; k <= i; k++) s += a[k]; return s; };
  const out = nanArray(n);
  for (let i = p3; i < n; i++) {
    const t1 = win(tr, i, p1), t2 = win(tr, i, p2), t3 = win(tr, i, p3);
    if (t1 === 0 || t2 === 0 || t3 === 0) continue;
    out[i] = 100 * (4 * (win(bp, i, p1) / t1) + 2 * (win(bp, i, p2) / t2) + (win(bp, i, p3) / t3)) / 7;
  }
  return points(rows, out, bad);
}
