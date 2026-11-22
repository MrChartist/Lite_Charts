// Array maths the study files share. A series here is a plain `number[]` where NaN means "no value" (the kernel's null).
//
// Two families, kept apart because they differ on a gap:
//  - `emaOf`, `smaOf`, `wmaOf`, `emaCore`, `smaCore`, `wmaCore`: for a series with a leading run of no-values (the
//    output of another study). They start on the first real value, so a seed never includes a fake zero.
//  - `smaN`, `emaN`, `rmaN`, `wmaN`, `stdevN`, `highestN`, `lowestN`, `swmaN`, `changeN`: a window holding a no-value
//    gives no value, and a recursive average starts again (re-seeds) after a gap.

import { EmaCore } from './ema';
import { SmaCore } from './sma';
import { RsiCore } from './rsi';
import { isNum } from './shared';

export const nanArray = (n: number): number[] => new Array<number>(n).fill(NaN);

/** Integer length >= 1; a value that is not a finite number takes `fallback` (for the studies that read raw columns). */
export function len(v: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(isNum(v) ? v : fallback));
}

/** The carry-forward clean-up of a computed series: last finite value carried on, a leading gap takes the first finite one (0 if none). */
export function carry(values: ArrayLike<number>): number[] {
  const out = new Array<number>(values.length);
  let last = NaN, first = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNum(v)) { last = v; if (Number.isNaN(first)) first = v; }
    out[i] = last;
  }
  const fill = Number.isNaN(first) ? 0 : first;
  for (let i = 0; i < out.length && Number.isNaN(out[i]); i++) out[i] = fill;
  return out;
}

/** Simple mean over finite input (running sum, exact re-sum once per window). */
export function smaCore(x: ArrayLike<number>, p: number): number[] {
  const c = new SmaCore(p);
  const out = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++) out[i] = c.push(x[i]);
  return out;
}

/** EMA seeded with the mean of the first `p` values. */
export function emaCore(x: ArrayLike<number>, p: number): number[] {
  const c = new EmaCore(p);
  const out = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++) out[i] = c.push(x[i]);
  return out;
}

/** Wilder RSI of a finite series (first value on bar `p`). */
export function rsiCore(x: ArrayLike<number>, p: number): number[] {
  const c = new RsiCore(p);
  const out = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++) out[i] = c.push(x[i]);
  return out;
}

function onTail(values: ArrayLike<number>, f: (tail: number[]) => number[]): number[] {
  const n = values.length;
  let first = -1;
  for (let i = 0; i < n; i++) if (!Number.isNaN(values[i])) { first = i; break; }
  const out = nanArray(n);
  if (first < 0) return out;
  const tail = f(Array.prototype.slice.call(values, first) as number[]);
  for (let i = 0; i < tail.length; i++) out[first + i] = tail[i];
  return out;
}

export const emaOf = (values: ArrayLike<number>, p: number): number[] => onTail(values, t => emaCore(t, p));
export const smaOf = (values: ArrayLike<number>, p: number): number[] => onTail(values, t => smaCore(t, p));
export const wmaOf = (values: ArrayLike<number>, p: number): number[] => onTail(values, t => wmaN(t, p));

/** Simple mean where a window holding a no-value gives no value (running sum, exact re-sum once per window). */
export function meanStrict(values: ArrayLike<number>, period: number): number[] {
  const n = values.length;
  const out = nanArray(n);
  if (period < 1) return out;
  let sum = 0, nulls = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (Number.isNaN(v)) nulls++; else sum += v;
    if (i >= period) { const o = values[i - period]; if (Number.isNaN(o)) nulls--; else sum -= o; }
    if (i >= period - 1 && nulls === 0) {
      if ((i - (period - 1)) % period === 0) {
        sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += values[j];
      }
      out[i] = sum / period;
    }
  }
  return out;
}

export function smaN(x: ArrayLike<number>, length: number): number[] {
  const out = nanArray(x.length);
  for (let i = length - 1; i < x.length; i++) {
    let sum = 0;
    for (let j = i - length + 1; j <= i; j++) sum += x[j];
    if (Number.isFinite(sum)) out[i] = sum / length;
  }
  return out;
}

/** Recursive average with a mean seed; a non-finite input starts it again. `step(prev, value)` is the update. */
export function recursiveN(x: ArrayLike<number>, length: number, step: (prev: number, value: number) => number): number[] {
  const out = nanArray(x.length);
  let prev = NaN, run = 0, seedSum = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) { prev = NaN; run = 0; seedSum = 0; continue; }
    if (Number.isNaN(prev)) {
      run++;
      seedSum += v;
      if (run === length) { prev = seedSum / length; out[i] = prev; }
      continue;
    }
    prev = step(prev, v);
    out[i] = prev;
  }
  return out;
}

