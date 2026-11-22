// Squeeze momentum.
//
//   squeeze(rows, { bbPeriod = 20, bbMult = 2, kcPeriod = 20, kcMult = 1.5 }?) -> { momentum, on, off }
//
// Bollinger bands (SMA +/- bbMult population deviations) inside a Keltner channel (SMA +/- kcMult * SMA of true range), plus a
// momentum line. `on` has a value of 0 on bars where the squeeze is ON (both bands inside the channel: volatility is
// compressed), `off` on bars where it is released (both outside); a bar in neither state has neither. `momentum` is the end of
// the least-squares line through the last `kcPeriod` values of close - ((highest high + lowest low) / 2 + SMA(close)) / 2.
// First value on bar `max(bbPeriod, kcPeriod) - 1`. Causal. Needs candlestick rows. Draw `momentum` as a histogram and the
// states as dots on the zero line.

import { rawCol } from './cols';
import { finiteOr, points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { highestN, len, lowestN, nanArray, smaN, stdevN } from './series';

export interface SqueezeOptions {
  bbPeriod?: number;
  bbMult?: number;
  kcPeriod?: number;
  kcMult?: number;
}

export interface SqueezeResult {
  momentum: IndicatorPoint[];
  on: IndicatorPoint[];
  off: IndicatorPoint[];
}

function linregEnd(x: number[], n: number): number[] {
  const out = nanArray(x.length);
  const sx = (n * (n - 1)) / 2, sxx = ((n - 1) * n * (2 * n - 1)) / 6;
  const den = n * sxx - sx * sx;
  for (let i = n - 1; i < x.length; i++) {
    let sy = 0, sxy = 0;
    for (let j = 0; j < n; j++) { const y = x[i - n + 1 + j]; sy += y; sxy += j * y; }
    if (!Number.isFinite(sy) || !Number.isFinite(sxy)) continue;
    const slope = den === 0 ? 0 : (n * sxy - sx * sy) / den;
    out[i] = (sy - slope * sx) / n + slope * (n - 1);
  }
  return out;
}

export function squeeze(rows: readonly IndicatorRow[], options: SqueezeOptions = {}): SqueezeResult {
  const n = rows.length;
  const bbLen = len(options.bbPeriod, 20), kcLen = len(options.kcPeriod, 20);
  const bbMult = Math.max(0, finiteOr(options.bbMult ?? 2, 2)), kcMult = Math.max(0, finiteOr(options.kcMult ?? 1.5, 1.5));
  const c = rawCol(rows, r => r.close as number), h = rawCol(rows, r => r.high as number), l = rawCol(rows, r => r.low as number);
  const tr = c.map((_, i) => (i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
  const bbMid = smaN(c, bbLen), bbDev = stdevN(c, bbLen);
  const kcMid = smaN(c, kcLen), kcRange = smaN(tr, kcLen);
  const hh = highestN(h, kcLen), ll = lowestN(l, kcLen);
  const mom = linregEnd(c.map((v, i) => v - ((hh[i] + ll[i]) / 2 + kcMid[i]) / 2), kcLen);
  const on = nanArray(n), off = nanArray(n);
  for (let i = 0; i < n; i++) {
    const ub = bbMid[i] + bbMult * bbDev[i], lb = bbMid[i] - bbMult * bbDev[i];
    const uk = kcMid[i] + kcMult * kcRange[i], lk = kcMid[i] - kcMult * kcRange[i];
    if (![ub, lb, uk, lk].every(Number.isFinite)) continue;
    if (lb > lk && ub < uk) on[i] = 0;
    if (lb < lk && ub > uk) off[i] = 0;
  }
  return { momentum: points(rows, mom, null), on: points(rows, on, null), off: points(rows, off, null) };
}
