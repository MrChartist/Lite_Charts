// Volume-weighted price accumulator with standard-deviation bands, shared by `vwapBands` and `anchoredVwap`.
//   vwap = sum(price * volume) / sum(volume); dev = sqrt(max(sum(volume * price^2) / sum(volume) - vwap^2, 0))
//   band k = vwap +/- k * dev

import { isNum, pick } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';
import type { Time } from '../core/time';

export type VwapPrice = 'hlc3' | 'hl2' | 'ohlc4' | 'close';

export interface VwapBandsResult {
  vwap: IndicatorPoint[];
  upper1: IndicatorPoint[];
  lower1: IndicatorPoint[];
  upper2: IndicatorPoint[];
  lower2: IndicatorPoint[];
  upper3: IndicatorPoint[];
  lower3: IndicatorPoint[];
}

export const BAND_KEYS = ['vwap', 'upper1', 'lower1', 'upper2', 'lower2', 'upper3', 'lower3'] as const;

/** Three band multipliers: each a finite number >= 0, else 1, 2, 3. */
export function multipliers(m?: readonly number[]): [number, number, number] {
  const d = [1, 2, 3];
  const pickAt = (i: number): number => (m && isNum(m[i]) && m[i] >= 0 ? m[i] : d[i]);
  return [pickAt(0), pickAt(1), pickAt(2)];
}

export function accumulator() {
  let pv = 0, v = 0, p2v = 0;
  return {
    add(price: number, volume: number): void {
      if (!isNum(price) || !isNum(volume) || volume < 0) return;
      pv += price * volume;
      p2v += price * price * volume;
      v += volume;
    },
    reset(): void { pv = 0; v = 0; p2v = 0; },
    /** Writes vwap and the bands into `out[k][i]`; leaves NaN until volume has accumulated. */
    read(out: number[][], i: number, m: readonly number[]): void {
      if (v <= 0) return;
      const vwap = pv / v;
      const dev = Math.sqrt(Math.max(p2v / v - vwap * vwap, 0));
      out[0][i] = vwap;
      out[1][i] = vwap + m[0] * dev; out[2][i] = vwap - m[0] * dev;
      out[3][i] = vwap + m[1] * dev; out[4][i] = vwap - m[1] * dev;
      out[5][i] = vwap + m[2] * dev; out[6][i] = vwap - m[2] * dev;
    },
  };
}

export const newBands = (n: number): number[][] => BAND_KEYS.map(() => nanArray(n));

export function bandsResult(rows: readonly IndicatorRow[], out: number[][]): VwapBandsResult {
  const rowsOut = (k: number): IndicatorPoint[] => rows.map((r, i) => {
    const time = (r ? r.time : undefined) as Time;
    return Number.isFinite(out[k][i]) ? { time, value: out[k][i] } : { time };
  });
  return { vwap: rowsOut(0), upper1: rowsOut(1), lower1: rowsOut(2), upper2: rowsOut(3), lower2: rowsOut(4), upper3: rowsOut(5), lower3: rowsOut(6) };
}

export const priceOf = (r: IndicatorRow, source: VwapPrice): number => pick(r, source);