export function emaN(x: ArrayLike<number>, length: number): number[] {
  const k = 2 / (length + 1);
  return recursiveN(x, length, (prev, v) => v * k + prev * (1 - k));
}

export const rmaN = (x: ArrayLike<number>, length: number): number[] => recursiveN(x, length, (prev, v) => (prev * (length - 1) + v) / length);

/** Linearly weighted mean, newest weight `length`, oldest 1. */
export function wmaN(x: ArrayLike<number>, length: number): number[] {
  const out = nanArray(x.length);
  const denom = (length * (length + 1)) / 2;
  for (let i = length - 1; i < x.length; i++) {
    let sum = 0;
    for (let j = 0; j < length; j++) sum += x[i - length + 1 + j] * (j + 1);
    if (Number.isFinite(sum)) out[i] = sum / denom;
  }
  return out;
}

/** Population standard deviation over each window. */
export function stdevN(x: ArrayLike<number>, length: number): number[] {
  const out = nanArray(x.length);
  for (let i = length - 1; i < x.length; i++) {
    let sum = 0;
    for (let j = i - length + 1; j <= i; j++) sum += x[j];
    if (!Number.isFinite(sum)) continue;
    const mean = sum / length;
    let sq = 0;
    for (let j = i - length + 1; j <= i; j++) sq += (x[j] - mean) ** 2;
    out[i] = Math.sqrt(sq / length);
  }
  return out;
}

function extreme(x: ArrayLike<number>, length: number, high: boolean): number[] {
  const out = nanArray(x.length);
  for (let i = length - 1; i < x.length; i++) {
    let best = high ? -Infinity : Infinity;
    for (let j = i - length + 1; j <= i; j++) {
      if (!Number.isFinite(x[j])) { best = NaN; break; }
      if (high ? x[j] > best : x[j] < best) best = x[j];
    }
    out[i] = best;
  }
  return out;
}
export const highestN = (x: ArrayLike<number>, length: number): number[] => extreme(x, length, true);
export const lowestN = (x: ArrayLike<number>, length: number): number[] => extreme(x, length, false);

/** Weights 1, 2, 2, 1 over the last four bars (oldest first). */
export function swmaN(x: ArrayLike<number>): number[] {
  const out = nanArray(x.length);
  for (let i = 3; i < x.length; i++) {
    const v = (x[i - 3] + 2 * x[i - 2] + 2 * x[i - 1] + x[i]) / 6;
    if (Number.isFinite(v)) out[i] = v;
  }
  return out;
}

/** x[i] - x[i - length]. */
export function changeN(x: ArrayLike<number>, length: number): number[] {
  const out = nanArray(x.length);
  for (let i = length; i < x.length; i++) {
    const v = x[i] - x[i - length];
    if (Number.isFinite(v)) out[i] = v;
  }
  return out;
}

export type MaType = 'sma' | 'ema' | 'rma' | 'wma' | 'vwma' | 'hma';
export const MA_TYPES: MaType[] = ['sma', 'ema', 'rma', 'wma', 'vwma', 'hma'];

/** Hull average: WMA(2 * WMA(floor(n / 2)) - WMA(n), round(sqrt(n))). */
export function hmaN(x: ArrayLike<number>, length: number): number[] {
  const half = Math.max(1, Math.floor(length / 2));
  const root = Math.max(1, Math.round(Math.sqrt(length)));
  const a = wmaN(x, half), b = wmaN(x, length);
  return wmaN(a.map((v, i) => 2 * v - b[i]), root);
}

/** Volume-weighted mean: sum(x * volume) / sum(volume); a zero volume sum gives no value. */
export function vwmaN(src: ArrayLike<number>, vol: ArrayLike<number>, length: number): number[] {
  const out = nanArray(src.length);
  for (let i = length - 1; i < src.length; i++) {
    let pv = 0, v = 0;
    for (let j = i - length + 1; j <= i; j++) { pv += src[j] * vol[j]; v += vol[j]; }
    if (Number.isFinite(pv) && Number.isFinite(v) && v !== 0) out[i] = pv / v;
  }
  return out;
}

/** A moving average by name (unknown names are SMA); `vwma` reads `vol`. */
export function maN(type: string, x: ArrayLike<number>, length: number, vol: ArrayLike<number>): number[] {
  switch (type) {
    case 'ema': return emaN(x, length);
    case 'rma': return rmaN(x, length);
    case 'wma': return wmaN(x, length);
    case 'hma': return hmaN(x, length);
    case 'vwma': return vwmaN(x, vol, length);
    default: return smaN(x, length);
  }
}
