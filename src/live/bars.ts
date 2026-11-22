// Building bars from a stream, pure. Trades fold into the bar of their time bucket; a trade for a newer bucket opens a
// new bar; a trade for an older bucket is dropped (the closed bar from history or backfill stays authoritative);
// duplicate trades (same id, or replayed on resubscribe) count once. Whole bars (an exchange that streams candles)
// replace the bar of their time.

import type { LiveBar, LiveTick } from './providers';

export class BarBuilder {
  /** The forming bar (the newest), or null before any bar. */
  last: LiveBar | null = null;
  private seconds: number;
  private seen = new Set<string | number>();
  private order: (string | number)[] = [];

  constructor(intervalSeconds: number, last: LiveBar | null = null) {
    this.seconds = intervalSeconds;
    this.last = last ? { ...last } : null;
  }

  /** Bucket start of a time. */
  bucket(time: number): number {
    return Math.floor(time / this.seconds) * this.seconds;
  }

  /**
   * Apply one tick. Returns the bar to show (a copy), or null when the tick changed nothing (late, duplicate or bad).
   */
  apply(t: LiveTick): LiveBar | null {
    if (t.kind === 'bar') {
      const b = t.bar;
      if (this.last && b.time < this.last.time) return null;
      this.last = { ...b };
      return { ...b };
    }
    if (!Number.isFinite(t.price) || !Number.isFinite(t.time) || !(t.price > 0)) return null;
    if (t.id !== undefined) {
      if (this.seen.has(t.id)) return null;
      this.seen.add(t.id);
      this.order.push(t.id);
      if (this.order.length > 4000) this.seen.delete(this.order.shift() as string | number);
    }
    const time = this.bucket(t.time);
    // A replayed trade (Coinbase sends the latest trade again as `last_match` on subscribe) inside the bar that history
    // already holds is in that bar's volume already: it may move the close, it adds no volume.
    const size = Number.isFinite(t.size) && t.size > 0 && !(t.replay && this.last && time === this.last.time) ? t.size : 0;
    const cur = this.last;
    if (cur && time < cur.time) return null;
    if (!cur || time > cur.time) {
      this.last = { time, open: t.price, high: t.price, low: t.price, close: t.price, volume: size };
    } else {
      if (t.price > cur.high) cur.high = t.price;
      if (t.price < cur.low) cur.low = t.price;
      cur.close = t.price;
      cur.volume += size;
    }
    return { ...(this.last as LiveBar) };
  }
}

/** Jittered exponential backoff: 1 s, 2 s, 4 s ... up to 30 s, each +/- 30% (`rand` in [0, 1)). */
export function backoffMs(attempt: number, rand: number): number {
  const base = Math.min(30_000, 1000 * Math.pow(2, Math.max(0, attempt)));
  return Math.round(base * (0.7 + 0.6 * rand));
}

/** The bad-print guard's settings (`LiveOptions.guard`). */
export interface TickGuard {
  /**
   * A price is dropped when it is further from the last close than `maxJump` times the recent range (the high-low span
   * of the last 50 bars, never taken as under 5% of the price). Default 20: with a calm range that is a full 100% of the
   * price in ONE tick, which no real fast market prints, while a unit mistake (x100) or a corrupt message is caught.
   */
  maxJump: number;
  /** Seconds of tolerance past the reference time (the later of the clock and the newest bar plus one interval). Default 900, or two intervals if longer. */
  futureSeconds: number;
}

export const DEFAULT_GUARD: TickGuard = { maxJump: 20, futureSeconds: 900 };

/** High-low span of the last `n` bars (0 for none). */
export function recentRange(bars: readonly LiveBar[], n = 50): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = Math.max(0, bars.length - n); i < bars.length; i++) { if (bars[i].low < lo) lo = bars[i].low; if (bars[i].high > hi) hi = bars[i].high; }
  return hi > lo ? hi - lo : 0;
}

/**
 * The guard on everything that reaches the chart (history bars, streamed bars and trades). Deliberately generous: it
 * only drops what cannot be a real print.
 * - a time that is not finite or is far in the future: later than `ref` (the later of the visitor's clock and the newest
 *   bar's time plus one interval, so a slow clock does not drop real ticks) plus max(`futureSeconds`, two intervals).
 *   One such time would otherwise open a bar in the future that every later tick is "older" than, freezing the chart;
 * - a price that is not finite or not positive, or a bar whose high is under its low;
 * - with a last close `last`, a price further from it than `guard.maxJump` x max(`range`, 5% of `last`) (see
 *   `TickGuard`). Pass `guard: null` to keep only the time and positivity rules.
 */
export function plausibleTick(t: LiveTick, nowSec: number, intervalSec: number, last: number | null, range = 0, guard: TickGuard | null = DEFAULT_GUARD, newestBar = -Infinity): boolean {
  const g = guard ?? DEFAULT_GUARD;
  const limit = Math.max(nowSec, newestBar + intervalSec) + Math.max(g.futureSeconds, 2 * intervalSec);
  const near = (p: number): boolean => {
    if (!guard || last === null || !(last > 0)) return true;
    return Math.abs(p - last) <= guard.maxJump * Math.max(range, last * 0.05);
  };
  if (t.kind === 'trade') return Number.isFinite(t.time) && t.time <= limit && Number.isFinite(t.price) && t.price > 0 && near(t.price);
  return plausibleBar(t.bar, limit) && near(t.bar.close);
}

/** A bar passes when its time is finite and not after `limit`, and its prices are positive with high >= low. */
export function plausibleBar(b: LiveBar, limit: number): boolean {
  if (!Number.isFinite(b.time) || b.time > limit) return false;
  for (const v of [b.open, b.high, b.low, b.close]) if (!Number.isFinite(v) || !(v > 0)) return false;
  return b.high >= b.low;
}
