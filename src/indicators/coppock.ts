// Coppock curve.
//
//   coppock(rows, { rocLong = 14, rocShort = 11, wma = 10, source }?) -> IndicatorPoint[]
//
// WMA(wma) of ROC(rocLong) + ROC(rocShort), in percent. First value on bar `rocLong + wma - 1` (the longer ROC's first bar
// plus the WMA window). Guide: 0.

import { closeCol } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { rocValues } from './roc';
import { nanArray } from './series';

export interface CoppockOptions extends SourceOptions {
  rocLong?: number;
  rocShort?: number;
  wma?: number;
}

export function coppock(rows: readonly IndicatorRow[], options: CoppockOptions = {}): IndicatorPoint[] {
  const n = rows.length;
  const wp = clampPeriod(options.wma, 10, n + 1);
  const { x, bad } = closeCol(rows, options.source);
  const r1 = rocValues(x, clampPeriod(options.rocLong, 14, n + 1)), r2 = rocValues(x, clampPeriod(options.rocShort, 11, n + 1));
  const sum = r1.map((v, i) => v + r2[i]);
  const out = nanArray(n);
  for (let i = wp - 1; i < n; i++) {
    let ws = 0, wd = 0, ok = true;
    for (let k = 0; k < wp; k++) { const v = sum[i - k]; if (Number.isNaN(v)) { ok = false; break; } const w = wp - k; ws += v * w; wd += w; }
    if (ok && wd > 0) out[i] = ws / wd;
  }
  return points(rows, out, bad);
}
