// Anchored VWAP.
//
//   anchoredVwap(rows, { from, source = 'hlc3', multipliers = [1, 2, 3] }?)
//     -> { vwap, upper1, lower1, upper2, lower2, upper3, lower3 }
//
// One continuous volume-weighted average price that starts on the first bar whose time is at or after `from` and runs to
// the last bar (no value before it), with bands vwap +/- k * the volume-weighted deviation (see `vwapBands`). `from` is any
// time the chart accepts (UNIX seconds, 'YYYY-MM-DD', { year, month, day }); a missing or unreadable `from`, or one after
// the last bar, gives no values. A bar with no usable price or volume adds nothing (and has no value). First value on the
// anchor bar when it has volume. Needs candlestick rows (high, low, close, volume).

import type { Time } from '../core/time';
import { secondsOf } from './period';
import { isNum } from './shared';
import type { IndicatorRow } from './shared';
import { safeSeconds } from './time-util';
import { accumulator, bandsResult, multipliers, newBands, priceOf } from './vwap-acc';
import type { VwapBandsResult, VwapPrice } from './vwap-acc';

export interface AnchoredVwapOptions {
  /** The anchor: the first bar at or after this time starts the line. */
  from?: Time;
  source?: VwapPrice;
  multipliers?: number[];
}

export function anchoredVwap(rows: readonly IndicatorRow[], options: AnchoredVwapOptions = {}): VwapBandsResult {
  const n = rows.length;
  const out = newBands(n);
  const from = options.from === undefined ? NaN : safeSeconds(options.from);
  const secs = secondsOf(rows);
  let start = -1;
  if (Number.isFinite(from)) for (let i = 0; i < n; i++) if (secs[i] >= from) { start = i; break; }
  if (start >= 0) {
    const source = options.source ?? 'hlc3';
    const mults = multipliers(options.multipliers);
    const acc = accumulator();
    for (let i = start; i < n; i++) {
      const price = priceOf(rows[i], source), vol = rows[i].volume;
      if (!isNum(price) || !isNum(vol)) continue;
      acc.add(price, vol);
      acc.read(out, i, mults);
    }
  }
  return bandsResult(rows, out);
}
