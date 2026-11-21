// Which labels the time axis prints, and where. Pure: `measure` is injected, no canvas, no clock.
//
// Three passes, all in pixels, all on real calendar boundaries read from the bars:
//  1. CADENCE: per calendar axis (time of day, day of month, month, year) keep the finest "rung" whose ticks still
//     have room for their own text. A rung cuts the calendar into periods; a bar is a tick when its period differs
//     from its predecessor's, so a holiday or a weekend moves a tick to the next real bar instead of lying.
//  2. HIERARCHY: a tick's text is decided by the coarsest boundary it crosses: a new year prints the year, a new
//     month the month, a new session the date, anything else the clock or the day number.
//  3. LAYOUT: labels are placed strongest first, measured with the real font; one that would touch a placed
//     neighbour is dropped, one whose bar is inside the plot but whose text would overhang an edge is slid inward.
// Ported and simplified from the host engine's time-axis planner (PROVENANCE.md).

import type { TimeKind } from '../core/time';
import { lowerBoundInt, type CalendarFields } from '../core/time-index';
import { formatClock, formatDayMonth, formatMonth, type TimeTextOptions } from '../core/format';
import { weekKeyOfDay } from '../core/zone';

/** 1 clock / day number, 2 session date, 3 month, 4 year. */
export type TickLevel = 1 | 2 | 3 | 4;

export interface TimeTick {
  /** Logical index of the bar the tick sits on. */
  index: number;
  /** Bar centre, CSS px from the plot's left edge (grid line). */
  x: number;
  /** Text centre: `x`, slid inward when the text would overhang an edge. */
  textX: number;
  text: string;
  level: TickLevel;
  width: number;
}

export interface TimeTickInput {
  cal: CalendarFields;
  /** Slots in the series. */
  count: number;
  /** First and last visible logical index (inclusive, clipped to the data). */
  from: number;
  to: number;
  /** Bar-centre x of logical index i (CSS px). */
  xOf: (i: number) => number;
  barSpacing: number;
  plotW: number;
  kind: TimeKind;
  measure: (text: string, weight: number) => number;
  text?: TimeTextOptions;
  /** Least clear space between two labels. Default 12. */
  minGapPx?: number;
  /** Extra room a rung needs beyond its own text before it is used. Default 26. */
  cadencePadPx?: number;
  /** Clear space between a label and the plot edge. Default 4. */
  edgePadPx?: number;
  /**
   * Optional: the slots that open a day / a month (`TimeIndex.dayStarts` / `monthStarts`). With them the planner
   * visits only those slots for the day, month and year cadences, so 100k bars in view cost a few thousand checks.
   */
  starts?: { day: Int32Array; dayCount: number; month: Int32Array; monthCount: number };
}

type Axis = 'time' | 'day' | 'month' | 'year';
interface Rung { axis: Axis; id: string; key: (f: CalendarFields, j: number) => number }

const ym = (f: CalendarFields, j: number): number => f.year[j] * 12 + f.month[j];
const YEAR_RUNGS: Rung[] = [100, 50, 25, 10, 5, 2, 1].map(step => ({ axis: 'year' as const, id: `y${step}`, key: (f: CalendarFields, j: number) => Math.floor(f.year[j] / step) }));
const MONTH_RUNGS: Rung[] = [
  { axis: 'month', id: 'm6', key: (f, j) => f.year[j] * 2 + Math.floor((f.month[j] - 1) / 6) },
  { axis: 'month', id: 'm3', key: (f, j) => f.year[j] * 4 + Math.floor((f.month[j] - 1) / 3) },
  { axis: 'month', id: 'm2', key: (f, j) => f.year[j] * 6 + Math.floor((f.month[j] - 1) / 2) },
  { axis: 'month', id: 'm1', key: ym },
];
// Never the 30th: it sits next to a month boundary.
const DAY_RUNGS: Rung[] = [
  { axis: 'day', id: 'd15', key: (f, j) => ym(f, j) * 10 + (f.day[j] >= 15 ? 1 : 0) },
  { axis: 'day', id: 'd10', key: (f, j) => ym(f, j) * 10 + (f.day[j] >= 20 ? 2 : f.day[j] >= 10 ? 1 : 0) },
  { axis: 'day', id: 'week', key: (f, j) => weekKeyOfDay(f.dayNum[j]) },
  { axis: 'day', id: 'd5', key: (f, j) => ym(f, j) * 10 + Math.min(5, Math.floor(f.day[j] / 5)) },
  { axis: 'day', id: 'day', key: (f, j) => f.dayNum[j] },
];
const TIME_RUNGS: Rung[] = [360, 180, 120, 60, 30, 15, 10, 5, 2, 1].map(step => ({
  axis: 'time' as const, id: `t${step}`, key: (f: CalendarFields, j: number) => f.dayNum[j] * 1500 + Math.floor(f.minute[j] / step),
}));

