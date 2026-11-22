// Chande momentum oscillator.
//
//   cmo(rows, period = 14, { source }?) -> IndicatorPoint[]
//
// 100 * (sum of gains - sum of losses) / (sum of gains + sum of losses) over the last `period` changes, from -100 to 100
// (0 when nothing moved). First value on bar `period`. Guides: -50 and 50.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { nanArray } from './series';

export function cmo(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  const p = clampPeriod(period, 14, rows.length + 1);
  const { x, bad } = closeCol(rows, options.source);
  const out = nanArray(x.length);
  if (x.length >= p + 1) {
    let up = 0, down = 0;
    for (let i = 1; i <= p; i++) { const d = x[i] - x[i - 1]; if (d > 0) up += d; else down -= d; }
    const total = up + down;
    out[p] = total === 0 ? 0 : ((up - down) / total) * 100;
    for (let i = p + 1; i < x.length; i++) {
      const d = x[i] - x[i - 1], old = x[i - p] - x[i - p - 1];
      if (d > 0) up += d; else down -= d;
      if (old > 0) up -= old; else down += old;
      up = Math.max(0, up); down = Math.max(0, down);
      const t = up + down;
      out[i] = t === 0 ? 0 : ((up - down) / t) * 100;
    }
  }
  return points(rows, out, bad);
}
