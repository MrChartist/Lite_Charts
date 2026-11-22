// Average directional index (directional movement, Wilder).
//
//   adx(rows, period = 14) -> { adx, plusDI, minusDI }
//
// +DI / -DI = 100 * smoothed +DM / -DM over smoothed true range (Wilder sums: s = s - s / period + x), first values on bar
// `period`; DX = 100 * |+DI - -DI| / (+DI + -DI); ADX = the mean of the first `period` DX values (first ADX on bar
// `2 * period - 1`), then (ADX * (period - 1) + DX) / period. Needs candlestick rows. Guide: 25.

import { hlc } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export interface AdxResult {
  adx: IndicatorPoint[];
  plusDI: IndicatorPoint[];
  minusDI: IndicatorPoint[];
}

export function adx(rows: readonly IndicatorRow[], period?: number): AdxResult {
  const n = rows.length;
  const p = clampPeriod(period, 14, n + 1);
  const { h, l, c, bad } = hlc(rows);
  const A = nanArray(n), P = nanArray(n), M = nanArray(n);
  if (n >= 2) {
    const tr = [0], pdm = [0], mdm = [0];
    for (let i = 1; i < n; i++) {
      const pc = c[i - 1];
      tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc)));
      const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
      pdm.push(up > down && up > 0 ? up : 0);
      mdm.push(down > up && down > 0 ? down : 0);
    }
    let sTR = 0, sP = 0, sM = 0;
    for (let i = 1; i <= p; i++) { sTR += tr[i]; sP += pdm[i]; sM += mdm[i]; }
    const dx: number[] = [];
    for (let i = p; i < n; i++) {
      if (i > p) { sTR = sTR - sTR / p + tr[i]; sP = sP - sP / p + pdm[i]; sM = sM - sM / p + mdm[i]; }
      const pDI = sTR === 0 ? 0 : (sP / sTR) * 100, mDI = sTR === 0 ? 0 : (sM / sTR) * 100;
      const sum = pDI + mDI;
      dx.push(sum === 0 ? 0 : (Math.abs(pDI - mDI) / sum) * 100);
      if (dx.length === p) { let s = 0; for (const v of dx) s += v; A[i] = s / p; }
      else if (dx.length > p) A[i] = Number.isNaN(A[i - 1]) ? dx[dx.length - 1] : (A[i - 1] * (p - 1) + dx[dx.length - 1]) / p;
      P[i] = pDI; M[i] = mDI;
    }
  }
  return { adx: points(rows, A, bad), plusDI: points(rows, P, bad), minusDI: points(rows, M, bad) };
}
