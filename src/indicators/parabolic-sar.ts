// Parabolic SAR (Wilder).
//
//   parabolicSar(rows, { step = 0.02, max = 0.2 }?) -> { line, up, down, direction }
//
// Trailing dots that speed up as a trend runs. Seeded on bar 1 (long when close[1] > close[0]); every bar
// SAR += AF * (EP - SAR); a long whose SAR is above the bar's low (a short whose SAR is below its high) reverses, the new
// SAR being the old extreme point pushed outside the reversal bar's range; otherwise a new extreme moves EP and steps AF
// by `step` up to `max`; last, SAR is held beyond the previous two bars' lows (long) or highs (short). First value on
// bar 1. `line` is every dot; `up` (dots below price, long) and `down` (dots above, short) split it so each can have a
// colour; `direction` is 1 (long) or -1 per bar (1 on bar 0). Needs candlestick rows.

import { rawCol, hl } from './cols';
import { finiteOr, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export interface SarOptions {
  step?: number;
  max?: number;
}

export interface SarResult {
  line: IndicatorPoint[];
  up: IndicatorPoint[];
  down: IndicatorPoint[];
  direction: (1 | -1)[];
}

export function parabolicSar(rows: readonly IndicatorRow[], options: SarOptions = {}): SarResult {
  const n = rows.length;
  const step = finiteOr(options.step, 0.02), max = finiteOr(options.max, 0.2);
  const { h, l, bad } = hl(rows);
  const closes = rawCol(rows, r => r.close as number);
  const line = nanArray(n), up = nanArray(n), down = nanArray(n);
  const direction = new Array<1 | -1>(n).fill(1);
  if (n >= 2) {
    const af0 = step;
    let isUp = Number.isFinite(closes[1]) && Number.isFinite(closes[0]) ? closes[1] > closes[0] : h[1] > h[0];
    let af = af0;
    let ep = isUp ? h[1] : l[1];
    let sar = isUp ? l[0] : h[0];
    for (let i = 1; i < n; i++) {
      sar = sar + af * (ep - sar);
      let reversed = false;
      if (isUp) {
        if (sar > l[i]) { reversed = true; isUp = false; sar = Math.max(h[i], ep); ep = l[i]; af = af0; }
      } else if (sar < h[i]) { reversed = true; isUp = true; sar = Math.min(l[i], ep); ep = h[i]; af = af0; }
      if (!reversed) {
        if (isUp) { if (h[i] > ep) { ep = h[i]; af = Math.min(af + step, max); } }
        else if (l[i] < ep) { ep = l[i]; af = Math.min(af + step, max); }
      }
      if (isUp) { sar = Math.min(sar, l[i - 1]); if (i > 1) sar = Math.min(sar, l[i - 2]); }
      else { sar = Math.max(sar, h[i - 1]); if (i > 1) sar = Math.max(sar, h[i - 2]); }
      line[i] = sar;
      (isUp ? up : down)[i] = sar;
      direction[i] = isUp ? 1 : -1;
    }
  }
  return { line: points(rows, line, bad), up: points(rows, up, bad), down: points(rows, down, bad), direction };
}
