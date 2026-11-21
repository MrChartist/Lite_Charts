// The compressed form of a dense run of bars: one entry per device-pixel column, holding the highest and lowest value
// of the rows that fall in it and the first and last value. Drawing a zoomed-out 100k-bar chart then costs one
// rectangle (candles, bars) or four path points (lines) per pixel column instead of per bar. Pure.

/** How to read a row. `first` / `last` default to `low` / `high` readers when omitted. */
export interface ColumnAccess<R> {
  high(row: R): number;
  low(row: R): number;
  /** Value of the column's first row (open of a candle, value of a line). */
  first?(row: R): number;
  /** Value of the column's last row (close of a candle, value of a line). */
  last?(row: R): number;
}

/** Columns in left-to-right order; arrays are valid in [0, count). */
export interface Columns {
  count: number;
  /** Device-pixel column (integer x of its left edge). */
  x: Float64Array;
  high: Float64Array;
  low: Float64Array;
  first: Float64Array;
  last: Float64Array;
  /** Number of rows folded into each column. */
  rows: Int32Array;
}

export function createColumns(capacity = 256): Columns {
  return {
    count: 0, x: new Float64Array(capacity), high: new Float64Array(capacity), low: new Float64Array(capacity),
    first: new Float64Array(capacity), last: new Float64Array(capacity), rows: new Int32Array(capacity),
  };
}

function ensure(c: Columns, n: number): void {
  if (n <= c.x.length) return;
  let cap = c.x.length || 16;
  while (cap < n) cap *= 2;
  const grow = <T extends Float64Array | Int32Array>(a: T, make: (n: number) => T): T => { const b = make(cap); b.set(a); return b; };
  c.x = grow(c.x, n2 => new Float64Array(n2));
  c.high = grow(c.high, n2 => new Float64Array(n2));
  c.low = grow(c.low, n2 => new Float64Array(n2));
  c.first = grow(c.first, n2 => new Float64Array(n2));
  c.last = grow(c.last, n2 => new Float64Array(n2));
  c.rows = grow(c.rows, n2 => new Int32Array(n2));
}

const shared = createColumns();

/**
 * Fold rows `from..to` (null rows skipped; rows whose high or low is not finite skipped) into device-pixel columns,
 * where `x(i)` is row i's centre in device px. Writes into `out` (default: one shared buffer, valid until the next
 * call that uses it) and returns it. No allocation once the buffer is large enough.
 */
export function decimateColumns<R>(
  rows: readonly (R | null)[], from: number, to: number, x: (i: number) => number, acc: ColumnAccess<R>, out: Columns = shared,
): Columns {
  ensure(out, Math.max(0, to - from + 1));
  let n = 0;
  let cur = Number.NaN;
  const first = acc.first ?? acc.low;
  const last = acc.last ?? acc.high;
  for (let i = from; i <= to; i++) {
    const r = rows[i];
    if (!r) continue;
    const hi = acc.high(r);
    const lo = acc.low(r);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;
    const col = Math.floor(x(i));
    if (col !== cur) {
      cur = col;
      out.x[n] = col;
      out.high[n] = hi;
      out.low[n] = lo;
      out.first[n] = first(r);
      out.last[n] = last(r);
      out.rows[n] = 1;
      n++;
    } else {
      const k = n - 1;
      if (hi > out.high[k]) out.high[k] = hi;
      if (lo < out.low[k]) out.low[k] = lo;
      out.last[k] = last(r);
      out.rows[k]++;
    }
  }
  out.count = n;
  return out;
}
