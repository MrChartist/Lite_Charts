// One series' data: rows in time order, their times in seconds, and each row's slot on the shared time axis.

import { isBusinessDayInput, timeToSeconds, type Time } from '../core/time';
import type { TimeIndex } from '../core/time-index';
import { mapToUnion } from '../core/time-index';
import type { ChartPrimitive } from '../plugins/primitive';
import type { RowBase, SeriesCommonOptions, SeriesDefinition } from './definition';

export type UpdateKind = 'replace' | 'append' | 'insert';

export class SeriesModel<R extends RowBase = RowBase, O extends object = object> {
  readonly def: SeriesDefinition<R, O>;
  options: O & SeriesCommonOptions;
  rows: (R | null)[] = [];
  times = new Float64Array(0);
  count = 0;
  /** Slot on the time axis of each row. */
  pos = new Int32Array(0);
  /** null while empty; else whether the times were given as business days. */
  businessDays: boolean | null = null;
  primitives: ChartPrimitive[] = [];

  constructor(def: SeriesDefinition<R, O>, options: O & SeriesCommonOptions) {
    this.def = def;
    this.options = options;
  }

  /** Replace every row. Throws on unsorted or duplicate times, naming the row. */
  setData(input: readonly (Record<string, unknown> & { time: Time })[]): void {
    const n = input.length;
    const rows: (R | null)[] = new Array(n);
    const times = new Float64Array(Math.max(16, n));
    let business: boolean | null = null;
    for (let i = 0; i < n; i++) {
      const row = input[i];
      if (!row || typeof row !== 'object') throw new TypeError(`Chartist Lite: row ${i} is not an object`);
      const t = timeToSeconds(row.time);
      const b = isBusinessDayInput(row.time);
      if (business === null) business = b;
      else if (business !== b) throw new TypeError(`Chartist Lite: row ${i} mixes business days and timestamps`);
      if (i > 0 && !(t > times[i - 1])) {
        throw new TypeError(`Chartist Lite: rows must be in ascending time order without duplicates (row ${i})`);
      }
      times[i] = t;
      rows[i] = this.def.normalize(row);
    }
    this.rows = rows;
    this.times = times;
    this.count = n;
    this.pos = new Int32Array(times.length);
    this.businessDays = n > 0 ? business : null;
  }

  /**
   * Replace the last row (same time) or add one after it. 'insert' means the time is new to the shared axis but
   * not after its last slot: the caller must rebuild the axis. Throws for a time before the last row.
   */
  update(row: Record<string, unknown> & { time: Time }): { kind: UpdateKind; t: number } {
    const t = timeToSeconds(row.time);
    const b = isBusinessDayInput(row.time);
    if (this.businessDays !== null && this.businessDays !== b) throw new TypeError('Chartist Lite: update mixes business days and timestamps');
    const value = this.def.normalize(row);
    if (this.count > 0) {
      const last = this.times[this.count - 1];
      if (t === last) {
        this.rows[this.count - 1] = value;
        return { kind: 'replace', t };
      }
      if (t < last) throw new RangeError('Chartist Lite: update() accepts the last bar or a newer one, not an older bar');
    }
    if (this.count >= this.times.length) {
      const times = new Float64Array(Math.max(16, this.times.length * 2));
      times.set(this.times);
      this.times = times;
      const pos = new Int32Array(times.length);
      pos.set(this.pos);
      this.pos = pos;
    }
    this.times[this.count] = t;
    this.rows.push(value);
    this.count++;
    this.businessDays = b;
    return { kind: 'append', t };
  }

  remap(index: TimeIndex): void {
    if (this.pos.length < this.times.length) this.pos = new Int32Array(this.times.length);
    mapToUnion(index, this.times, this.count, this.pos);
  }

  /** Inclusive row range whose slots fall in [fromSlot, toSlot]; null when none. */
  rowRange(fromSlot: number, toSlot: number): { from: number; to: number } | null {
    const a = this.lowerBound(fromSlot);
    const b = this.lowerBound(toSlot + 1) - 1;
    return a <= b ? { from: a, to: b } : null;
  }

  /** Row index at slot exactly, or -1. */
  rowAtSlot(slot: number): number {
    const i = this.lowerBound(slot);
    return i < this.count && this.pos[i] === slot ? i : -1;
  }

  private lowerBound(slot: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.pos[mid] < slot) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** The last non-whitespace row, or null. */
  lastRow(): R | null {
    for (let i = this.count - 1; i >= 0; i--) {
      const r = this.rows[i];
      if (r) return r;
    }
    return null;
  }
}
