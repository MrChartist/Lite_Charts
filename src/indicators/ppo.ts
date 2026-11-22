// Percentage price oscillator.
//
//   ppo(rows, { fast = 12, slow = 26, signal = 9, source }?) -> { ppo, signal, histogram }
//
// ppo = 100 * (EMA(fast) - EMA(slow)) / EMA(slow), first value on bar `max(fast, slow) - 1` (no value where EMA(slow) is
// 0); signal = EMA(ppo, signal) seeded on the first `signal` values; histogram = ppo - signal. Guide: 0.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { emaCore, emaOf, nanArray } from './series';

export interface PpoOptions extends SourceOptions {
  fast?: number;
  slow?: number;
  signal?: number;
}

export interface PpoResult {
  ppo: IndicatorPoint[];
  signal: IndicatorPoint[];
  histogram: IndicatorPoint[];
}

export function ppo(rows: readonly IndicatorRow[], options: PpoOptions = {}): PpoResult {
  const n = rows.length;
  const fp = clampPeriod(options.fast, 12, n + 1), sp = clampPeriod(options.slow, 26, n + 1), gp = clampPeriod(options.signal, 9, n + 1);
  const { x, bad } = closeCol(rows, options.source);
  const f = emaCore(x, fp), s = emaCore(x, sp);
  const line = nanArray(n);
  for (let i = 0; i < n; i++) if (!Number.isNaN(f[i]) && !Number.isNaN(s[i]) && s[i] !== 0) line[i] = ((f[i] - s[i]) / s[i]) * 100;
  const sig = emaOf(line, gp);
  return { ppo: points(rows, line, bad), signal: points(rows, sig, bad), histogram: points(rows, line.map((v, i) => v - sig[i]), bad) };
}
