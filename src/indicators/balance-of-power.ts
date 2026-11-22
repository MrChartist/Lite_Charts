// Balance of power.
//
//   balanceOfPower(rows, smooth = 14) -> IndicatorPoint[]
//
// (close - open) / (high - low), smoothed with an SMA of `smooth` bars (1 or less leaves it raw). Runs from -1 (sellers
// controlled the bar) to 1 (buyers). A zero-range bar has no value and blanks any smoothing window it sits in. First value on
// bar `smooth - 1`. Needs candlestick rows. Guide: 0.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { len, nanArray, smaN } from './series';

export function balanceOfPower(rows: readonly IndicatorRow[], smooth?: number): IndicatorPoint[] {
  const raw = nanArray(rows.length);
  const o = rawCol(rows, r => r.open as number), h = rawCol(rows, r => r.high as number), l = rawCol(rows, r => r.low as number), c = rawCol(rows, r => r.close as number);
  for (let i = 0; i < raw.length; i++) {
    const range = h[i] - l[i];
    const v = range !== 0 ? (c[i] - o[i]) / range : NaN;
    if (Number.isFinite(v)) raw[i] = v;
  }
  const s = len(smooth, 14);
  return points(rows, s <= 1 ? raw : smaN(raw, s), null);
}
