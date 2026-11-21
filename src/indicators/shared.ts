// Shared input and output shapes of the indicators entry, and the input hygiene every indicator follows.
//
// Input: any array of rows. A row is a candlestick `{ time, open, high, low, close, volume? }` or a plain
// `{ time, value }`. `source` picks the price an indicator reads from a candlestick (default 'close'); a
// `{ time, value }` row always reads its `value`.
// Output: arrays aligned 1:1 with the input, ready for `lineSeries.setData` / `histogramSeries.setData`. A bar
// with no value (warm-up, or an input that is not a number) is `{ time }` only, which takes a slot and draws nothing.
//
// Hygiene (the host kernel's rule, kept identical): a bar whose own input is not a finite number gets a `{ time }`
// row, and the series carries on from the last finite value, so one bad bar never poisons the bars after it. A
// leading gap is filled with the first finite value for the maths and still gets `{ time }` rows. No function throws.

import type { Time } from '../core/time';

/** The price an indicator reads from a candlestick row. */
export type PriceSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';

/** A row the indicators read. Loose on purpose: a missing or non-numeric field is a bar with no value, not an error. */
export interface IndicatorRow {
  time: Time;
  value?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

/** One output row: a value, or `{ time }` alone where there is none. Accepted by line and histogram series. */
export interface IndicatorPoint {
  time: Time;
  value?: number;
}

export interface SourceOptions {
  /** Which price to read from candlestick rows. Default 'close'. */
  source?: PriceSource;
}

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const n = (v: unknown): number => (typeof v === 'number' ? v : NaN);

/** The chosen price of one row; NaN when a needed field is missing or not a number. */
export function pick(r: IndicatorRow, source: PriceSource = 'close'): number {
  if (r.close === undefined && r.value !== undefined) return n(r.value);
  switch (source) {
    case 'open': return n(r.open);
    case 'high': return n(r.high);
    case 'low': return n(r.low);
    case 'hl2': return (n(r.high) + n(r.low)) / 2;
    case 'hlc3': return (n(r.high) + n(r.low) + n(r.close)) / 3;
    case 'ohlc4': return (n(r.open) + n(r.high) + n(r.low) + n(r.close)) / 4;
    default: return n(r.close);
  }
}

/** Integer window length in [1, max]; a missing length takes `fallback`, a non-number becomes 1. */
export function period(p: number | undefined, fallback: number, max: number): number {
  const v = p === undefined ? fallback : p;
  if (!isNum(v)) return 1;
  return Math.min(Math.max(1, Math.floor(v)), Math.max(1, max));
}

/** A multiplier or step: the given finite number, else the default. */
export function finiteOr(v: number | undefined, fallback: number): number {
  return isNum(v) ? v : fallback;
}

/** One input column made safe: `x` carries the last finite value forward (a leading gap takes the first), `bad` marks the bars that had none. */
export interface Column { x: number[]; bad: boolean[] | null }

export function column(rows: readonly IndicatorRow[], read: (r: IndicatorRow) => number): Column {
  const len = rows.length;
  const x = new Array<number>(len);
  let bad: boolean[] | null = null;
  let last = NaN;
  let first = NaN;
  for (let i = 0; i < len; i++) {
    const r = rows[i];
    const v = r ? read(r) : NaN;
    if (isNum(v)) {
      last = v;
      if (Number.isNaN(first)) first = v;
    } else {
      if (!bad) bad = new Array<boolean>(len).fill(false);
      bad[i] = true;
    }
    x[i] = last;
  }
  const fill = Number.isNaN(first) ? 0 : first;
  for (let i = 0; i < len && Number.isNaN(x[i]); i++) x[i] = fill;
  return { x, bad };
}

/** The bars that are bad in any of the columns. */
export function anyBad(cols: readonly Column[], len: number): boolean[] | null {
  let out: boolean[] | null = null;
  for (const c of cols) {
    if (!c.bad) continue;
    if (!out) out = new Array<boolean>(len).fill(false);
    for (let i = 0; i < len; i++) if (c.bad[i]) out[i] = true;
  }
  return out;
}

/** Output rows from a value array (NaN = no value); a bad bar is always `{ time }`. */
export function points(rows: readonly IndicatorRow[], values: ArrayLike<number>, bad: boolean[] | null): IndicatorPoint[] {
  const out = new Array<IndicatorPoint>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const v = values[i];
    const time = rows[i] ? rows[i].time : (undefined as unknown as Time);
    out[i] = (bad && bad[i]) || !isNum(v) ? { time } : { time, value: v };
  }
  return out;
}

export function emptyPoint(time: Time): IndicatorPoint {
  return { time };
}

/**
 * A stateful one-value step of an indicator, the same code for the batch call and the incremental `createIndicator`.
 * `push` takes the next finite input and returns the value (NaN while warming up). `mark` saves the state in O(1)
 * before a new bar; `rollback` returns to that mark, so the last bar can be replaced in O(1).
 */
export interface StepCore {
  push(x: number): number;
  mark(): void;
  rollback(): void;
}

/** Runs a core over a whole series the way the batch functions do. */
export function runCore(rows: readonly IndicatorRow[], source: PriceSource | undefined, core: StepCore): IndicatorPoint[] {
  const c = column(rows, r => pick(r, source));
  const vals = new Array<number>(rows.length);
  for (let i = 0; i < rows.length; i++) vals[i] = core.push(c.x[i]);
  return points(rows, vals, c.bad);
}
