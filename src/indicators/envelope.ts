// Moving average envelope.
//
//   envelope(rows, { period = 20, percent = 10, type = 'sma', source }?) -> { upper, middle, lower }
//
// middle = a moving average ('sma' | 'ema' | 'rma' | 'wma' | 'vwma' | 'hma'; vwma needs volume), upper and lower =
// middle * (1 +/- percent / 100). First value where the average has one (`period - 1` for sma). A window holding a bad
// value has no value.

import { rawCol, rawPrice } from './cols';
import { finiteOr, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { len, maN } from './series';

export interface EnvelopeOptions extends SourceOptions {
  period?: number;
  /** Distance of each edge from the middle, in percent. Default 10. */
  percent?: number;
  type?: 'sma' | 'ema' | 'rma' | 'wma' | 'vwma' | 'hma';
}

export interface EnvelopeResult {
  upper: IndicatorPoint[];
  middle: IndicatorPoint[];
  lower: IndicatorPoint[];
}

export function envelope(rows: readonly IndicatorRow[], options: EnvelopeOptions = {}): EnvelopeResult {
  const vol = rawCol(rows, r => r.volume as number);
  const mid = maN(options.type ?? 'sma', rawPrice(rows, options.source), len(options.period, 20), vol);
  const f = finiteOr(options.percent, 10) / 100;
  return {
    upper: points(rows, mid.map(m => m * (1 + f)), null),
    middle: points(rows, mid, null),
    lower: points(rows, mid.map(m => m * (1 - f)), null),
  };
}
