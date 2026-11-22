// Unique times for rows that share one: the FALLBACK for a host that keeps a calendar time axis
// (`applyChartType(..., { calendarTime: true })`). The default is an ordinal axis (`ordinalSeries`), which keeps every
// brick on its true source time and needs none of this. A calendar axis wants strictly ascending times, but renko
// bricks and range bars are dated by the source bar and one bar can make several. `spreadTimes` keeps each row on its source time and moves a
// row that would not be after the previous one forward by one step (one second for UNIX seconds, one day for
// business days), in the same kind of time the input used. Pure, O(n); rows that need no change are returned as they are.

import type { Time } from '../core/time';

const DAY = 86_400;

/** Seconds of a time value (UNIX seconds, 'YYYY-MM-DD' or { year, month, day }); NaN when it cannot be read. */
export function timeNum(t: unknown): number {
  if (typeof t === 'number') return Number.isFinite(t) ? t : Number.NaN;
  if (typeof t === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000 : Number.NaN;
  }
  if (t && typeof t === 'object') {
    const { year, month, day } = t as { year: number; month: number; day: number };
    return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) ? Date.UTC(year, month - 1, day) / 1000 : Number.NaN;
  }
  return Number.NaN;
}

function fromSeconds(kind: 'sec' | 'str' | 'obj', sec: number): Time {
  if (kind === 'sec') return sec;
  const d = new Date(sec * 1000);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (kind === 'obj') return { year, month, day };
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Copy of `rows` with strictly ascending times (see the file header). `previous` is the time the first row must come
 * after (the last row already on a chart when appending). Rows whose time cannot be read are dropped.
 */
export function spreadTimes<T extends { time: Time }>(rows: readonly T[], previous?: Time): T[] {
  const out: T[] = [];
  let prev = previous === undefined ? -Infinity : timeNum(previous);
  if (Number.isNaN(prev)) prev = -Infinity;
  let kind: 'sec' | 'str' | 'obj' | null = previous === undefined ? null : typeof previous === 'number' ? 'sec' : typeof previous === 'string' ? 'str' : 'obj';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const t = timeNum(r.time);
    if (Number.isNaN(t)) continue;
    if (kind === null) kind = typeof r.time === 'number' ? 'sec' : typeof r.time === 'string' ? 'str' : 'obj';
    if (t > prev) { out.push(r); prev = t; continue; }
    const step = kind === 'sec' ? 1 : DAY;
    prev += step;
    out.push({ ...r, time: fromSeconds(kind, prev) });
  }
  return out;
}
