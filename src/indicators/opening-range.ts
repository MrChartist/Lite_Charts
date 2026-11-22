// Opening range.
//
//   openingRange(rows, { minutes = 15, open = 555, zone = 'UTC' }?) -> { high, low }
//
// The high and low of each session's first `minutes` minutes after the exchange open (`open` is minutes after local
// midnight in the IANA `zone`: 555 is 09:15, the Indian cash session; 570 is 09:30, a US one). A session is a calendar day in
// the zone. The lines appear from the bar that completes the range (its start plus one bar's length reaches open + minutes) to
// the end of that session; there is no value on the bars still inside the range, on daily or higher rows (rows are intraday
// when two neighbours share a day), and, honestly, in two cases: when the bars are longer than the range (the first bar would
// span more than the window), and for a session whose first bar does not start at the open (a narrower window would be shown
// under the full window's name). The bar length is the most common gap between bars of one session. `minutes` is 1 to 375.
// Needs candlestick rows with numeric (instant) times.

import { rawCol } from './cols';
import { daysOf, isIntraday, secondsOf } from './period';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';
import { safeZone } from './time-util';
import { zoneMinuteOfDay } from '../core/zone';

export interface OpeningRangeOptions {
  minutes?: number;
  /** Session open, minutes after local midnight in `zone`. Default 555 (09:15). */
  open?: number;
  zone?: string;
}

export interface OpeningRangeResult {
  high: IndicatorPoint[];
  low: IndicatorPoint[];
}

export function openingRange(rows: readonly IndicatorRow[], options: OpeningRangeOptions = {}): OpeningRangeResult {
  const n = rows.length;
  const high = nanArray(n), low = nanArray(n);
  const span = Number.isFinite(options.minutes) ? Math.min(375, Math.max(1, Math.round(options.minutes as number))) : 15;
  const open = Number.isFinite(options.open) ? Math.round(options.open as number) : 555;
  const zone = safeZone(options.zone ?? 'UTC');
  const secs = secondsOf(rows), days = daysOf(rows, zone, secs);
  const H = rawCol(rows, r => r.high as number), L = rawCol(rows, r => r.low as number);
  if (isIntraday(days)) {
    const counts = new Map<number, number>();
    for (let i = 1; i < n; i++) {
      if (!Number.isFinite(secs[i - 1]) || !Number.isFinite(secs[i]) || !Number.isFinite(days[i - 1]) || days[i - 1] !== days[i]) continue;
      const g = Math.round((secs[i] - secs[i - 1]) / 60);
      if (g > 0) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    let bar = 1, best = -1;
    for (const [g, c] of counts) if (c > best || (c === best && g < bar)) { best = c; bar = g; }
    if (bar <= span) {
      const end = open + span;
      let key = NaN, hi = -Infinity, lo = Infinity, done = false, valid = false;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(secs[i])) continue;
        const m = zoneMinuteOfDay(zone, secs[i] * 1000);
        if (days[i] !== key) { key = days[i]; hi = -Infinity; lo = Infinity; done = false; valid = m === open; }
        if (!valid) continue;
        if (!done && m < end) {
          if (Number.isFinite(H[i])) hi = Math.max(hi, H[i]);
          if (Number.isFinite(L[i])) lo = Math.min(lo, L[i]);
          if (m + bar >= end) done = true;
        } else done = true;
        if (done && Number.isFinite(hi) && Number.isFinite(lo)) { high[i] = hi; low[i] = lo; }
      }
    }
  }
  return { high: points(rows, high, null), low: points(rows, low, null) };
}
