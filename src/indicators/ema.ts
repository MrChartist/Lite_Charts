// Exponential moving average.
//
//   ema(rows, period = 20, { source }?) -> IndicatorPoint[]
//
// Seeded with the simple mean of the first `period` values (first value on bar `period - 1`), then
// ema = x * k + ema * (1 - k) with k = 2 / (period + 1). Incremental form: `createIndicator('ema', { period })`.

import { period as clampPeriod, runCore } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions, StepCore } from './shared';

export class EmaCore implements StepCore {
  private readonly k: number;
  private n = 0;
  private sum = 0;
  private ema = NaN;
  private mN = 0;
  private mSum = 0;
  private mEma = NaN;

  constructor(private readonly p: number) {
    this.k = 2 / (p + 1);
  }

  mark(): void {
    this.mN = this.n;
    this.mSum = this.sum;
    this.mEma = this.ema;
  }

  rollback(): void {
    this.n = this.mN;
    this.sum = this.mSum;
    this.ema = this.mEma;
  }

  push(x: number): number {
    if (this.n < this.p) {
      this.sum += x;
      if (++this.n < this.p) return NaN;
      this.ema = this.sum / this.p;
      return this.ema;
    }
    this.ema = x * this.k + this.ema * (1 - this.k);
    return this.ema;
  }
}

export function ema(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  return runCore(rows, options.source, new EmaCore(clampPeriod(period, 20, rows.length + 1)));
}
