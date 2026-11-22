// Range bars: every bar spans exactly `range` from the previous bar's close, close-only. Unlike Renko the bar edges
// float with wherever the previous bar ended (no fixed price grid). Ported from the host's `computeRangeBars`.

import { makeIncremental, type IncrementalTransform } from './incremental';
import {
  autoBoxSize, cloneTime, Core, MAX_ROWS, priceOf, resolveSize, volumeOf,
  type BrickRow, type PriceSource, type SizeSpec, type TransformRow,
} from './shared';

export interface RangeBarsOptions {
  /** Range of every bar: a price amount, `{ atr: period }`, `{ percent }`. Default: about 60 ranges across the data. */
  range?: SizeSpec;
  /** Price a bar contributes. Default 'close'. */
  source?: PriceSource;
}

export interface RangeBarsResult {
  rows: BrickRow[];
  /** The range used. */
  range: number;
}

class RangeCore extends Core<BrickRow> {
  private started = false;
  private open = 0;
  private pend = 0;
  private halt = false;
  private s = { started: false, open: 0, pend: 0, halt: false };
  constructor(readonly range: number, private readonly source: PriceSource) { super(); }
  protected save(): void { const s = this.s; s.started = this.started; s.open = this.open; s.pend = this.pend; s.halt = this.halt; }
  protected restore(): void { const s = this.s; this.started = s.started; this.open = s.open; this.pend = s.pend; this.halt = s.halt; }

  step(row: TransformRow, index: number): void {
    if (this.halt) return;
    const p = priceOf(row, this.source);
    if (p !== p) return;
    const r = this.range;
    if (!this.started) { this.open = p; this.started = true; }
    this.pend += volumeOf(row);
    let open = this.open;
    while (p - open >= r) {
      const close = open + r;
      if (this.out.length >= MAX_ROWS || !(close > open)) { this.halt = true; break; }
      this.out.push({ time: cloneTime(row.time), open, high: close, low: open, close, volume: this.pend, sourceIndex: index });
      this.pend = 0;
      open = close;
    }
    while (!this.halt && open - p >= r) {
      const close = open - r;
      if (this.out.length >= MAX_ROWS || !(close < open)) { this.halt = true; break; }
      this.out.push({ time: cloneTime(row.time), open, high: open, low: close, close, volume: this.pend, sourceIndex: index });
      this.pend = 0;
      open = close;
    }
    this.open = open;
  }
}

export function rangeBars(rows: readonly TransformRow[], options: RangeBarsOptions = {}): RangeBarsResult {
  const source = options.source ?? 'close';
  const range = resolveSize(rows, options.range, source, autoBoxSize);
  const core = new RangeCore(range, source);
  for (let i = 0; i < rows.length; i++) core.step(rows[i], i);
  return { rows: core.out, range };
}

/** Range bars that take bars one at a time (see `createRenko`); the range is measured once on `rows` and then fixed. */
export function createRangeBars(rows: readonly TransformRow[], options: RangeBarsOptions = {}): IncrementalTransform<BrickRow> {
  const source = options.source ?? 'close';
  const range = resolveSize(rows, options.range, source, autoBoxSize);
  return makeIncremental(new RangeCore(range, source), range, rows);
}
