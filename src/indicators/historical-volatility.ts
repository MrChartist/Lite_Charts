// Historical volatility.
//
//   historicalVolatility(rows, { period = 10, annualisation = 252, source }?) -> IndicatorPoint[]
//
// 100 * the population standard deviation of the one-bar log returns ln(x / x[1]) over `period` bars, times
// sqrt(annualisation) (252 trading days a year on daily bars). First value on bar `period`. A window holding a bad or
// non-positive input has no value.

import { rawPrice } from './cols';
import { finiteOr, points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { len, nanArray, stdevN } from './series';

export interface HistoricalVolatilityOptions extends SourceOptions {
  period?: number;
  annualisation?: number;
}

export function historicalVolatility(rows: readonly IndicatorRow[], options: HistoricalVolatilityOptions = {}): IndicatorPoint[] {
  const src = rawPrice(rows, options.source);
  const ann = finiteOr(options.annualisation, 252) > 0 ? finiteOr(options.annualisation, 252) : 252;
  const ret = nanArray(src.length);
  for (let i = 1; i < src.length; i++) { const r = Math.log(src[i] / src[i - 1]); if (Number.isFinite(r)) ret[i] = r; }
  return points(rows, stdevN(ret, len(options.period, 10)).map(v => 100 * v * Math.sqrt(ann)), null);
}
