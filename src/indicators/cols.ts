// Column readers for the study files: the two input rules of the host kernel.
//
//  - A "clean" column (`hlc`, `closeCol`, shared.ts `column`): a bar whose own value is not a finite number gets a
//    `{ time }` row and the series carries on from the last finite value.
//  - A "raw" column (`rawCol`): a bad value stays NaN and the study treats it as a gap (a window holding it has no value,
//    a recursive average starts again). Which rule a study follows is the rule of the kernel function it was ported from.

import { anyBad, column, isNum } from './shared';
import type { IndicatorRow, PriceSource } from './shared';
import { pick } from './shared';

export interface Hlc { h: number[]; l: number[]; c: number[]; bad: boolean[] | null }

/** High, low and close as clean columns, and the bars where any of them is bad. */
export function hlc(rows: readonly IndicatorRow[]): Hlc {
  const h = column(rows, r => r.high as number);
  const l = column(rows, r => r.low as number);
  const c = column(rows, r => r.close as number);
  return { h: h.x, l: l.x, c: c.x, bad: anyBad([h, l, c], rows.length) };
}

/** High and low as clean columns (the studies that read no close), and the bars where either is bad. */
export function hl(rows: readonly IndicatorRow[]) {
  const h = column(rows, r => r.high as number);
  const l = column(rows, r => r.low as number);
  return { h: h.x, l: l.x, bad: anyBad([h, l], rows.length) };
}

/** The chosen price as a clean column. */
export function closeCol(rows: readonly IndicatorRow[], source?: PriceSource) {
  return column(rows, r => pick(r, source));
}

/** Volume the way the kernel cleans it: a missing, negative or non-numeric volume counts as 0 (the bar is not bad). */
export function volCol(rows: readonly IndicatorRow[]): number[] {
  return rows.map(r => (r && isNum(r.volume) && r.volume >= 0 ? r.volume : 0));
}

/** A raw column: the value, or NaN where it is not a finite number. */
export function rawCol(rows: readonly IndicatorRow[], read: (r: IndicatorRow) => number): number[] {
  return rows.map(r => {
    if (!r) return NaN;
    const v = read(r);
    return isNum(v) ? v : NaN;
  });
}

/** The chosen price as a raw column. */
export const rawPrice = (rows: readonly IndicatorRow[], source?: PriceSource): number[] => rawCol(rows, r => pick(r, source));
