// Calendar spans for range keys (1D 5D 1M 3M 6M YTD 1Y 5Y All): where a span that ends at the last bar starts,
// read in the chart's time zone. Pure. `nD` counts trading days present in the data (sessions, not calendar days);
// W, M, Y and YTD are calendar spans ending at the last bar's local date.

import { civilKeyFromDays, daysFromCivil, zoneDayNumber, zoneOffsetMs } from './zone';

export type SpanUnit = 'D' | 'W' | 'M' | 'Y' | 'YTD' | 'ALL';
export interface Span { unit: SpanUnit; n: number }
/** '1D' | '5D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'All' (any count), or `{ days }` and so on. */
export type SpanInput = string | { days?: number; weeks?: number; months?: number; years?: number };

const DAY_MS = 86_400_000;

export function parseSpan(s: SpanInput): Span | null {
  if (typeof s === 'string') {
    const t = s.trim().toUpperCase();
    if (t === 'YTD' || t === 'ALL') return { unit: t, n: 1 };
    const m = /^(\d{1,4})\s*([DWMY])$/.exec(t);
    return m && +m[1] > 0 ? { unit: m[2] as SpanUnit, n: +m[1] } : null;
  }
  if (!s || typeof s !== 'object') return null;
  for (const [k, unit] of [['days', 'D'], ['weeks', 'W'], ['months', 'M'], ['years', 'Y']] as const) {
    const n = s[k];
    if (typeof n === 'number' && n > 0 && Number.isFinite(n)) return { unit, n: Math.ceil(n) };
  }
  return null;
}

/** UNIX seconds of the first instant of day number `days` in zone `tz` (DST-safe; a change AT midnight skips ahead). */
export function localMidnight(tz: string, days: number): number {
  const local = days * DAY_MS;
  let t = local - zoneOffsetMs(tz, local - zoneOffsetMs(tz, local));
  if (zoneDayNumber(tz, t) < days) t += 3_600_000;
  return Math.round(t / 1000);
}

/** Day number of the first calendar day a span shows when it ends on day `day` ('D' counts calendar days); null for 'ALL'. */
export function spanStartDay(span: Span, day: number): number | null {
  if (span.unit === 'ALL') return null;
  if (span.unit === 'D') return day - (span.n - 1);
  if (span.unit === 'W') return day - 7 * span.n;
  const key = civilKeyFromDays(day);
  const y = Math.floor(key / 10_000), m = Math.floor(key / 100) % 100, d = key % 100;
  if (span.unit === 'YTD') return daysFromCivil(y, 1, 1);
  const mi = y * 12 + (m - 1) - (span.unit === 'M' ? span.n : 12 * span.n);
  const y2 = Math.floor(mi / 12), m2 = mi - y2 * 12 + 1;
  const len = daysFromCivil(m2 === 12 ? y2 + 1 : y2, m2 === 12 ? 1 : m2 + 1, 1) - daysFromCivil(y2, m2, 1);
  return daysFromCivil(y2, m2, Math.min(d, len));
}

/** Start (UNIX seconds) of a calendar span that ends at `lastSec`. 'D' here is calendar days; 'ALL' gives -Infinity. */
export function spanStart(span: Span, lastSec: number, tz: string): number {
  const start = spanStartDay(span, zoneDayNumber(tz, lastSec * 1000));
  return start === null ? -Infinity : localMidnight(tz, start);
}

/**
 * First slot of `times` (ascending UNIX seconds) inside the span ending at the last slot. 'D' counts the distinct
 * local days present in the data (the last n sessions).
 */
export function spanFirstIndex(span: Span, times: ArrayLike<number>, count: number, tz: string): number {
  if (count <= 0 || span.unit === 'ALL') return 0;
  if (span.unit === 'D') {
    let seen = 0, prev = NaN, i = count - 1;
    for (; i >= 0; i--) {
      const dn = zoneDayNumber(tz, times[i] * 1000);
      if (dn !== prev) { if (++seen > span.n) return i + 1; prev = dn; }
    }
    return 0;
  }
  const start = spanStart(span, times[count - 1], tz);
  let lo = 0, hi = count;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (times[mid] < start) lo = mid + 1; else hi = mid; }
  return Math.min(lo, count - 1);
}
