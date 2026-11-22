// Renko bricks: standard (traditional) close-based Renko on a fixed grid. Ported from the host's `calcRenko`
// (PROVENANCE.md); the numbers are identical.
//
// - The grid is anchored at the first usable price FLOORED to a brick (a tiny epsilon keeps a price that sits on a
//   grid line in binary floating point, 0.3 / 0.1 = 2.9999..., on that line).
// - When that floor is 0 the first price's own brick [0, brick] is the undrawn start, so no brick is drawn from 0.
// - Continuation: a brick once the price has moved a full brick past the END of the last brick.
// - Reversal: TWO bricks. The first opposite brick starts at the far side of the last brick.
// Both rules are one state, the last brick's [lo, hi]: up while price >= hi + brick, down while price <= lo - brick.

import { makeIncremental, type IncrementalTransform } from './incremental';
import {
  cloneTime, Core, defaultBrick, MAX_ROWS, priceOf, resolveSize, volumeOf,
  type BrickRow, type PriceSource, type SizeSpec, type TransformRow,
} from './shared';

export interface RenkoOptions {
  /** Brick size: a price amount, `{ atr: period }`, `{ percent }`. Default: ATR(14) at the last completed bar. */
  brick?: SizeSpec;
  /** Price a bar contributes. Default 'close'. */
  source?: PriceSource;
}

export interface RenkoResult {
  rows: BrickRow[];
  /** The brick size used. */
  brick: number;
}

class RenkoCore extends Core<BrickRow> {
  private started = false;
  private lo = 0;
  private hi = 0;
  private pend = 0;
  private halt = false;
  private s = { started: false, lo: 0, hi: 0, pend: 0, halt: false };
  constructor(readonly brick: number, private readonly source: PriceSource) { super(); }
  protected save(): void { const s = this.s; s.started = this.started; s.lo = this.lo; s.hi = this.hi; s.pend = this.pend; s.halt = this.halt; }
  protected restore(): void { const s = this.s; this.started = s.started; this.lo = s.lo; this.hi = s.hi; this.pend = s.pend; this.halt = s.halt; }

  step(row: TransformRow, index: number): void {
    if (this.halt) return;
    const p = priceOf(row, this.source);
    if (p !== p) return;
    const b = this.brick;
    if (!this.started) {
      const anchor = Math.floor(p / b + 1e-9) * b;
      if (!Number.isFinite(anchor)) { this.halt = true; return; }
      this.lo = anchor;
      this.hi = anchor;
      if (anchor === 0 && p > 0) this.hi = b;
      this.started = true;
    }
    this.pend += volumeOf(row);
    let { lo, hi } = this;
    // A brick smaller than the step the price can represent would never advance either bound.
    if (!(hi + b > hi) || !(lo - b < lo)) { this.halt = true; return; }
    while (p >= hi + b) {
      if (this.out.length >= MAX_ROWS || !(hi + b > hi)) { this.halt = true; break; }
      this.out.push({ time: cloneTime(row.time), open: hi, high: hi + b, low: hi, close: hi + b, volume: this.pend, sourceIndex: index });
      this.pend = 0;
      lo = hi;
      hi += b;
    }
    while (!this.halt && p <= lo - b) {
      if (this.out.length >= MAX_ROWS || !(lo - b < lo)) { this.halt = true; break; }
      this.out.push({ time: cloneTime(row.time), open: lo, high: lo, low: lo - b, close: lo - b, volume: this.pend, sourceIndex: index });
      this.pend = 0;
      hi = lo;
      lo -= b;
    }
    this.lo = lo;
    this.hi = hi;
  }
}

/** Renko bricks of `rows` (ascending times). Never throws; a brick larger than every move gives no rows. */
export function renko(rows: readonly TransformRow[], options: RenkoOptions = {}): RenkoResult {
  const source = options.source ?? 'close';
  const brick = options.brick === undefined ? defaultBrick(rows, source) : resolveSize(rows, options.brick, source, r => defaultBrick(r, source));
  const core = new RenkoCore(brick, source);
  for (let i = 0; i < rows.length; i++) core.step(rows[i], i);
  return { rows: core.out, brick };
}

/**
 * Renko that takes bars one at a time. The brick size is measured once on `rows` (the history) and then fixed, so a
 * live tick never re-bricks the past. `update(bar)` feeds a new bar or replaces the last one and returns what changed
 * at the end; the result always equals `renko(allBarsSoFar, { brick: size })`.
 */
export function createRenko(rows: readonly TransformRow[], options: RenkoOptions = {}): IncrementalTransform<BrickRow> {
  const source = options.source ?? 'close';
  const brick = options.brick === undefined ? defaultBrick(rows, source) : resolveSize(rows, options.brick, source, r => defaultBrick(r, source));
  return makeIncremental(new RenkoCore(brick, source), brick, rows);
}
