// The incremental form shared by renko, lineBreak and rangeBars: feed one new bar, or one replacement of the last bar
// (same time: a live tick on the forming bar), and get back only what changed at the end of the output.

import { timeNum } from './time-spread';
import type { Core, TransformRow } from './shared';

/** What one `update` changed: output rows from index `from` onward are now `rows` (everything before is untouched). */
export interface TransformDelta<Out> {
  from: number;
  rows: Out[];
  /** Rows the update took back (the output had `from + removed` rows before): pop them, then append `rows`. */
  removed: number;
}

export interface IncrementalTransform<Out> {
  /** The chosen size (brick, range or lines), fixed when the transform was created. */
  readonly size: number;
  /** All output rows so far (do not modify). */
  readonly rows: readonly Out[];
  /**
   * Feed one bar. A bar with the same time as the previous one REPLACES it (its effect is undone, then the new version
   * is applied); a later time is a new bar; an older time is ignored. Never throws.
   */
  update(row: TransformRow): TransformDelta<Out>;
}

export function makeIncremental<Out>(core: Core<Out>, size: number, history: readonly TransformRow[]): IncrementalTransform<Out> {
  let fed = 0;
  let lastT = Number.NaN;
  const feed = (row: TransformRow): TransformDelta<Out> => {
    const t = row && typeof row === 'object' ? timeNum(row.time) : Number.NaN;
    let replace = false;
    if (Number.isFinite(t) && fed > 0 && Number.isFinite(lastT)) {
      if (t < lastT) return { from: core.out.length, rows: [], removed: 0 };
      replace = t === lastT;
    }
    const before = core.out.length;
    let index: number;
    if (replace) { core.rollback(); index = fed - 1; } else { core.mark(); index = fed; fed++; }
    if (Number.isFinite(t)) lastT = t;
    const from = core.out.length;
    core.step(row, index);
    return { from, rows: core.out.slice(from), removed: before - from };
  };
  // History is fed as it is (a repeated time in it is a bar of its own, as in the batch function).
  for (let i = 0; i < history.length; i++) {
    const row = history[i];
    core.mark();
    core.step(row, i);
    fed++;
    const t = row && typeof row === 'object' ? timeNum(row.time) : Number.NaN;
    if (Number.isFinite(t)) lastT = t;
  }
  return { size, get rows() { return core.out; }, update: feed };
}
