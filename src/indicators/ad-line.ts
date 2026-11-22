// Accumulation / distribution line.
//
//   adLine(rows) -> IndicatorPoint[]
//
// A running sum of volume * ((close - low) - (high - close)) / (high - low) (0 for a zero-range bar), starting from 0 on the
// first bar. A missing, negative or non-numeric volume counts as 0. Needs candlestick rows with volume.

import { hlc, volCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';

export function adLine(rows: readonly IndicatorRow[]): IndicatorPoint[] {
  const { h, l, c, bad } = hlc(rows);
  const v = volCol(rows);
  let ad = 0;
  const out = c.map((x, i) => {
    const hl = h[i] - l[i];
    ad += (hl === 0 ? 0 : ((x - l[i]) - (h[i] - x)) / hl) * v[i];
    return ad;
  });
  return points(rows, out, bad);
}
