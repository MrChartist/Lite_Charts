// Average true range (Wilder).
//
//   atr(rows, period = 14) -> IndicatorPoint[]
//
// True range of the first bar is high - low, later bars take the largest of high - low, |high - previous close| and
// |low - previous close|. The first ATR (bar `period - 1`) is the mean of the first `period` true ranges, then
// atr = (atr * (period - 1) + tr) / period. Needs candlestick rows (high, low, close).

import { anyBad, column, period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';

/** ATR over finite columns; NaN during warm-up. Also used by supertrend. */
export function atrValues(highs: readonly number[], lows: readonly number[], closes: readonly number[], period: number): number[] {
  const len = closes.length;
  const out = new Array<number>(len).fill(NaN);
  if (len < period) return out;
  let atr = 0;
  for (let i = 0; i < len; i++) {
    const tr = i === 0
      ? highs[0] - lows[0]
      : Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    if (i < period) {
      atr += tr;
      if (i === period - 1) { atr /= period; out[i] = atr; }
    } else {
      atr = (atr * (period - 1) + tr) / period;
      out[i] = atr;
    }
  }
  return out;
}

export function atr(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[] {
  const p = clampPeriod(period, 14, rows.length + 1);
  const h = column(rows, r => r.high as number);
  const l = column(rows, r => r.low as number);
  const c = column(rows, r => r.close as number);
  return points(rows, atrValues(h.x, l.x, c.x, p), anyBad([h, l, c], rows.length));
}
