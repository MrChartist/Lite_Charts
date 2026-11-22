// One series' data: rows in time order, their times in seconds, and each row's slot on the shared time axis.

import { isBusinessDayInput, timeToSeconds, type Time } from '../core/time';
import type { TimeIndex } from '../core/time-index';
import { mapToUnion } from '../core/time-index';
import type { ChartPrimitive } from '../plugins/primitive';
import type { RowBase, SeriesCommonOptions, SeriesDefinition } from './definition';

/** `pos` of a row that is not on the axis (ordinal mode: it does not line up with the brick rows). */
export const OFF = 0x7fffffff;
const EXT_BLOCK = 128;
const VAL_BLOCK = 32;

export type UpdateKind = 'replace' | 'append' | 'insert';

export class SeriesModel<R extends RowBase = RowBase, O extends object = object> {
  readonly def: SeriesDefinition<R, O>;
  options: O & SeriesCommonOptions;
  rows: (R | null)[] = [];
  times = new Float64Array(0);
  count = 0;
  /** Slot on the time axis of each row. */
  pos = new Int32Array(0);
  /** `def.value(row)` of each row (NaN for whitespace): the typed fast path for dense drawing (scope.values). */
  vals = new Float64Array(0);
  /** `def.low(row, options)` / `def.high(row, options)` of each row (NaN for whitespace), for dense drawing. */
  lows = new Float64Array(0);
  highs = new Float64Array(0);

  private fillRow(i: number): void {
    const r = this.rows[i];
    if (r) { this.vals[i] = this.def.value(r); this.lows[i] = this.def.low(r, this.options); this.highs[i] = this.def.high(r, this.options); }
    else { this.vals[i] = Number.NaN; this.lows[i] = Number.NaN; this.highs[i] = Number.NaN; }
  }
  /** null while empty; else whether the times were given as business days. */
  businessDays: boolean | null = null;
  primitives: ChartPrimitive[] = [];
  /** The pane the series draws in (0 = top). */
  paneIndex = 0;

  constructor(def: SeriesDefinition<R, O>, options: O & SeriesCommonOptions) {
    this.def = def;
    this.options = options;
  }

  // Per-block extremes for autoscale: blocks of EXT_BLOCK rows, computed lazily, invalidated by data / option changes.
  private extLo = new Float64Array(0);
  private extHi = new Float64Array(0);
  private extOk = new Uint8Array(0);

  // Per-block min / max of `vals` (VAL_BLOCK rows; NaN in a block marks it), for folding dense lines.
  private vMin = new Float64Array(0);
  private vMax = new Float64Array(0);
  private vOk = new Uint8Array(0);

