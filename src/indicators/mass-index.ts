// Mass index.
//
//   massIndex(rows, { emaPeriod = 9, sumPeriod = 25 }?) -> IndicatorPoint[]
//
// The sum over `sumPeriod` bars of EMA(high - low, emaPeriod) / EMA(EMA(high - low, emaPeriod), emaPeriod): the widening of
// the bar range, read for "reversal bulges" (above 27, then below 26.5). First value on bar `2 * emaPeriod + sumPeriod - 4`.
// Needs candlestick rows. Guides: 26.5 and 27.

import { hl } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { emaCore, emaOf, nanArray } from './series';

export interface MassIndexOptions {
  emaPeriod?: number;
  sumPeriod?: number;
}

export function massIndex(rows: readonly IndicatorRow[], options: MassIndexOptions = {}): IndicatorPoint[] {
  const n = rows.length;
  const ep = clampPeriod(options.emaPeriod, 9, n + 1), sp = clampPeriod(options.sumPeriod, 25, n + 1);
  const { h, l, bad } = hl(rows);
  const e1 = emaCore(h.map((v, i) => v - l[i]), ep), e2 = emaOf(e1, ep);
  const ratio = e1.map((v, i) => (!Number.isNaN(v) && !Number.isNaN(e2[i]) && e2[i] !== 0 ? v / e2[i] : NaN));
  const out = nanArray(n);
  for (let i = sp - 1; i < n; i++) {
    let s = 0, ok = true;
    for (let k = i - sp + 1; k <= i; k++) { if (Number.isNaN(ratio[k])) { ok = false; break; } s += ratio[k]; }
    if (ok) out[i] = s;
  }
  return points(rows, out, bad);
}
