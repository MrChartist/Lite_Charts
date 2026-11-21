// Moving average convergence divergence.
//
//   macd(rows, { fast = 12, slow = 26, signal = 9, source }?) -> { macd, signal, histogram }
//
// macd = ema(fast) - ema(slow), first value on bar `max(fast, slow) - 1`; signal = ema(macd, signal), seeded on the
// first `signal` macd values; histogram = macd - signal. Three arrays aligned with the input: `macd` and `signal`
// for `lineSeries`, `histogram` for `histogramSeries`. Incremental form: `createIndicator('macd', options)`.

import { EmaCore } from './ema';
import { period as clampPeriod, column, pick, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions, StepCore } from './shared';

export interface MacdOptions extends SourceOptions {
  fast?: number;
  slow?: number;
  signal?: number;
}

export interface MacdResult {
  macd: IndicatorPoint[];
  signal: IndicatorPoint[];
  histogram: IndicatorPoint[];
}

export class MacdCore implements StepCore {
  private readonly fast: EmaCore;
  private readonly slow: EmaCore;
  private readonly sig: EmaCore;
  /** After a `push`: the macd line (also the return value), the signal and the histogram; NaN while warming up. */
  macd = NaN;
  signal = NaN;
  histogram = NaN;

  constructor(fast: number, slow: number, signal: number) {
    this.fast = new EmaCore(fast);
    this.slow = new EmaCore(slow);
    this.sig = new EmaCore(signal);
  }

  mark(): void { this.fast.mark(); this.slow.mark(); this.sig.mark(); }
  rollback(): void { this.fast.rollback(); this.slow.rollback(); this.sig.rollback(); }

  push(x: number): number {
    const f = this.fast.push(x);
    const s = this.slow.push(x);
    const m = Number.isNaN(f) || Number.isNaN(s) ? NaN : f - s;
    const g = Number.isNaN(m) ? NaN : this.sig.push(m);
    this.macd = m;
    this.signal = g;
    this.histogram = Number.isNaN(m) || Number.isNaN(g) ? NaN : m - g;
    return m;
  }
}

export function macd(rows: readonly IndicatorRow[], options: MacdOptions = {}): MacdResult {
  const max = rows.length + 1;
  const core = new MacdCore(clampPeriod(options.fast, 12, max), clampPeriod(options.slow, 26, max), clampPeriod(options.signal, 9, max));
  const { x, bad } = column(rows, r => pick(r, options.source));
  const n = x.length;
  const m = new Array<number>(n), s = new Array<number>(n), h = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    core.push(x[i]);
    m[i] = core.macd; s[i] = core.signal; h[i] = core.histogram;
  }
  return { macd: points(rows, m, bad), signal: points(rows, s, bad), histogram: points(rows, h, bad) };
}
