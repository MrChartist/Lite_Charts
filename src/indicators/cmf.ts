// Chaikin money flow.
//
//   cmf(rows, period = 20) -> IndicatorPoint[]
//
// sum(money flow volume) / sum(volume) over `period` bars, money flow volume = volume * ((close - low) - (high - close)) /
// (high - low) (0 for a zero-range bar). From -1 to 1; 0 when the window has no volume. First value on bar `period - 1`.
// Needs candlestick rows with volume. Guide: 0.

import { hlc, volCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export function cmf(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const p = clampPeriod(period, 20, rows.length + 1);
  const { h, l, c, bad } = hlc(rows);
  const v = volCol(rows);
  const out = nanArray(c.length);
  for (let i = p - 1; i < c.length; i++) {
    let mfv = 0, vol = 0;
    for (let j = i - p + 1; j <= i; j++) {
      const hl = h[j] - l[j];
      const mfm = hl === 0 ? 0 : ((c[j] - l[j]) - (h[j] - c[j])) / hl;
      mfv += mfm * v[j];
      vol += v[j];
    }
    out[i] = vol === 0 ? 0 : mfv / vol;
  }
  return points(rows, out, bad);
}
