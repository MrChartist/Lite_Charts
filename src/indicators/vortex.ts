// Vortex indicator.
//
//   vortex(rows, period = 14) -> { plus, minus }
//
// VI+ = sum |high - previous low| / sum true range, VI- = sum |low - previous high| / sum true range, over `period` bars.
// First value on bar `period`. Needs candlestick rows. Guide: 1.

import { hlc } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export interface VortexResult {
  plus: IndicatorPoint[];
  minus: IndicatorPoint[];
}

export function vortex(rows: readonly IndicatorRow[], period?: number): VortexResult {
  const n = rows.length;
  const p = clampPeriod(period, 14, n + 1);
  const { h, l, c, bad } = hlc(rows);
  const vp = new Array<number>(n).fill(0), vm = new Array<number>(n).fill(0), tr = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    vp[i] = Math.abs(h[i] - l[i - 1]);
    vm[i] = Math.abs(l[i] - h[i - 1]);
    tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  }
  const plus = nanArray(n), minus = nanArray(n);
  for (let i = p; i < n; i++) {
    let sp = 0, sm = 0, st = 0;
    for (let k = i - p + 1; k <= i; k++) { sp += vp[k]; sm += vm[k]; st += tr[k]; }
    if (st > 0) { plus[i] = sp / st; minus[i] = sm / st; }
  }
  return { plus: points(rows, plus, bad), minus: points(rows, minus, bad) };
}
