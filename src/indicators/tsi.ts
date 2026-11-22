// True strength index.
//
//   tsi(rows, { long = 25, short = 13, signal = 13, source }?) -> { tsi, signal }
//
// 100 * EMA(EMA(change, long), short) / EMA(EMA(|change|, long), short); signal = EMA(tsi, signal). Each EMA is seeded
// with the simple mean of its first values. First tsi on bar `long + short - 1`, signal `signal - 1` bars later. No value
// where the smoothed absolute change is 0. Guide: 0.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { emaOf, nanArray } from './series';

export interface TsiOptions extends SourceOptions {
  long?: number;
  short?: number;
  signal?: number;
}

export interface TsiResult {
  tsi: IndicatorPoint[];
  signal: IndicatorPoint[];
}

export function tsi(rows: readonly IndicatorRow[], options: TsiOptions = {}): TsiResult {
  const n = rows.length;
  const lp = clampPeriod(options.long, 25, n + 1), sp = clampPeriod(options.short, 13, n + 1), gp = clampPeriod(options.signal, 13, n + 1);
  const { x, bad } = closeCol(rows, options.source);
  const t = nanArray(n);
  let sig = nanArray(n);
  if (n >= 2) {
    const pc = nanArray(n), apc = nanArray(n);
    for (let i = 1; i < n; i++) { const d = x[i] - x[i - 1]; pc[i] = d; apc[i] = Math.abs(d); }
    const ds = emaOf(emaOf(pc, lp), sp), as = emaOf(emaOf(apc, lp), sp);
    for (let i = 0; i < n; i++) if (!Number.isNaN(ds[i]) && !Number.isNaN(as[i]) && as[i] !== 0) t[i] = (ds[i] / as[i]) * 100;
    sig = emaOf(t, gp);
    for (let i = 0; i < n; i++) if (Number.isNaN(t[i])) sig[i] = NaN;
  }
  return { tsi: points(rows, t, bad), signal: points(rows, sig, bad) };
}
