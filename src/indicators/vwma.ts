// Volume-weighted moving average.
//
//   vwma(rows, period = 20, { source }?) -> IndicatorPoint[]
//
// sum(price * volume) / sum(volume) over the last `period` bars, first value on bar `period - 1`: busy bars count more.
// A window that holds a bad price or volume, or has no volume at all, has no value. Needs volume.

import { rawCol, rawPrice } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { len, vwmaN } from './series';

export function vwma(rows: readonly IndicatorRow[], period?: number, options: SourceOptions = {}): IndicatorPoint[] {
  const vol = rawCol(rows, r => r.volume as number);
  return points(rows, vwmaN(rawPrice(rows, options.source), vol, len(period, 20)), null);
}
