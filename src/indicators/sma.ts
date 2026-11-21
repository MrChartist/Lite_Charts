// Simple moving average.
//
//   sma(rows, period = 20, { source }?) -> IndicatorPoint[]
//
// First value on bar `period - 1`. A running sum with an exact re-sum once per window (drift guard), the same
// numbers as the host kernel. Incremental form: `createIndicator('sma', { period })`.

import { period as clampPeriod, runCore } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions, StepCore } from './shared';

/** Ring buffer plus running sum; one bar in, one bar out, O(1) (the re-sum is once per `period` bars). */
export class SmaCore implements StepCore {
  private readonly buf: Float64Array;
  private n = 0;
  private sum = 0;
  private mSlot = 0;
  private mOld = 0;
  private mSum = 0;
  private mN = 0;

  constructor(private readonly p: number) {
    this.buf = new Float64Array(p);
  }

  mark(): void {
    this.mSlot = this.n % this.p;
    this.mOld = this.buf[this.mSlot];
    this.mSum = this.sum;
    this.mN = this.n;
  }

  rollback(): void {
    this.buf[this.mSlot] = this.mOld;
    this.sum = this.mSum;
    this.n = this.mN;
  }

  push(x: number): number {
    const { p, buf } = this;
    const i = this.n++;
    const slot = i % p;
    if (i < p) {
      buf[slot] = x;
      this.sum += x;
      return i === p - 1 ? this.sum / p : NaN;
    }
    if ((i - (p - 1)) % p === 0) {
      buf[slot] = x;
      let s = 0;
      for (let k = 0; k < p; k++) s += buf[(slot + 1 + k) % p];
      this.sum = s;
    } else {
      this.sum += x - buf[slot];
      buf[slot] = x;
    }
    return this.sum / p;
  }
}

export function sma(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  return runCore(rows, options.source, new SmaCore(clampPeriod(period, 20, rows.length + 1)));
}
