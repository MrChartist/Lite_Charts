// N-line break (default three), close-only (Nison). A new line forms on a new extreme in the current direction, or when
// the close breaks the body extreme of the last N lines the other way.
//
// - Continuation line opens at the last line's close.
// - Reversal line opens at the last line's OPEN (the bottom of the last white line, the top of the last black line),
//   so it never covers the line it reverses. 100>105, 105>110, 110>115, then a close of 99 draws 110>99.
// Ported from the host's `computeLineBreak`; the window scan no longer allocates per bar.

import { makeIncremental, type IncrementalTransform } from './incremental';
import { cloneTime, Core, MAX_ROWS, priceOf, volumeOf, type BrickRow, type PriceSource, type TransformRow } from './shared';

export interface LineBreakOptions {
  /** Lines that must be broken to reverse. Default 3; a whole number from 1 to 100. */
  lines?: number;
  /** Price a bar contributes. Default 'close'. */
  source?: PriceSource;
}

export interface LineBreakResult {
  rows: BrickRow[];
  /** The number of lines used. */
  lines: number;
}

function clampLines(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 3;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

class BreakCore extends Core<BrickRow> {
  private have = false;
  private prev = 0;
  private pend = 0;
  private s = { have: false, prev: 0, pend: 0 };
  constructor(readonly lines: number, private readonly source: PriceSource) { super(); }
  protected save(): void { const s = this.s; s.have = this.have; s.prev = this.prev; s.pend = this.pend; }
  protected restore(): void { const s = this.s; this.have = s.have; this.prev = s.prev; this.pend = s.pend; }

  private add(row: TransformRow, index: number, open: number, close: number): void {
    if (this.out.length >= MAX_ROWS) return;
    this.out.push({
      time: cloneTime(row.time), open, close, high: Math.max(open, close), low: Math.min(open, close),
      volume: this.pend, sourceIndex: index,
    });
    this.pend = 0;
  }

  step(row: TransformRow, index: number): void {
    const p = priceOf(row, this.source);
    if (p !== p) return;
    this.pend += volumeOf(row);
    if (!this.have) { this.prev = p; this.have = true; return; }
    const out = this.out;
    if (out.length === 0) { this.add(row, index, this.prev, p); return; }
    const last = out[out.length - 1];
    const from = Math.max(0, out.length - this.lines);
    if (last.close >= last.open) {
      if (p > last.close) { this.add(row, index, last.close, p); return; }
      let floor = Infinity;
      for (let k = from; k < out.length; k++) { const l = out[k].low; if (l < floor) floor = l; }
      if (p < floor) this.add(row, index, last.open, p);
    } else {
      if (p < last.close) { this.add(row, index, last.close, p); return; }
      let ceil = -Infinity;
      for (let k = from; k < out.length; k++) { const h = out[k].high; if (h > ceil) ceil = h; }
      if (p > ceil) this.add(row, index, last.open, p);
    }
  }
}

export function lineBreak(rows: readonly TransformRow[], options: LineBreakOptions = {}): LineBreakResult {
  const lines = clampLines(options.lines);
  const core = new BreakCore(lines, options.source ?? 'close');
  for (let i = 0; i < rows.length; i++) core.step(rows[i], i);
  return { rows: core.out, lines };
}

/** Line break that takes bars one at a time (see `createRenko`); `size` is the number of lines. */
export function createLineBreak(rows: readonly TransformRow[], options: LineBreakOptions = {}): IncrementalTransform<BrickRow> {
  const lines = clampLines(options.lines);
  return makeIncremental(new BreakCore(lines, options.source ?? 'close'), lines, rows);
}
