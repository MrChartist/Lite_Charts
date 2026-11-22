// Intervals as text ('1m', '15m', '1h', '4h', '1D', '1W', '1M'), their length, their key labels, and the interval that
// suits a range key. Pure.

import { parseSpan, type Span } from '../core/span';

const UNIT_S: Record<string, number> = { s: 1, m: 60, h: 3600, D: 86_400, W: 604_800, M: 2_629_746 };

/** Canonical text of an interval ('1d' and '1D' are a day, '60' is an hour, '1M' is a month); null when unreadable. */
export function normalizeInterval(text: string): string | null {
  const t = String(text ?? '').trim();
  if (/^\d{1,4}$/.test(t)) {
    const n = +t;
    if (n <= 0) return null;
    return n % 60 === 0 && n < 1440 ? `${n / 60}h` : n === 1440 ? '1D' : `${n}m`;
  }
  const m = /^(\d{1,4})\s*([smhHdDwWM])$/.exec(t);
  if (!m || +m[1] <= 0) return null;
  const u = m[2];
  const unit = u === 'H' ? 'h' : u === 'd' ? 'D' : u === 'w' ? 'W' : u;
  return `${+m[1]}${unit}`;
}

/** Seconds of an interval (a month is 30.44 days); NaN when unreadable. */
export function intervalSeconds(text: string): number {
  const n = normalizeInterval(text);
  if (!n) return NaN;
  return parseInt(n, 10) * UNIT_S[n.slice(-1)];
}

/** The interval typed as digits: minutes ('5' is 5m, '60' is 1h, '240' is 4h, '1440' is 1D). */
export function intervalFromDigits(digits: string): string | null {
  return /^\d{1,4}$/.test(digits) ? normalizeInterval(digits) : null;
}

/** Sort intervals by length. */
export function sortIntervals(list: readonly string[]): string[] {
  return [...list].filter(i => normalizeInterval(i)).sort((a, b) => intervalSeconds(a) - intervalSeconds(b));
}

/** The interval of `available` closest to `wanted` in length (log scale). */
export function nearestInterval(wanted: string, available: readonly string[]): string | null {
  const w = intervalSeconds(wanted);
  let best: string | null = null, bestD = Infinity;
  for (const a of available) {
    const s = intervalSeconds(a);
    if (!(s > 0)) continue;
    const d = Math.abs(Math.log(s / w));
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

/** Calendar seconds a span covers (approximate for months; trading days count as calendar days). */
export function spanSeconds(span: Span, lastSec: number): number {
  switch (span.unit) {
    case 'D': return span.n * 86_400;
    case 'W': return span.n * 604_800;
    case 'M': return span.n * 2_629_746;
    case 'Y': return span.n * 31_556_952;
    case 'YTD': {
      const y = new Date(lastSec * 1000).getUTCFullYear();
      return Math.max(86_400 * 7, lastSec - Date.UTC(y, 0, 1) / 1000);
    }
    default: return Infinity;
  }
}

/** The usual interval for a range key: about 150 to 1500 bars, at the finest interval that stays under the cap. */
export const SPAN_TARGET: Readonly<Record<string, string>> = {
  '1D': '5m', '5D': '15m', '1M': '1h', '3M': '4h', '6M': '1D', YTD: '1D', '1Y': '1D', '5Y': '1W', ALL: '1W',
};

/**
 * The interval of `available` that suits range key `key`: the preferred one when offered, else the nearest. Returns
 * null for an unknown key.
 */
export function intervalForSpan(key: string, available: readonly string[]): string | null {
  const span = parseSpan(key);
  if (!span) return null;
  const k = span.unit === 'YTD' || span.unit === 'ALL' ? span.unit : `${span.n}${span.unit}`;
  const target = SPAN_TARGET[k] ?? (span.unit === 'D' ? '15m' : span.unit === 'W' ? '30m' : span.unit === 'M' ? '4h' : '1D');
  return available.includes(target) ? target : nearestInterval(target, available);
}

/** Bars to ask a feed for so that range key `key` is filled at `interval` (plus a margin for indicator warm-up). */
export function barsForSpan(key: string, interval: string, lastSec: number): number {
  const span = parseSpan(key);
  const s = intervalSeconds(interval);
  if (!span || !(s > 0)) return 500;
  if (span.unit === 'ALL') return 5000;
  // Trading days: a session can be 24 h (crypto), so count full days; then 50% margin and 200 warm-up bars.
  return Math.min(5000, Math.ceil((spanSeconds(span, lastSec) / s) * 1.5) + 200);
}

/** Human words for an interval in a menu: '15 minutes', '4 hours', '1 day'. */
export function intervalWords(text: string, words: { minutes: string; hours: string; days: string; weeks: string; months: string }): string {
  const n = normalizeInterval(text);
  if (!n) return text;
  const v = parseInt(n, 10);
  const u = n.slice(-1);
  const w = u === 'm' ? words.minutes : u === 'h' ? words.hours : u === 'D' ? words.days : u === 'W' ? words.weeks : u === 'M' ? words.months : 's';
  return `${v} ${w}`;
}

/** Live provider intervals ('1d') to widget text ('1D') and back. */
export const toLiveInterval = (i: string): string => (normalizeInterval(i) ?? i).replace(/D$/, 'd');
export const fromLiveInterval = (i: string): string => normalizeInterval(i) ?? i;