  /** Block minima / maxima of `vals` (NaN for a block holding a gap), all valid on return. */
  valueBlocks(): { size: number; min: Float64Array; max: Float64Array } {
    const B = VAL_BLOCK;
    const nb = Math.ceil(this.count / B);
    if (this.vOk.length < nb) {
      const a = new Float64Array(nb * 2); a.set(this.vMin); this.vMin = a;
      const b = new Float64Array(nb * 2); b.set(this.vMax); this.vMax = b;
      const c = new Uint8Array(nb * 2); c.set(this.vOk); this.vOk = c;
    }
    const v = this.vals;
    for (let k = 0; k < nb; k++) {
      if (this.vOk[k]) continue;
      let lo = Infinity, hi = -Infinity;
      const end = Math.min(this.count, (k + 1) * B);
      for (let i = k * B; i < end; i++) {
        const x = v[i];
        if (x !== x) { lo = Number.NaN; hi = Number.NaN; break; }
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      this.vMin[k] = lo; this.vMax[k] = hi; this.vOk[k] = 1;
    }
    return { size: B, min: this.vMin, max: this.vMax };
  }

  /** Forget cached extremes (options changed: a histogram's base, say). */
  invalidateExtents(): void {
    this.extOk.fill(0);
    for (let i = 0; i < this.count; i++) this.fillRow(i);
  }

  /** Lowest low and highest high of rows a..b into out[0], out[1] (+Infinity / -Infinity when none). */
  extents(a: number, b: number, out: Float64Array): void {
    const B = EXT_BLOCK;
    const nb = Math.ceil(this.count / B);
    if (this.extOk.length < nb) {
      const lo = new Float64Array(nb * 2); lo.set(this.extLo); this.extLo = lo;
      const hi = new Float64Array(nb * 2); hi.set(this.extHi); this.extHi = hi;
      const ok = new Uint8Array(nb * 2); ok.set(this.extOk); this.extOk = ok;
    }
    const def = this.def;
    const o = this.options;
    const rows = this.rows;
    let lo = Infinity;
    let hi = -Infinity;
    let i = a;
    while (i <= b) {
      if (i % B === 0 && i + B - 1 <= b) {
        const k = i / B;
        if (!this.extOk[k]) {
          let l = Infinity, h = -Infinity;
          for (let j = i; j < i + B; j++) { const r = rows[j]; if (r) { const x = def.low(r, o), y = def.high(r, o); if (x < l) l = x; if (y > h) h = y; } }
          this.extLo[k] = l; this.extHi[k] = h; this.extOk[k] = 1;
        }
        if (this.extLo[k] < lo) lo = this.extLo[k];
        if (this.extHi[k] > hi) hi = this.extHi[k];
        i += B;
      } else {
        const r = rows[i];
        if (r) { const x = def.low(r, o), y = def.high(r, o); if (x < lo) lo = x; if (y > hi) hi = y; }
        i++;
      }
    }
    out[0] = lo;
    out[1] = hi;
  }

  /** Bumped on every data change (setData, update). */
  version = 0;
  private dataCache: R[] | null = null;

  /** The non-whitespace rows, as one array cached until the next change (O(n) once per change, then O(1)). */
  data(): readonly R[] {
    if (!this.dataCache) {
      const out: R[] = [];
      for (let i = 0; i < this.count; i++) { const r = this.rows[i]; if (r) out.push(r); }
      this.dataCache = out;
    }
    return this.dataCache;
  }

  /**
   * Replace every row. Throws on unsorted or duplicate times, naming the row. `kind` is the kind of time the chart's
   * other series use (true = business days), checked BEFORE anything changes, so a rejected call leaves the series as
   * it was. `dup` (an ordinal chart): repeated times are allowed; `axis`: row i must have the time of slot i while the
   * axis has one (every series of an ordinal chart but the one that makes the axis).
   */
  setData(input: readonly (Record<string, unknown> & { time: Time })[], kind: boolean | null = null, dup = false, axis: TimeIndex | null = null): void {
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
      if (kind !== null && b !== kind) throw new TypeError(kindError(kind));
      if (i > 0 && !(t > times[i - 1]) && !(dup && t === times[i - 1])) {
        throw new TypeError(`Chartist Lite: rows must be in ascending time order without duplicates (row ${i})`);
      }
      if (axis && i < axis.count && t !== axis.times[i]) throw new TypeError(alignError(i));
      times[i] = t;
      rows[i] = this.def.normalize(row);
    }
    this.rows = rows;
    this.times = times;
    this.count = n;
    this.pos = new Int32Array(times.length);
    this.vals = new Float64Array(times.length);
    this.lows = new Float64Array(times.length);
    this.highs = new Float64Array(times.length);
    for (let i = 0; i < n; i++) this.fillRow(i);
    this.businessDays = n > 0 ? business : null;
    this.version++;
    this.dataCache = null;
    this.extOk.fill(0);
    this.vOk.fill(0);
  }

