// Supertrend.
//
//   supertrend(rows, { period = 10, multiplier = 3 }?) -> { line, up, down, direction }
//
// Bands at (high + low) / 2 +/- multiplier * ATR(period); the line follows the lower band while the close stays above
// it (uptrend, direction 1) and the upper band in a downtrend (direction -1). The first bar with an ATR starts as a
// downtrend and the state flips when the close crosses the active band. `line` is the whole line; `up` and `down` are
// the same line split by trend (`{ time }` rows where the other trend is active) so each can have its own colour.
// `direction` has one entry per bar (1 during warm-up). Needs candlestick rows (high, low, close).

import { atrValues } from './atr';
import { anyBad, column, finiteOr, period as clampPeriod, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';

export interface SupertrendOptions {
  period?: number;
  multiplier?: number;
}

export interface SupertrendResult {
  line: IndicatorPoint[];
  up: IndicatorPoint[];
  down: IndicatorPoint[];
  direction: (1 | -1)[];
}

export function supertrend(rows: readonly IndicatorRow[], options: SupertrendOptions = {}): SupertrendResult {
  const len = rows.length;
  const p = clampPeriod(options.period, 10, len + 1);
  const mult = finiteOr(options.multiplier, 3);
  const h = column(rows, r => r.high as number);
  const l = column(rows, r => r.low as number);
  const c = column(rows, r => r.close as number);
  const bad = anyBad([h, l, c], len);
  const atrs = atrValues(h.x, l.x, c.x, p);
  const line = new Array<number>(len).fill(NaN);
  const up = new Array<number>(len).fill(NaN);
  const down = new Array<number>(len).fill(NaN);
  const direction = new Array<1 | -1>(len).fill(1);
  let prevUpper = 0, prevLower = 0, prevST = 0;
  for (let i = 0; i < len; i++) {
    const a = atrs[i];
    if (Number.isNaN(a)) continue;
    const hl2 = (h.x[i] + l.x[i]) / 2;
    let upper = hl2 + mult * a;
    let lower = hl2 - mult * a;
    if (i > 0) {
      upper = upper < prevUpper || c.x[i - 1] > prevUpper ? upper : prevUpper;
      lower = lower > prevLower || c.x[i - 1] < prevLower ? lower : prevLower;
    }
    let bull: boolean;
    if (i === 0 || Number.isNaN(atrs[i - 1])) bull = false;
    else if (prevST === prevUpper) bull = c.x[i] > upper;
    else bull = !(c.x[i] < lower);
    const st = bull ? lower : upper;
    line[i] = st;
    (bull ? up : down)[i] = st;
    direction[i] = bull ? 1 : -1;
    prevUpper = upper; prevLower = lower; prevST = st;
  }
  return { line: points(rows, line, bad), up: points(rows, up, bad), down: points(rows, down, bad), direction };
}
