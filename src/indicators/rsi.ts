// Relative strength index, Wilder's smoothing.
//
//   rsi(rows, period = 14, { source }?) -> IndicatorPoint[]
//
// First value on bar `period`. The first averages are the simple means of the first `period` gains and losses, then
// avg = (avg * (period - 1) + x) / period. RSI = 100 * gain / (gain + loss), so all gains read 100, all losses 0 and
// a flat run 50. Incremental form: `createIndicator('rsi', { period })`.

import { period as clampPeriod, runCore } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions, StepCore } from './shared';

export class RsiCore implements StepCore {
  private n = 0;
  private prev = NaN;
  private gain = 0;
  private loss = 0;
  private mN = 0;
  private mPrev = NaN;
  private mGain = 0;
  private mLoss = 0;

  constructor(private readonly p: number) {}

  mark(): void {
    this.mN = this.n;
    this.mPrev = this.prev;
    this.mGain = this.gain;
    this.mLoss = this.loss;
  }

  rollback(): void {
    this.n = this.mN;
    this.prev = this.mPrev;
    this.gain = this.mGain;
    this.loss = this.mLoss;
  }

  private read(): number {
    const g = this.gain, l = this.loss;
    return g + l === 0 ? 50 : (g / (g + l)) * 100;
  }

  push(x: number): number {
    const { p } = this;
    if (this.n === 0) { this.prev = x; this.n = 1; return NaN; }
    const d = x - this.prev;
    this.prev = x;
    if (this.n <= p) {
      if (d >= 0) this.gain += d; else this.loss -= d;
      if (++this.n < p + 1) return NaN;
      this.gain /= p;
      this.loss /= p;
      return this.read();
    }
    this.gain = (this.gain * (p - 1) + Math.max(0, d)) / p;
    this.loss = (this.loss * (p - 1) + Math.max(0, -d)) / p;
    return this.read();
  }
}

export function rsi(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  return runCore(rows, options.source, new RsiCore(clampPeriod(period, 14, rows.length + 1)));
}
