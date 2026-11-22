// Shared pieces of the transforms entry: row shapes, the size resolver (fixed, ATR or percent, or an automatic size
// that follows the data), and the base class every incremental transform builds on.
//
// Rules every transform follows: rows in, rows out, deterministic, O(n), never throws. A row whose time or price
// cannot be used is skipped (it neither moves the state nor appears in the output). Output rows are dated by the
// source bar that completed them and carry `sourceIndex` (the index of that bar in the input array, counting every
// input row) and a `volume` sum, so that nothing the source bars traded is counted twice.

import type { Time } from '../core/time';
import { atrValues } from '../indicators/atr';
import { pick } from '../indicators/shared';
import type { IndicatorRow, PriceSource } from '../indicators/shared';

export type { PriceSource };

/** An input row: a candlestick (`open`, `high`, `low`, `close`, `volume?`) or a plain `{ time, value }`. */
export type TransformRow = IndicatorRow;

/** One output bar of a transform. */
export interface BrickRow {
  /** Time of the source bar that completed this row. Several rows of one transform may share it (see `spreadTimes`). */
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume of the source bars since the previous output row (credited to the first row a bar produces). */
  volume: number;
  /** Index in the input array of the bar that completed this row. */
  sourceIndex: number;
}

/**
 * How a size (brick, box, range, reversal) is given: a price amount, an ATR (`atr` = period, `multiplier` default 1),
 * or a percentage of the last completed bar's price. ATR and percent sizes are measured on the rows given and then
 * fixed; the returned size says what was chosen.
 */
export type SizeSpec = number | { atr: number; multiplier?: number } | { percent: number };

/** Most output rows a transform makes before it stops (a brick far smaller than the price moves would make millions). */
export const MAX_ROWS = 100_000;

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function timeOk(t: unknown): t is Time {
  return (typeof t === 'number' && Number.isFinite(t)) || typeof t === 'string' || (typeof t === 'object' && t !== null);
}

export function cloneTime(t: Time): Time {
  return typeof t === 'object' && t !== null ? { year: t.year, month: t.month, day: t.day } : t;
}

/** The price a transform reads from a row, NaN when the row cannot be used. */
export function priceOf(r: TransformRow | null | undefined, source: PriceSource): number {
  if (!r || typeof r !== 'object' || !timeOk(r.time)) return NaN;
  const p = pick(r, source);
  return Number.isFinite(p) ? p : NaN;
}

export function volumeOf(r: TransformRow): number {
  const v = r.volume;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

const sig2 = (v: number): number => Number(v.toPrecision(2));

/**
 * A "nice" size scaled to the instrument's own price level: about 60 boxes across the highest high to the lowest low
 * of the rows, snapped to 1, 2 or 5 times a power of ten. Ported from the host's `autoBoxSize`. Never throws; 1 when
 * there is nothing to measure.
 */
export function autoBoxSize(rows: readonly TransformRow[]): number {
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const p = priceOf(r, 'close');
    if (!Number.isFinite(p)) continue;
    const h = isNum(r.high) ? r.high : p;
    const l = isNum(r.low) ? r.low : p;
    if (h > hi) hi = h;
    if (l < lo) lo = l;
  }
  if (hi === -Infinity) return 1;
  const range = hi - lo;
  if (!(range > 0)) return Math.max(0.01, hi * 0.005 || 1);
  const rough = range / 60;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Wilder ATR(period) of the true OHLC at the last COMPLETED bar (the forming last row is left out); NaN when there are too few rows. */
export function atrAtLastCompleted(rows: readonly TransformRow[], period: number): number {
  const p = Math.max(1, Math.floor(period));
  const end = rows.length > 1 ? rows.length - 1 : rows.length;
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < end; i++) {
    const r = rows[i];
    const close = priceOf(r, 'close');
    if (!Number.isFinite(close)) continue;
    h.push(isNum(r.high) ? Math.max(r.high, close) : close);
    l.push(isNum(r.low) ? Math.min(r.low, close) : close);
    c.push(close);
  }
  if (c.length <= p) return NaN;
  const a = atrValues(h, l, c, p);
  for (let i = a.length - 1; i >= 0; i--) {
    const v = a[i];
    if (Number.isFinite(v) && v > 0) return v;
    if (Number.isFinite(v)) break;
  }
  return NaN;
}

/** The price a percentage size is taken from: the last completed bar's price. */
function referencePrice(rows: readonly TransformRow[], source: PriceSource): number {
  let last = NaN;
  let prev = NaN;
  for (let i = rows.length - 1; i >= 0; i--) {
    const p = priceOf(rows[i], source);
    if (!Number.isFinite(p)) continue;
    if (Number.isNaN(last)) last = p;
    else { prev = p; break; }
  }
  return Number.isFinite(prev) ? prev : last;
}

/**
 * A size spec measured on the rows: a usable number is returned as it is; `{ atr }` and `{ percent }` are measured on
 * `rows` and rounded to two significant figures. NaN for anything unusable (missing, zero, too little data).
 */
export function measureSize(rows: readonly TransformRow[], spec: SizeSpec | undefined, source: PriceSource): number {
  if (typeof spec === 'number') return spec > 0 && Number.isFinite(spec) ? spec : NaN;
  if (!spec || typeof spec !== 'object') return NaN;
  let v = NaN;
  if ('atr' in spec) {
    const m = isNum(spec.multiplier) && spec.multiplier > 0 ? spec.multiplier : 1;
    if (isNum(spec.atr) && spec.atr >= 1) v = atrAtLastCompleted(rows, spec.atr) * m;
  } else if ('percent' in spec && isNum(spec.percent) && spec.percent > 0) {
    v = (referencePrice(rows, source) * spec.percent) / 100;
  }
  if (!(Number.isFinite(v) && v > 0)) return NaN;
  const r = sig2(v);
  return r > 0 ? r : NaN;
}

/** `measureSize`, or `fallback(rows)` when the spec is unusable (and 1 when even that is not a positive number). */
export function resolveSize(
  rows: readonly TransformRow[], spec: SizeSpec | undefined, source: PriceSource, fallback: (rows: readonly TransformRow[]) => number,
): number {
  const m = measureSize(rows, spec, source);
  if (m === m) return m;
  const f = fallback(rows);
  return Number.isFinite(f) && f > 0 ? f : 1;
}

/** The host's default for renko: ATR(14) at the last completed bar, else the automatic box size. */
export function defaultBrick(rows: readonly TransformRow[], source: PriceSource): number {
  return resolveSize(rows, { atr: 14 }, source, autoBoxSize);
}

/**
 * Base of the incremental transforms. A core appends to `out` as bars are fed. `mark()` remembers the state before a
 * bar, `rollback()` returns to it, so a bar that is replaced (a live tick on the forming bar) is undone and fed again
 * without touching the bars before it. Output rows are only ever appended, so a rollback is a truncation.
 */
export abstract class Core<Out> {
  out: Out[] = [];
  private markLen = 0;
  abstract step(row: TransformRow, index: number): void;
  protected abstract save(): void;
  protected abstract restore(): void;
  mark(): void { this.markLen = this.out.length; this.save(); }
  rollback(): void { this.out.length = this.markLen; this.restore(); }
}
