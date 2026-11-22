// The time axis of the brick types (Renko, line break, Kagi, point and figure, range bars). Bricks are rows in order,
// dated by the source bar that made them, so two neighbouring bricks can be a minute or ten years apart. The core puts
// the chart in ordinal mode for a series whose definition carries `ordinal` (one slot per row, true times kept) and
// asks `tickText` for every label; this file is that rule, so only users of brick types pay for it.
//
// The rule (ported from the host engine's `irregularTickText`, PROVENANCE.md): ticks still sit only on bricks, on the
// calendar boundaries crossed from one brick to the next, with the normal cadence, hierarchy and layout passes. A YEAR
// label stays the bare year only when its brick is in January, otherwise it names the month too ("Aug 2020"); a MONTH
// label stays the bare month only in the month's first 7 days, otherwise it names the day ("17 Mar"). Session dates,
// clock times and day numbers already name their own bar and are unchanged. The longer text needs more room, so the
// layout keeps fewer labels: the axis is sparser and every label it keeps says where its brick really is.

import type { TimeTextOptions } from '../core/format';
import { formatDayMonth, formatMonth } from '../core/format';
import type { OrdinalAxis, SeriesDefinition } from '../series/definition';
import type { TransformDelta } from './incremental';

/** The first days of a month that still count as opening it (room for a weekend or holiday start). */
export const BRICK_MONTH_OPEN_DAYS = 7;

/**
 * Label text on a brick axis. `level`: 1 clock time or day number, 2 session date, 3 month, 4 year; `text` is what a
 * calendar axis prints for that boundary; `date` the brick's date in the chart's zone.
 */
export function brickTickText(level: 1 | 2 | 3 | 4, text: string, date: { year: number; month: number; day: number }, opts: TimeTextOptions = {}): string {
  if (level === 4 && date.month !== 1) return `${formatMonth(date.month)} ${date.year}`;
  if (level === 3 && text === formatMonth(date.month) && date.day > BRICK_MONTH_OPEN_DAYS) return formatDayMonth(date.month, date.day, opts.dateOrder);
  return text;
}

/** The ordinal axis the brick types use. */
export const BRICK_AXIS: OrdinalAxis = { tickText: brickTickText };

const made = new Map<SeriesDefinition<any, any>, SeriesDefinition<any, any>>();

/**
 * The same series definition with an ordinal (brick) time axis: a chart holding a series of it places rows by row
 * order and labels the axis with `brickTickText`. One object per definition (cached), so `===` comparisons hold.
 * `applyChartType` uses it for the brick types; use it yourself when you feed `renko()` rows to `addSeries`.
 */
export function ordinalSeries<D extends SeriesDefinition<any, any>>(definition: D): D {
  if (definition.ordinal) return definition;
  let d = made.get(definition);
  if (!d) { d = { ...definition, ordinal: BRICK_AXIS }; made.set(definition, d); }
  return d as D;
}

/** What `applyDelta` needs of a series (a `SeriesApi`). */
export interface DeltaTarget {
  update(row: never, options?: { append?: boolean }): void;
  pop(count?: number): void;
}

/**
 * Apply one `update` of an incremental transform (`createRenko`, `createLineBreak`, `createRangeBars`) to a series on
 * an ordinal axis: the rows it rolled back are popped, the new ones appended. O(changed rows). `map` turns a brick
 * into that series' row, e.g. `b => ({ time: b.time, value: b.volume })` for a volume histogram fed the same deltas.
 */
export function applyDelta<Out extends { time: unknown }>(series: DeltaTarget, delta: TransformDelta<Out>, map?: (row: Out) => object): void {
  if (delta.removed > 0) series.pop(delta.removed);
  for (const r of delta.rows) series.update((map ? map(r) : r) as never, { append: true });
}
