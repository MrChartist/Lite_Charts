// Ichimoku cloud.
//
//   ichimoku(rows, { tenkan = 9, kijun = 26, senkouB = 52 }?) -> { tenkan, kijun, senkouA, senkouB, chikou }
//
// tenkan / kijun = the middle of the highest high and lowest low over 9 / 26 bars (first values on bars 8 and 25);
// senkouA = (tenkan + kijun) / 2 and senkouB = the 52-bar middle, both DISPLACED forward by `kijun - 1` bars (25 by
// default): the value on bar i was computed on bar i - 25, so the first cloud value is on bar `max(tenkan, kijun) - 1 +
// 25` (senkouB: `senkouB - 1 + 25`). chikou = the close `kijun - 1` bars LATER (the lagging line drawn back), so the last
// 25 bars have none. Every array is aligned with the input; the part of the cloud that projects past the last bar is
// returned by `ichimokuFuture`. Needs candlestick rows. A bar with a bad high, low or close has no value of its own.

import { hlc } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { slidingExtremeIndex } from './rolling';
import { nanArray } from './series';

export interface IchimokuOptions {
  tenkan?: number;
  kijun?: number;
  senkouB?: number;
}

export interface IchimokuResult {
  tenkan: IndicatorPoint[];
  kijun: IndicatorPoint[];
  senkouA: IndicatorPoint[];
  senkouB: IndicatorPoint[];
  chikou: IndicatorPoint[];
}

function middle(h: number[], l: number[], p: number): number[] {
  const hi = slidingExtremeIndex(h, p, 'max'), lo = slidingExtremeIndex(l, p, 'min');
  return hi.map((k, i) => (k < 0 ? NaN : (h[k] + l[lo[i]]) / 2));
}

function raw(h: number[], l: number[], o: IchimokuOptions, n: number) {
  const tenkan = middle(h, l, clampPeriod(o.tenkan, 9, n + 1));
  const kijunP = clampPeriod(o.kijun, 26, n + 1);
  const kijun = middle(h, l, kijunP);
  return {
    tenkan, kijun, d: kijunP - 1,
    senkouA: tenkan.map((t, i) => (t + kijun[i]) / 2),
    senkouB: middle(h, l, clampPeriod(o.senkouB, 52, n + 1)),
  };
}

const fin = (v: number): number => (Number.isFinite(v) ? v : NaN);

export function ichimoku(rows: readonly IndicatorRow[], options: IchimokuOptions = {}): IchimokuResult {
  const n = rows.length;
  const { h, l, c, bad } = hlc(rows);
  const r = raw(h, l, options, n);
  const isBad = (i: number): boolean => i >= 0 && i < n && !!bad && bad[i];
  const tenkan = nanArray(n), kijun = nanArray(n), senkouA = nanArray(n), senkouB = nanArray(n), chikou = nanArray(n);
  for (let i = 0; i < n; i++) {
    const src = i - r.d;
    const cloud = src >= 0 && !isBad(src);
    if (!isBad(i)) { tenkan[i] = fin(r.tenkan[i]); kijun[i] = fin(r.kijun[i]); }
    if (cloud) { senkouA[i] = fin(r.senkouA[src]); senkouB[i] = fin(r.senkouB[src]); }
    if (i + r.d < n && !isBad(i + r.d)) chikou[i] = c[i + r.d];
  }
  return {
    tenkan: points(rows, tenkan, null), kijun: points(rows, kijun, null), senkouA: points(rows, senkouA, null),
    senkouB: points(rows, senkouB, null), chikou: points(rows, chikou, null),
  };
}

export interface IchimokuFutureSlot {
  /** 1 is the slot right after the last bar. */
  barsAhead: number;
  senkouA?: number;
  senkouB?: number;
}

/** The part of the cloud past the last bar: `kijun - 1` slots, slot j shows the value computed on bar `n - (kijun - 1) + j`. */
export function ichimokuFuture(rows: readonly IndicatorRow[], options: IchimokuOptions = {}): IchimokuFutureSlot[] {
  const n = rows.length;
  const { h, l, bad } = hlc(rows);
  const r = raw(h, l, options, n);
  const out: IchimokuFutureSlot[] = [];
  for (let j = 0; j < r.d; j++) {
    const src = n - r.d + j;
    const ok = src >= 0 && src < n && !(bad && bad[src]);
    const slot: IchimokuFutureSlot = { barsAhead: j + 1 };
    if (ok && Number.isFinite(r.senkouA[src])) slot.senkouA = r.senkouA[src];
    if (ok && Number.isFinite(r.senkouB[src])) slot.senkouB = r.senkouB[src];
    out.push(slot);
  }
  return out;
}
