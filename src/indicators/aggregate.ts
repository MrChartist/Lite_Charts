// Higher timeframes from lower ones.
//
//   aggregate(rows, by, zone = 'UTC') -> { time, open, high, low, close, volume }[]
//     by: { every: n }            every n consecutive bars become one
//         'day' | 'week' | 'month'  one bar per calendar day / Monday-based week / calendar month in the zone
//
// Open of the first bar, highest high, lowest low, close of the last bar, volume summed (a missing volume adds 0).
// The new bar keeps the time of its first bar, exactly as the host does. Rows are sorted by time first; a row with
// a time that cannot be read or a leg that is not a number is skipped. Numeric times are instants read in `zone`;
// 'YYYY-MM-DD' / { year, month, day } times are business days (UTC calendar). Needs candlestick rows.

import type { Time } from '../core/time';
import { dayNumber, bucketKey, safeSeconds, safeZone } from './time-util';
import type { Bucket } from './time-util';
import { isNum } from './shared';
import type { IndicatorRow } from './shared';

export type AggregateBy = { every: number } | Bucket;

export interface AggregatedBar {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function aggregate(rows: readonly IndicatorRow[], by: AggregateBy, zone = 'UTC'): AggregatedBar[] {
  zone = safeZone(zone);
  const keyed: { r: IndicatorRow; s: number; i: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !isNum(r.open) || !isNum(r.high) || !isNum(r.low) || !isNum(r.close)) continue;
    const s = safeSeconds(r.time);
    if (isNum(s)) keyed.push({ r, s, i });
  }
  keyed.sort((a, b) => a.s - b.s || a.i - b.i);
  const every = typeof by === 'object' ? Math.max(1, Math.floor(isNum(by.every) ? by.every : 1)) : 0;
  const out: AggregatedBar[] = [];
  let cur: AggregatedBar | null = null;
  let key = NaN;
  let count = 0;
  for (let i = 0; i < keyed.length; i++) {
    const { r, s } = keyed[i];
    const open = r.open as number, high = r.high as number, low = r.low as number, close = r.close as number;
    const vol = isNum(r.volume) ? r.volume : 0;
    let fresh: boolean;
    if (every) { fresh = !cur || count >= every; if (fresh) count = 0; count++; }
    else {
      const k = bucketKey(by as Bucket, dayNumber(r.time, s, zone));
      fresh = !cur || k !== key;
      key = k;
    }
    if (fresh || !cur) {
      cur = { time: typeof r.time === 'object' ? { ...r.time } : r.time, open, high, low, close, volume: vol };
      out.push(cur);
    } else {
      if (high > cur.high) cur.high = high;
      if (low < cur.low) cur.low = low;
      cur.close = close;
      cur.volume += vol;
    }
  }
  return out;
}
