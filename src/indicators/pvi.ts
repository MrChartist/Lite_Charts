// Positive volume index.
//
//   positiveVolumeIndex(rows, start = 1000) -> IndicatorPoint[]
//
// Starts at `start` and moves only on bars where volume rose against the previous bar, by that bar's percent price change.
// Value on every bar with a usable close and volume. Needs candlestick rows with volume.

import { volumeIndex } from './volume-index';
import type { IndicatorPoint, IndicatorRow } from './shared';

export function positiveVolumeIndex(rows: readonly IndicatorRow[], start?: number): IndicatorPoint[] {
  return volumeIndex(rows, start, false);
}