  /**
   * Replace the last row (same time) or add one after it. 'insert' means the time is new to the shared axis but
   * not after its last slot: the caller must rebuild the axis. Throws for a time before the last row. `append` with
   * `dup` (an ordinal chart) adds a row with the same time as the last one; `axis` as in `setData` (checked first).
   */
  update(row: Record<string, unknown> & { time: Time }, kind: boolean | null = null, append = false, dup = false, axis: TimeIndex | null = null): { kind: UpdateKind; t: number } {
    const t = timeToSeconds(row.time);
    const b = isBusinessDayInput(row.time);
    if (this.businessDays !== null && this.businessDays !== b) throw new TypeError('Chartist Lite: update mixes business days and timestamps');
    if (kind !== null && b !== kind) throw new TypeError(kindError(kind));
    const n = this.count;
    const at = n > 0 && t === this.times[n - 1] && !append ? n - 1 : n;
    if (axis && at < axis.count && t !== axis.times[at]) throw new TypeError(alignError(at));
    const value = this.def.normalize(row);
    if (this.count > 0) {
      const last = this.times[this.count - 1];
      if (t === last && !append) {
        this.rows[this.count - 1] = value;
        this.fillRow(this.count - 1);
        this.version++;
        this.dataCache = null;
        if (this.extOk.length) this.extOk[Math.floor((this.count - 1) / EXT_BLOCK)] = 0;
        if (this.vOk.length) this.vOk[Math.floor((this.count - 1) / VAL_BLOCK)] = 0;
        return { kind: 'replace', t };
      }
      if (t < last || (t === last && !dup)) throw new RangeError('Chartist Lite: update() accepts the last bar or a newer one, not an older bar');
    }
    if (this.count >= this.times.length) {
      const times = new Float64Array(Math.max(16, this.times.length * 2));
      times.set(this.times);
      this.times = times;
      const pos = new Int32Array(times.length);
      pos.set(this.pos);
      this.pos = pos;
      const grow = (a: Float64Array): Float64Array<ArrayBuffer> => { const b = new Float64Array(times.length); b.set(a); return b; };
      this.vals = grow(this.vals);
      this.lows = grow(this.lows);
      this.highs = grow(this.highs);
    }
    this.times[this.count] = t;
    this.rows.push(value);
    this.fillRow(this.count);
    this.count++;
    this.businessDays = b;
    this.version++;
    this.dataCache = null;
    const blk = Math.floor((this.count - 1) / EXT_BLOCK);
    if (blk < this.extOk.length) this.extOk[blk] = 0;
    const vb = Math.floor((this.count - 1) / VAL_BLOCK);
    if (vb < this.vOk.length) this.vOk[vb] = 0;
    return { kind: 'append', t };
  }

  /** Remove the last `n` rows. */
  pop(n: number): void {
    const keep = Math.max(0, this.count - Math.max(0, Math.floor(n) || 0));
    if (keep === this.count) return;
    this.rows.length = keep;
    this.count = keep;
    if (!keep) this.businessDays = null;
    this.version++;
    this.dataCache = null;
    this.extOk.fill(0, Math.floor(keep / EXT_BLOCK));
    this.vOk.fill(0, Math.floor(keep / VAL_BLOCK));
  }

  remap(index: TimeIndex): void {
    if (this.pos.length < this.times.length) this.pos = new Int32Array(this.times.length);
    if (!index.ordinal) { mapToUnion(index, this.times, this.count, this.pos); return; }
    // Row i at slot i while it lines up with the axis; from the first row that does not, off the axis.
    let on = true;
    for (let i = 0; i < this.count; i++) this.pos[i] = (on = on && i < index.count && this.times[i] === index.times[i]) ? i : OFF;
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

  /** The last non-whitespace row (`skip` = 1: the one before it), or null. */
  lastRow(skip = 0): R | null {
    for (let i = this.count - 1; i >= 0; i--) {
      const r = this.rows[i];
      if (r && this.pos[i] !== OFF && skip-- === 0) return r;
    }
    return null;
  }
}

function alignError(i: number): string {
  return `Chartist Lite: on a brick (ordinal) axis row ${i} must have the time of brick ${i}`;
}

function kindError(chartUsesBusinessDays: boolean): string {
  return `Chartist Lite: this chart's series use ${chartUsesBusinessDays ? 'business days (YYYY-MM-DD)' : 'timestamps (UNIX seconds)'}; `
    + 'all series of one chart must use the same kind of time';
}
