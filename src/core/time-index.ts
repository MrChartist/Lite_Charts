// The shared time axis: the sorted union of every series' times, one logical index per distinct time, and each
// slot's calendar fields read once in the display zone. Logical index `i` is the i-th distinct time; non-trading
// time simply has no slot, so the axis shows no gaps for nights, weekends or holidays.

import { inferTimeKind, type TimeKind } from './time';
import { civilKeyFromDays, zoneDayNumber, zoneMinuteOfDay } from './zone';

/** Calendar fields of every slot, in the display zone. Views stay valid until the next `rebuild`/`append`. */
export interface CalendarFields {
  ok: Uint8Array;
  year: Int32Array;
  month: Uint8Array;
  day: Uint8Array;
  /** Whole days since 1970-01-01 in the display zone. */
  dayNum: Int32Array;
  /** Minutes past local midnight. */
  minute: Int16Array;
}

function allocCalendar(cap: number): CalendarFields {
  return {
    ok: new Uint8Array(cap), year: new Int32Array(cap), month: new Uint8Array(cap), day: new Uint8Array(cap),
    dayNum: new Int32Array(cap), minute: new Int16Array(cap),
  };
}

export class TimeIndex {
  /** Distinct times in seconds, ascending; valid in [0, count). */
  times: Float64Array = new Float64Array(16);
  count = 0;
  cal: CalendarFields = allocCalendar(16);
  kind: TimeKind = 'daily';
  /**
   * Slots that open a new calendar day / month in the display zone (slot 0 included), ascending. Every day, week,
   * month and year boundary is one of them, so the time-axis planner can skip the bars between them when tens of
   * thousands are in view.
   */
  dayStarts: Int32Array = new Int32Array(16);
  dayStartCount = 0;
  monthStarts: Int32Array = new Int32Array(16);
  monthStartCount = 0;
  /** True when the data are business days (dates): the calendar is then read on UTC. */
  businessDays = false;
  private zone = 'UTC';

  /** Set the display zone; returns true when it changed (the calendar is re-read). */
  setZone(tz: string): boolean {
    if (tz === this.zone) return false;
    this.zone = tz;
    this.readCalendar(0, this.count);
    return true;
  }

  displayZone(): string {
    return this.businessDays ? 'UTC' : this.zone;
  }

  /** Replace the union with the merge of these sorted lists (each strictly ascending). */
  rebuild(lists: readonly { times: ArrayLike<number>; count: number }[], businessDays: boolean): void {
    let total = 0;
    for (const l of lists) total += l.count;
    const all = new Float64Array(total);
    let k = 0;
    for (const l of lists) for (let i = 0; i < l.count; i++) all[k++] = l.times[i];
    all.sort();
    let n = 0;
    for (let i = 0; i < total; i++) if (i === 0 || all[i] !== all[i - 1]) all[n++] = all[i];
    this.ensure(n);
    this.times.set(all.subarray(0, n));
    this.count = n;
    this.businessDays = businessDays;
    this.kind = inferTimeKind(this.times, n);
    this.readCalendar(0, n);
  }

  /** Add a time after the last one. O(1) amortised. */
  append(t: number): number {
    this.ensure(this.count + 1);
    this.times[this.count] = t;
    this.readCalendar(this.count, this.count + 1);
    this.count++;
    if (this.count <= 3 || (this.count & 63) === 0) this.kind = inferTimeKind(this.times, this.count);
    return this.count - 1;
  }

  /** Index of exact time `t`, or -1. */
  indexOf(t: number): number {
    const i = this.lowerBound(t);
    return i < this.count && this.times[i] === t ? i : -1;
  }

  /** First index whose time is >= t (count when none). */
  lowerBound(t: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.times[mid] < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  private ensure(n: number): void {
    if (n <= this.times.length) return;
    let cap = this.times.length;
    while (cap < n) cap *= 2;
    const times = new Float64Array(cap);
    times.set(this.times.subarray(0, this.count));
    this.times = times;
    const old = this.cal;
    const cal = allocCalendar(cap);
    cal.ok.set(old.ok.subarray(0, this.count));
    cal.year.set(old.year.subarray(0, this.count));
    cal.month.set(old.month.subarray(0, this.count));
    cal.day.set(old.day.subarray(0, this.count));
    cal.dayNum.set(old.dayNum.subarray(0, this.count));
    cal.minute.set(old.minute.subarray(0, this.count));
    this.cal = cal;
  }

  private pushStart(day: boolean, slot: number): void {
    if (day) {
      if (this.dayStartCount >= this.dayStarts.length) this.dayStarts = grow(this.dayStarts);
      this.dayStarts[this.dayStartCount++] = slot;
    } else {
      if (this.monthStartCount >= this.monthStarts.length) this.monthStarts = grow(this.monthStarts);
      this.monthStarts[this.monthStartCount++] = slot;
    }
  }

  private readCalendar(from: number, to: number): void {
    const tz = this.displayZone();
    const c = this.cal;
    if (from === 0) { this.dayStartCount = 0; this.monthStartCount = 0; }
    for (let i = from; i < to; i++) {
      const ms = this.times[i] * 1000;
      if (!Number.isFinite(ms)) { c.ok[i] = 0; continue; }
      const dayNum = zoneDayNumber(tz, ms);
      const key = civilKeyFromDays(dayNum);
      c.ok[i] = 1;
      c.year[i] = Math.floor(key / 10_000);
      c.month[i] = Math.floor(key / 100) % 100;
      c.day[i] = key % 100;
      c.dayNum[i] = dayNum;
      c.minute[i] = zoneMinuteOfDay(tz, ms);
      if (i === 0 || !c.ok[i - 1] || c.dayNum[i] !== c.dayNum[i - 1]) this.pushStart(true, i);
      if (i === 0 || !c.ok[i - 1] || c.month[i] !== c.month[i - 1] || c.year[i] !== c.year[i - 1]) this.pushStart(false, i);
    }
  }
}

function grow(a: Int32Array): Int32Array {
  const b = new Int32Array(a.length * 2);
  b.set(a);
  return b;
}

/** First position in `list[0, count)` whose value is >= v. */
export function lowerBoundInt(list: Int32Array, count: number, v: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * The slot of every time of one series in the union, by a merge walk (both ascending). Returns -1 for a time that
 * is missing from the union (never, when the union was built from this series).
 */
export function mapToUnion(index: TimeIndex, times: ArrayLike<number>, count: number, out: Int32Array): void {
  let j = 0;
  for (let i = 0; i < count; i++) {
    const t = times[i];
    while (j < index.count && index.times[j] < t) j++;
    out[i] = j < index.count && index.times[j] === t ? j : -1;
  }
}
