// Volume-weighted average price.
//
//   vwap(rows, { zone = 'UTC', source = 'hlc3', reset = 'day' }?) -> IndicatorPoint[]
//
// sum(price * volume) / sum(volume), restarting at the first bar of each calendar day in the IANA `zone` (an
// exchange's own zone, e.g. 'Asia/Kolkata' or 'America/New_York'). `reset: 'none'` accumulates over every bar.
// Numeric times are instants read in the zone; 'YYYY-MM-DD' / { year, month, day } times are business days (UTC
// calendar), so on daily bars every bar is its own day and the line repeats the bar's price: use 'none' there.
// A bar with no usable price or volume, or a time that cannot be read, is `{ time }` only and adds nothing; a
// negative volume is ignored; an unknown zone name reads as UTC; a day with no volume yet has no value. Needs candlestick rows (high, low, close, volume).

import { dayNumber, safeSeconds, safeZone } from './time-util';
import { emptyPoint, isNum, pick } from './shared';
import type { IndicatorPoint, IndicatorRow, PriceSource } from './shared';

export interface VwapOptions {
  /** IANA zone that defines "a day". Default 'UTC'. */
  zone?: string;
  /** Price weighted by volume. Default 'hlc3'. */
  source?: PriceSource;
  /** 'day' (default) restarts each calendar day; 'none' never restarts. */
  reset?: 'day' | 'none';
}

export function vwap(rows: readonly IndicatorRow[], options: VwapOptions = {}): IndicatorPoint[] {
  const source = options.source ?? 'hlc3';
  const zone = safeZone(options.zone ?? 'UTC');
  const daily = options.reset !== 'none';
  const out = new Array<IndicatorPoint>(rows.length);
  let pv = 0, v = 0;
  let key = NaN;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const secs = r ? safeSeconds(r.time) : NaN;
    if (!isNum(secs)) { out[i] = emptyPoint(r ? r.time : (undefined as never)); continue; }
    if (daily) {
      const k = dayNumber(r.time, secs, zone);
      if (k !== key) { pv = 0; v = 0; key = k; }
    }
    const price = pick(r, source);
    const vol = r.volume;
    if (!isNum(price) || !isNum(vol)) { out[i] = emptyPoint(r.time); continue; }
    if (vol >= 0) { pv += price * vol; v += vol; }
    out[i] = v > 0 ? { time: r.time, value: pv / v } : emptyPoint(r.time);
  }
  return out;
}
