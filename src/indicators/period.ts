// Calendar periods for the studies that restart or step by day, week, month or year (pivots, VWAP bands, relative volume).
// A numeric time is an instant read in an IANA zone; a 'YYYY-MM-DD' or { year, month, day } time is a business day read
// on the UTC calendar. A bar whose time cannot be read has no day (NaN) and takes no part.

import type { Time } from '../core/time';
import { civilKeyFromDays, weekKeyOfDay } from '../core/zone';
import { dayNumber, safeSeconds } from './time-util';
import type { IndicatorRow } from './shared';

export type Anchor = 'day' | 'week' | 'month' | 'year';
export const ANCHORS: Anchor[] = ['day', 'week', 'month', 'year'];

/** Seconds of each row's time (NaN where unreadable). */
export const secondsOf = (rows: readonly IndicatorRow[]): number[] => rows.map(r => (r ? safeSeconds(r.time) : NaN));

/** Day number of each row in `zone` (NaN where the time cannot be read). */
export function daysOf(rows: readonly IndicatorRow[], zone: string, secs: number[] = secondsOf(rows)): number[] {
  return rows.map((r, i) => (Number.isFinite(secs[i]) ? dayNumber(r.time as Time, secs[i], zone) : NaN));
}

/** A number equal for two days exactly when they are in the same period. */
export function periodKey(anchor: Anchor, day: number): number {
  if (!Number.isFinite(day)) return NaN;
  switch (anchor) {
    case 'day': return day;
    case 'week': return weekKeyOfDay(day);
    case 'month': return Math.floor(civilKeyFromDays(day) / 100);
    default: return Math.floor(civilKeyFromDays(day) / 10_000);
  }
}

/** True when two neighbouring readable bars share a day. A single bar is not intraday (it has no spacing to read). */
export function isIntraday(days: readonly number[]): boolean {
  let prev = NaN;
  for (const d of days) {
    if (!Number.isFinite(d)) continue;
    if (Number.isFinite(prev) && d === prev) return true;
    prev = d;
  }
  return false;
}

/**
 * The period one size up from a bar: intraday bars take the day, daily bars the week, weekly bars the month, monthly
 * bars the year (daily / weekly / monthly by the median gap of the newest 64 bars: up to 3.5 days, up to 12 days).
 */
export function autoAnchor(secs: readonly number[], days: readonly number[]): Anchor {
  if (isIntraday(days)) return 'day';
  const gaps: number[] = [];
  let next = NaN;
  for (let i = secs.length - 1; i >= 0 && gaps.length < 64; i--) {
    const t = secs[i];
    if (!Number.isFinite(t)) continue;
    if (Number.isFinite(next)) gaps.push((next - t) / 86_400);
    next = t;
  }
  if (!gaps.length) return 'week';
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor((gaps.length - 1) / 2)];
  return median <= 3.5 ? 'week' : median <= 12 ? 'month' : 'year';
}

export interface Hlc3 { high: number; low: number; close: number }

/** High, low and last close of the period that ends at bar `end`, walking back while bars share its key. */
function periodEnding(keys: readonly number[], hi: readonly number[], lo: readonly number[], cl: readonly number[], end: number): Hlc3 | null {
  const key = keys[end];
  let high = -Infinity, low = Infinity, close: number | null = null;
  for (let i = end; i >= 0 && Number.isFinite(keys[i]) && keys[i] === key; i--) {
    if (Number.isFinite(hi[i])) high = Math.max(high, hi[i]);
    if (Number.isFinite(lo[i])) low = Math.min(low, lo[i]);
    if (close === null && Number.isFinite(cl[i])) close = cl[i];
  }
  return close !== null && Number.isFinite(high) && Number.isFinite(low) ? { high, low, close } : null;
}

/**
 * Per bar: `map` of the high, low and close of the last completed period before the bar's own (null before the first
 * completed period). Bars of one period share one result. Causal: appending bars never changes an earlier value.
 */
export function stepped<T>(
  keys: readonly number[], hi: readonly number[], lo: readonly number[], cl: readonly number[], map: (h: Hlc3) => T,
): (T | null)[] {
  const values: (T | null)[] = new Array(keys.length).fill(null);
  let lastFinite = -1, lastKey = NaN, prevEnd = -1, memoEnd = -2;
  let memo: T | null = null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!Number.isFinite(key)) continue;
    if (key !== lastKey) prevEnd = lastFinite;
    lastFinite = i;
    lastKey = key;
    if (prevEnd < 0) continue;
    if (prevEnd !== memoEnd) {
      memoEnd = prevEnd;
      const h = periodEnding(keys, hi, lo, cl, prevEnd);
      memo = h ? map(h) : null;
    }
    values[i] = memo;
  }
  return values;
}
