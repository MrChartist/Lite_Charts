// Calendar helpers for the two indicators that group bars by day, week or month (vwap, aggregate).
// A numeric time is an instant, read in the given IANA zone; a 'YYYY-MM-DD' or { year, month, day } time is a
// business day and is read on the UTC calendar, as everywhere else in the package.

import type { Time } from '../core/time';
import { timeToSeconds } from '../core/time';
import { civilKeyFromDays, isValidTimeZone, weekKeyOfDay, zoneDayNumber } from '../core/zone';

/** Seconds of a time, or NaN when it cannot be read (never throws). */
export function safeSeconds(time: Time): number {
  try {
    return timeToSeconds(time);
  } catch {
    return NaN;
  }
}

/** Whole days since 1970-01-01 of the calendar day this bar falls on. */
export function dayNumber(time: Time, seconds: number, zone: string): number {
  return typeof time === 'number' ? zoneDayNumber(zone, seconds * 1000) : Math.floor(seconds / 86_400);
}

export type Bucket = 'day' | 'week' | 'month';

/** A number that is equal for two bars exactly when they are in the same bucket. */
export function bucketKey(bucket: Bucket, day: number): number {
  if (bucket === 'day') return day;
  if (bucket === 'week') return weekKeyOfDay(day);
  return Math.floor(civilKeyFromDays(day) / 100);
}

/** The zone if this runtime knows it, else 'UTC' (a bad zone name must not throw). */
export function safeZone(zone: string): string {
  return isValidTimeZone(zone) ? zone : 'UTC';
}
