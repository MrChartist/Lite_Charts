// Where the price axis puts its ticks, chosen in pixels. Pure.
//
//  - linear: multiples of a 1-2-5 step, coarsened until every gap clears `minGapPx`, never finer than `minStep`
//    (the series' minimum move, so two ticks never print the same text).
//  - log: a ladder of round prices per decade, the densest that fits (1..9, then 1-2-3-5-7, then 1-2-5, then 1, then
//    every Nth decade); inside one decade the finer of that ladder and a linear step wins.
//  - percent: round percentages from `anchor` (0% always included when in range).
// Ported from the host engine's price-tick generator (PROVENANCE.md).

export type PriceTickMode = 'linear' | 'log' | 'percent';

export interface PriceTickInput {
  pMin: number;
  pMax: number;
  /** Pixel height the range spans. */
  priceH: number;
  mode: PriceTickMode;
  /** Least vertical distance between two ticks, CSS px. */
  minGapPx: number;
  /** Percent mode: the price that reads 0%. */
  anchor?: number;
  /** Linear mode: smallest allowed step (the minimum price move). */
  minStep?: number;
}

export interface PriceTick {
  price: number;
  /** Percent mode: the tick's change from the anchor, in percent. */
  pct?: number;
}

const MAX_TICKS = 64;
const LOG_LADDERS: readonly (readonly number[])[] = [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 5, 7], [1, 2, 5], [1]];

/** The 1-2-5 x 10^n step at or above `range / target`. */
export function niceStep(range: number, target: number): number {
  if (!(range > 0) || !(target > 0)) return 1;
  const rough = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** The next coarser step on the 1-2-5 ladder. */
export function nextNiceStep(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(step)));
  const n = step / pow;
  if (n < 1.5) return 2 * pow;
  if (n < 3.5) return 5 * pow;
  return 10 * pow;
}

/** Decimals a 1-2-5 step needs so no two ticks print alike (0..10). */
export function stepDecimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  for (let d = 0; d <= 10; d++) {
    const scaled = step * Math.pow(10, d);
    if (Math.abs(scaled - Math.round(scaled)) < 1e-7 * Math.max(1, scaled)) return d;
  }
  return 10;
}

function linearTicks(pMin: number, pMax: number, priceH: number, minGapPx: number, log: boolean, minStep: number, maxTicks: number): number[] {
  const range = pMax - pMin;
  const target = Math.max(1, Math.min(maxTicks, Math.floor(priceH / Math.max(1, minGapPx))));
  let step = niceStep(range, target);
  // A log axis is judged at its tightest end: the top, where prices bunch.
  const lnMax = Math.log(pMax);
  const lnSpan = log ? lnMax - Math.log(pMin) : 1;
  const gapAt = (s: number): number => (log
    ? ((lnMax - Math.log(Math.max(pMin, pMax - s))) / lnSpan) * priceH
    : (s / range) * priceH);
  for (let guard = 0; guard < 24 && (gapAt(step) < minGapPx || step < minStep * (1 - 1e-9)); guard++) step = nextNiceStep(step);
  const first = Math.ceil(pMin / step - 1e-9) * step;
  const count = Math.max(0, Math.min(MAX_TICKS, Math.floor((pMax - first) / step + 1e-9) + 1));
  const out: number[] = [];
  // Indexed, not accumulated: immune to the float drift of `p += step`.
  for (let i = 0; i < count; i++) out.push(first + i * step);
  return out;
}

function ladderPrices(pMin: number, pMax: number, mantissas: readonly number[], stride: number): number[] {
  const out: number[] = [];
  const startPow = Math.floor(Math.log10(pMin));
  const endPow = Math.ceil(Math.log10(pMax));
  for (let pow = startPow; pow <= endPow; pow++) {
    if (((pow % stride) + stride) % stride !== 0) continue;
    for (const m of mantissas) {
      const v = m * Math.pow(10, pow);
      if (v >= pMin * (1 - 1e-12) && v <= pMax * (1 + 1e-12)) out.push(v);
    }
  }
  return out;
}

function logTicks(pMin: number, pMax: number, priceH: number, minGapPx: number, minStep: number): number[] {
  const maxCount = Math.max(3, Math.min(12, Math.floor(priceH / (Math.max(1, minGapPx) * 1.6))));
  const lnMin = Math.log(pMin);
  const lnSpan = Math.log(pMax) - lnMin;
  const yOf = (p: number): number => ((Math.log(p) - lnMin) / lnSpan) * priceH;
  const subDecade = Math.log10(pMax / pMin) < 1;
  const minCount = subDecade ? 3 : 1;
  let ladder: number[] | null = null;
  search: for (let stride = 1; stride <= 12; stride++) {
    const ladders = stride === 1 ? LOG_LADDERS : [LOG_LADDERS[LOG_LADDERS.length - 1]];
    for (const mantissas of ladders) {
      const prices = ladderPrices(pMin, pMax, mantissas, stride);
      if (prices.length < minCount || prices.length > maxCount) continue;
      let gap = Infinity;
      for (let i = 1; i < prices.length; i++) gap = Math.min(gap, yOf(prices[i]) - yOf(prices[i - 1]));
      if (prices.length >= 2 && gap < minGapPx) continue;
      ladder = prices;
      break search;
    }
  }
  if (ladder && !subDecade) return ladder;
  const linear = linearTicks(pMin, pMax, priceH, minGapPx, true, minStep, maxCount);
  return ladder && ladder.length >= linear.length ? ladder : linear;
}

/** Ticks for the price axis, ascending. Empty for a range that cannot be drawn. */
export function priceTicks(input: PriceTickInput): PriceTick[] {
  const { pMin, pMax, priceH, minGapPx } = input;
  if (!Number.isFinite(pMin) || !Number.isFinite(pMax) || !(pMax > pMin) || !(priceH > 0) || !Number.isFinite(minGapPx)) return [];
  const minStep = input.minStep && input.minStep > 0 ? input.minStep : 0;
  if (input.mode === 'percent') {
    const anchor = input.anchor ?? NaN;
    if (!(anchor > 0) && !(anchor < 0)) return [];
    // Change from the anchor over |anchor| (the price scale's percent mode), so a negative anchor reads the same way.
    const k = Math.abs(anchor) / 100;
    const lo = Math.min((pMin - anchor) / k, (pMax - anchor) / k);
    const hi = Math.max((pMin - anchor) / k, (pMax - anchor) / k);
    const out: PriceTick[] = linearTicks(lo, hi, priceH, minGapPx, false, 0, 8)
      .map(pct => ({ price: anchor + k * pct, pct: Math.abs(pct) < 1e-9 ? 0 : pct }));
    return out.sort((a, b) => a.price - b.price);
  }
  const prices = input.mode === 'log' && pMin > 0
    ? logTicks(pMin, pMax, priceH, minGapPx, minStep)
    : linearTicks(pMin, pMax, priceH, minGapPx, false, minStep, 8);
  return prices.map(price => ({ price }));
}
