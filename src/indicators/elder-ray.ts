// Elder ray.
//
//   elderRay(rows, period = 13) -> { bull, bear }
//
// bull power = high - EMA(close, period), bear power = low - EMA(close, period). EMA seeded with the simple mean of the
// first `period` closes; first value on bar `period - 1`. Draw as histograms. Guide: 0. Needs candlestick rows.

import { hlc } from './cols';
import { period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { emaCore } from './series';

export interface ElderRayResult {
  bull: IndicatorPoint[];
  bear: IndicatorPoint[];
}

export function elderRay(rows: readonly IndicatorRow[], period?: number): ElderRayResult {
  const { h, l, c, bad } = hlc(rows);
  const e = emaCore(c, clampPeriod(period, 13, rows.length + 1));
  return { bull: points(rows, h.map((v, i) => v - e[i]), bad), bear: points(rows, l.map((v, i) => v - e[i]), bad) };
}
