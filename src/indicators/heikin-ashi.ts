// Heikin-Ashi candles.
//
//   heikinAshi(rows) -> { time, open, high, low, close }[]
//
// close = mean of open, high, low, close; open = mean of the previous Heikin-Ashi open and close (the first bar:
// mean of its own open and close); high / low = the extreme of the real high / low and the new open and close.
// A bar with a leg that is not a number is `{ time }` only and does not disturb the state. Feed the result to a
// candlestick series in place of the real bars.

import type { Time } from '../core/time';
import { emptyPoint, isNum } from './shared';
import type { IndicatorRow } from './shared';

export interface HeikinAshiBar {
  time: Time;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}

export function heikinAshi(rows: readonly IndicatorRow[]): HeikinAshiBar[] {
  const out = new Array<HeikinAshiBar>(rows.length);
  let pOpen = NaN, pClose = NaN;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const { open, high, low, close } = r;
    if (!isNum(open) || !isNum(high) || !isNum(low) || !isNum(close)) { out[i] = emptyPoint(r.time); continue; }
    const c = (open + high + low + close) / 4;
    const o = Number.isNaN(pOpen) ? (open + close) / 2 : (pOpen + pClose) / 2;
    out[i] = { time: r.time, open: o, high: Math.max(high, o, c), low: Math.min(low, o, c), close: c };
    pOpen = o; pClose = c;
  }
  return out;
}
