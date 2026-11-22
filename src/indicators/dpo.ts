// Detrended price oscillator.
//
//   dpo(rows, period = 20, { source }?) -> IndicatorPoint[]
//
// x - SMA(period) taken `floor(period / 2) + 1` bars earlier (the non-centred form: the same line as the centred plot,
// aligned to the current bar). First value on bar `period - 1 + floor(period / 2) + 1`. Guide: 0.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { nanArray, smaCore } from './series';

export function dpo(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  const p = clampPeriod(period, 20, rows.length + 1);
  const { x, bad } = closeCol(rows, options.source);
  const sma = smaCore(x, p), shift = Math.floor(p / 2) + 1;
  const out = nanArray(x.length);
  for (let i = 0; i < x.length; i++) { const k = i - shift; if (k >= 0 && !Number.isNaN(sma[k])) out[i] = x[i] - sma[k]; }
  return points(rows, out, bad);
}
