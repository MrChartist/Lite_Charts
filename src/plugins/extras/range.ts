// Visible-range maths for the range switcher: pure, no chart and no DOM. A span ends at the last bar and starts at
// local midnight of a calendar date read in the chart's time zone (a business-day chart reads its dates as they are).

import { civilKeyFromDays, daysFromCivil, zoneOffsetMs, zoneDayNumber } from '../../core/zone';

export const RANGE_KEYS = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'] as const;
export type RangeKey = typeof RANGE_KEYS[number];

export interface Civil { year: number; month: number; day: number }

export const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function civilOfDay(dayNum: number): Civil {
  const k = civilKeyFromDays(dayNum);
  return { year: Math.floor(k / 10000), month: Math.floor(k / 100) % 100, day: k % 100 };
}

/** `c` moved by `n` months; a day that does not exist in the target month falls on its last day (31 Mar - 1 month = 29 Feb in a leap year). */
export function addMonths(c: Civil, n: number): Civil {
  const total = c.year * 12 + (c.month - 1) + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { year, month, day: Math.min(c.day, daysInMonth(year, month)) };
}

/**
 * Day number (days since 1970-01-01) of the first calendar day a span shows when it ends on `lastDay`; null for
 * 'All'. 1D is the last day alone, 5D the last five calendar days, the month and year spans reach back to the same
 * date (clamped to month end), YTD starts on 1 January of the last day's year.
 */
export function rangeStartDay(key: RangeKey, lastDay: number): number | null {
  const last = civilOfDay(lastDay);
  const back = (months: number): number => { const c = addMonths(last, -months); return daysFromCivil(c.year, c.month, c.day); };
  switch (key) {
    case '1D': return lastDay;
    case '5D': return lastDay - 4;
    case '1M': return back(1);
    case '3M': return back(3);
    case '6M': return back(6);
    case '1Y': return back(12);
    case '5Y': return back(60);
    case 'YTD': return daysFromCivil(last.year, 1, 1);
    default: return null;
  }
}

/** UNIX seconds of local midnight that starts day `dayNum` in `zone` (the first instant of that day). */
export function zoneMidnightSeconds(zone: string, dayNum: number): number {
  const utc = dayNum * 86_400_000;
  let t = utc - zoneOffsetMs(zone, utc);
  const off = zoneOffsetMs(zone, t);
  if (utc - off !== t) t = utc - off;
  // A zone whose change falls at midnight: step to the first instant that reads this day.
  if (zoneDayNumber(zone, t) < dayNum) t += 3_600_000;
  return Math.round(t / 1000);
}

export interface ResolvedRange {
  /** Seconds of the span's first instant, not before the first bar. */
  from: number;
  to: number;
  /** The data is shorter than the span: `from` was moved up to the first bar. */
  clamped: boolean;
}

/**
 * The span `key` ends at `last` (seconds, the last bar). `businessDay`: the times are dates (UTC midnights), so the
 * zone is ignored. `first` is the first bar, which a span never reaches back past.
 */
export function resolveRange(key: RangeKey, first: number, last: number, zone: string, businessDay: boolean): ResolvedRange {
  if (key === 'All') return { from: first, to: last, clamped: false };
  const z = businessDay ? 'UTC' : zone;
  const lastDay = businessDay ? Math.floor(last / 86_400) : zoneDayNumber(z, last * 1000);
  const startDay = rangeStartDay(key, lastDay) as number;
  const start = businessDay ? startDay * 86_400 : zoneMidnightSeconds(z, startDay);
  return start <= first ? { from: first, to: last, clamped: start < first } : { from: start, to: last, clamped: false };
}

/**
 * The logical range for a span: from half a bar before the first bar in it, to the last bar plus `rightOffset` bars
 * of air. At least `minBars` bars show (a 1D span on daily bars is one bar wide and would zoom to nothing).
 * `fromLogical` may be fractional or negative (a time before the data).
 */
export function logicalRangeFor(fromLogical: number, lastLogical: number, rightOffset: number, minBars = 5): { from: number; to: number } {
  let from = Math.max(0, Math.ceil(fromLogical - 1e-9));
  if (lastLogical - from + 1 < minBars) from = Math.max(0, lastLogical - minBars + 1);
  return { from: from - 0.5, to: lastLogical + rightOffset };
}