function laddersFor(kind: TimeKind): Record<Axis, Rung[]> {
  return {
    time: kind === 'intraday' ? TIME_RUNGS : [],
    day: kind === 'intraday' || kind === 'daily' ? DAY_RUNGS : kind === 'weekly' ? DAY_RUNGS.slice(0, 2) : [],
    month: kind === 'yearly' ? [] : MONTH_RUNGS,
    year: YEAR_RUNGS,
  };
}

const WEIGHT: Record<TickLevel, number> = { 1: 400, 2: 600, 3: 600, 4: 600 };
const MAX_CANDIDATES = 600;

export const tickWeight = (level: TickLevel): number => WEIGHT[level];

/** Is slot j a boundary on `rung`? The series' first bar starts the chart and always is one. */
function isBoundary(f: CalendarFields, rung: Rung, j: number): boolean {
  if (!f.ok[j]) return false;
  if (j === 0) return true;
  return f.ok[j - 1] === 1 && rung.key(f, j) !== rung.key(f, j - 1);
}

export function planTimeTicks(input: TimeTickInput): TimeTick[] {
  const { cal: f, count, plotW, barSpacing, measure, kind } = input;
  if (!(barSpacing > 0) || !(plotW > 0) || !(count > 0)) return [];
  const from = Math.max(0, Math.min(count - 1, Math.floor(input.from)));
  const to = Math.max(from, Math.min(count - 1, Math.floor(input.to)));
  const gap = input.minGapPx ?? 12;
  const pad = input.cadencePadPx ?? 26;
  const edge = input.edgePadPx ?? 4;
  const txt = input.text ?? {};
  const span = (to - from + 1) * barSpacing;

  // 1. cadence: per axis, the finest rung that still fits.
  const ladders = laddersFor(kind);
  const sample: Record<Axis, string> = {
    time: formatClock(20, 45, txt.hours12),
    day: kind === 'intraday' ? formatDayMonth(9, 29, txt.dateOrder) : '29',
    month: formatMonth(9),
    year: '2026',
  };
  const st = input.starts;
  // Visit every slot in [from, to], or only the listed ones; stop early when `visit` returns false.
  const each = (list: Int32Array | null, count: number, visit: (j: number) => boolean): void => {
    if (!list) { for (let j = from; j <= to; j++) if (!visit(j)) return; return; }
    for (let k = lowerBoundInt(list, count, from); k < count && list[k] <= to; k++) if (!visit(list[k])) return;
  };
  const chosen: Rung[] = [];
  let dayRung: Rung | null = null;
  let timeRung = false;
  for (const axis of ['time', 'day', 'month', 'year'] as Axis[]) {
    const level: TickLevel = axis === 'year' || axis === 'month' ? 3 : axis === 'day' && kind === 'intraday' ? 2 : 1;
    const need = measure(sample[axis], WEIGHT[level]) + pad;
    const limit = span / need;
    const list = !st || axis === 'time' ? null : axis === 'day' ? st.day : st.month;
    const listCount = !st ? 0 : axis === 'day' ? st.dayCount : st.monthCount;
    let pick: Rung | null = null;
    for (const rung of ladders[axis]) {
      let n = 0;
      each(list, listCount, j => { if (isBoundary(f, rung, j)) n++; return n <= limit; });
      if (n > 0 && n > limit) break; // finer rungs only get denser
      pick = rung;
    }
    if (pick && axis === 'time') timeRung = true;
    if (!pick) continue;
    chosen.push(pick);
    if (axis === 'day') dayRung = pick;
  }
  if (chosen.length === 0) return [];

  // 2. hierarchy: text and strength of each boundary in view.
  interface Cand { j: number; x: number; text: string; level: TickLevel; w: number; owns: number }
  const cands: Cand[] = [];
  each(st && !timeRung ? st.day : null, st ? st.dayCount : 0, j => {
    if (cands.length >= MAX_CANDIDATES) return false;
    let flagged = false;
    for (const r of chosen) if (isBoundary(f, r, j)) { flagged = true; break; }
    if (!flagged) return true;
    const first = j === 0;
    const yc = first ? kind !== 'intraday' : f.year[j] !== f.year[j - 1];
    const mc = yc || (!first && f.month[j] !== f.month[j - 1]);
    const dc = first || f.dayNum[j] !== f.dayNum[j - 1];
    let text: string;
    let level: TickLevel;
    if (yc) { text = String(f.year[j]); level = 4; }
    else if (mc) { text = kind === 'intraday' && dayRung ? formatDayMonth(f.month[j], f.day[j], txt.dateOrder) : formatMonth(f.month[j]); level = 3; }
    else if (dc && kind === 'intraday' && dayRung && isBoundary(f, dayRung, j)) { text = formatDayMonth(f.month[j], f.day[j], txt.dateOrder); level = 2; }
    else if (kind === 'intraday') { text = formatClock(Math.floor(f.minute[j] / 60), f.minute[j] % 60, txt.hours12); level = 1; }
    else { text = String(f.day[j]); level = 1; }
    cands.push({ j, x: input.xOf(j), text, level, w: measure(text, WEIGHT[level]), owns: 0 });
    return true;
  });
  // Bars each label owns: up to the next label of the same or a higher level. A one-bar stub of yesterday at the
  // left edge must not knock out the label of today's full session.
  const nextAtLeast = [to + 1, to + 1, to + 1, to + 1, to + 1];
  for (let k = cands.length - 1; k >= 0; k--) {
    const c = cands[k];
    let end = to + 1;
    for (let l = c.level; l <= 4; l++) end = Math.min(end, nextAtLeast[l]);
    c.owns = end - c.j;
    for (let l = 1; l <= c.level; l++) nextAtLeast[l] = c.j;
  }

  // 3. layout: strongest first, no overlaps, nothing cut at an edge.
  cands.sort((a, b) => b.level - a.level || b.owns - a.owns || a.j - b.j);
  const placedL: number[] = [];
  const placedR: number[] = [];
  const kept: TimeTick[] = [];
  for (const c of cands) {
    if (!(c.x >= 0 && c.x <= plotW) || c.w > plotW - 2 * edge) continue;
    let shift = 0;
    const left = c.x - c.w / 2;
    const right = c.x + c.w / 2;
    if (left < edge) shift = edge - left;
    else if (right > plotW - edge) shift = plotW - edge - right;
    const l = left + shift;
    const r = right + shift;
    let clash = false;
    for (let k = 0; k < placedL.length; k++) if (l < placedR[k] + gap && r > placedL[k] - gap) { clash = true; break; }
    if (clash) continue;
    placedL.push(l);
    placedR.push(r);
    kept.push({ index: c.j, x: c.x, textX: c.x + shift, text: c.text, level: c.level, width: c.w });
  }
  kept.sort((a, b) => a.index - b.index);
  return kept;
}
