// VWAP with standard-deviation bands that restart each period.
//
//   vwapBands(rows, { anchor = 'day', zone = 'UTC', source = 'hlc3', multipliers = [1, 2, 3] }?)
//     -> { vwap, upper1, lower1, upper2, lower2, upper3, lower3 }
//
// vwap = sum(price * volume) / sum(volume) since the start of the period; the bands are vwap +/- k * the volume-weighted
// deviation sqrt(max(sum(volume * price^2) / sum(volume) - vwap^2, 0)), k = 1, 2, 3 by default. `anchor` restarts it at
// the first bar of each 'day' (the calendar day in the IANA `zone`, e.g. 'Asia/Kolkata'), 'week' (Monday based),
// 'month' or 'year'; 'none' never restarts. First value on the first bar with volume. Numeric times are instants read in
// the zone; 'YYYY-MM-DD' / { year, month, day } times are business days (UTC calendar). A bar with no usable price or
// volume, or a time that cannot be read, has no value and adds nothing; a negative volume is ignored; an unknown zone
// reads as UTC. On daily bars use 'week' / 'month' / 'year' or 'none' (a day restart repeats each bar's own price).
// Needs candlestick rows (high, low, close, volume).

import { daysOf, periodKey, secondsOf } from './period';
import type { Anchor } from './period';
import { isNum } from './shared';
import type { IndicatorRow } from './shared';
import { safeZone } from './time-util';
import { accumulator, bandsResult, multipliers, newBands, priceOf } from './vwap-acc';
import type { VwapBandsResult, VwapPrice } from './vwap-acc';

export interface VwapBandsOptions {
  anchor?: Anchor | 'none';
  zone?: string;
  source?: VwapPrice;
  /** Three band widths in deviations. Default [1, 2, 3]. */
  multipliers?: number[];
}

export type { VwapBandsResult };

export function vwapBands(rows: readonly IndicatorRow[], options: VwapBandsOptions = {}): VwapBandsResult {
  const n = rows.length;
  const anchor = options.anchor ?? 'day';
  const source = options.source ?? 'hlc3';
  const mults = multipliers(options.multipliers);
  const secs = secondsOf(rows);
  const days = daysOf(rows, safeZone(options.zone ?? 'UTC'), secs);
  const out = newBands(n);
  const acc = accumulator();
  let key = NaN;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(days[i])) continue;
    if (anchor !== 'none') {
      const k = periodKey(anchor, days[i]);
      if (k !== key) { acc.reset(); key = k; }
    }
    const price = priceOf(rows[i], source), vol = rows[i].volume;
    if (!isNum(price) || !isNum(vol)) continue;
    acc.add(price, vol);
    acc.read(out, i, mults);
  }
  return bandsResult(rows, out);
}
