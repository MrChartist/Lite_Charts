// Time values the chart accepts, and their internal form.
//
// Input: UNIX seconds (an instant), a 'YYYY-MM-DD' string or a { year, month, day } object (a business day: a date,
// not an instant). Internally every time is a number of seconds: an instant as given, a business day as the UTC
// midnight of that date. Business days are always read on the UTC calendar, so '2026-03-09' is 9 March for every
// viewer whatever the time zone option says.

import { civilKeyFromDays, daysFromCivil } from './zone';

export interface BusinessDay {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
}

/** UNIX seconds, `YYYY-MM-DD`, or a business-day object. */
export type Time = number | string | BusinessDay;

const DAY_S = 86_400;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isBusinessDayInput(time: Time): boolean {
  return typeof time !== 'number';
}

/** Seconds for a time value. Throws a plain-words error for anything else. */
export function timeToSeconds(time: Time): number {
  if (typeof time === 'number') {
    if (!Number.isFinite(time)) throw new TypeError(`Chartist Lite: time must be a finite number of seconds, got ${String(time)}`);
    return time;
  }
  if (typeof time === 'string') {
    const m = DATE_RE.exec(time);
    if (!m) throw new TypeError(`Chartist Lite: a time string must be YYYY-MM-DD, got "${time}"`);
    return businessDayToSeconds({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
  }
  if (time && typeof time === 'object') return businessDayToSeconds(time);
  throw new TypeError(`Chartist Lite: unsupported time value ${String(time)}`);
}

export function businessDayToSeconds(d: BusinessDay): number {
  const { year, month, day } = d;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new TypeError(`Chartist Lite: invalid business day ${JSON.stringify(d)}`);
  }
  const days = daysFromCivil(year, month, day);
  // 2024-02-31 would roll over into March: a date that does not exist is refused.
  if (civilKeyFromDays(days) !== year * 10_000 + month * 100 + day) {
    throw new TypeError(`Chartist Lite: ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} is not a real date`);
  }
  return days * DAY_S;
}

/** Bar granularity, inferred from the data; decides which calendar boundaries the time axis may label. */
export type TimeKind = 'intraday' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * The bar granularity of a sorted run of times (seconds), from the median gap of up to the last 256 gaps.
 * The median ignores weekends and holidays (a 3-day gap among 1-day gaps) and the odd missing bar.
 */
export function inferTimeKind(times: ArrayLike<number>, count: number): TimeKind {
  if (count < 2) return 'daily';
  const from = Math.max(1, count - 256);
  const gaps: number[] = [];
  for (let i = from; i < count; i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median < DAY_S * 0.9) return 'intraday';
  if (median < DAY_S * 5) return 'daily';
  if (median < DAY_S * 20) return 'weekly';
  if (median < DAY_S * 200) return 'monthly';
  return 'yearly';
}

/** A copy of a time value, so a stored row never shares an object with the caller. */
export function copyTime(time: Time): Time {
  return typeof time === 'object' && time !== null ? { year: time.year, month: time.month, day: time.day } : time;
}
