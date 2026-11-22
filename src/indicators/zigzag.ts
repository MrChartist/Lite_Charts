// ZigZag.
//
//   zigzag(rows, { deviation = 5, legs = 10 }?) -> IndicatorPoint[]
//
// A line through the main swings: swing points alternate high / low, each at least `deviation` percent away from the last
// and a pivot over `legs` bars on each side (see `pivotHighLow`); between two swing points the line is straight, so the
// output has a value on every bar from the first swing point to the last. Streaming and causal, with one honest exception: the
// last leg runs to the running extreme after the last confirmed swing and is redrawn as bars arrive (a same-kind new extreme
// replaces the last confirmed point). Needs candlestick rows. Bars before the first swing point have no value.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';
import { scanPivots } from './pivot-high-low';

export interface ZigZagOptions {
  /** Minimum percent move between swing points. Default 5. */
  deviation?: number;
  /** Bars each side of a pivot. Default 10. */
  legs?: number;
}

interface Point { index: number; price: number; kind: 'high' | 'low' }

const movePct = (from: number, to: number): number => (from === 0 ? Infinity : (Math.abs(to - from) / Math.abs(from)) * 100);

function tailExtreme(values: readonly number[], after: number, high: boolean): { index: number; price: number } | null {
  let best: { index: number; price: number } | null = null;
  for (let i = after + 1; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (best === null || (high ? v > best.price : v < best.price)) best = { index: i, price: v };
  }
  return best;
}

export function zigzag(rows: readonly IndicatorRow[], options: ZigZagOptions = {}): IndicatorPoint[] {
  const n = rows.length;
  const deviation = Number.isFinite(options.deviation) && (options.deviation as number) >= 0 ? (options.deviation as number) : 5;
  const legs = Number.isFinite(options.legs) ? Math.max(1, Math.floor(options.legs as number)) : 10;
  const H = rawCol(rows, r => r.high as number), L = rawCol(rows, r => r.low as number);
  const piv = scanPivots(H, L, legs, legs);
  const pts: Point[] = [];
  const consider = (index: number, price: number, kind: 'high' | 'low'): void => {
    const last = pts[pts.length - 1];
    const point: Point = { index, price, kind };
    if (!last) { pts.push(point); return; }
    if (last.index === index) return;
    if (last.kind === kind) {
      if (kind === 'high' ? price > last.price : price < last.price) pts[pts.length - 1] = point;
      return;
    }
    const rightSide = kind === 'high' ? price > last.price : price < last.price;
    if (rightSide && movePct(last.price, price) >= deviation) pts.push(point);
  };
  for (let i = 0; i < n; i++) {
    const hasHigh = !Number.isNaN(piv.high[i]), hasLow = !Number.isNaN(piv.low[i]);
    if (!hasHigh && !hasLow) continue;
    const lowFirst = pts[pts.length - 1]?.kind === 'high';
    if (lowFirst && hasLow) consider(i, piv.low[i], 'low');
    if (hasHigh) consider(i, piv.high[i], 'high');
    if (!lowFirst && hasLow) consider(i, piv.low[i], 'low');
  }
  const last = pts[pts.length - 1];
  if (last) {
    const same = tailExtreme(last.kind === 'high' ? H : L, last.index, last.kind === 'high');
    const displaces = same !== null && (last.kind === 'high' ? same.price > last.price : same.price < last.price);
    if (displaces && same) { pts.pop(); pts.push({ ...same, kind: last.kind }); }
    else {
      const otherKind = last.kind === 'high' ? 'low' : 'high';
      const opposite = tailExtreme(otherKind === 'high' ? H : L, last.index, otherKind === 'high');
      if (opposite && movePct(last.price, opposite.price) >= deviation) pts.push({ ...opposite, kind: otherKind });
    }
  }
  const out = nanArray(n);
  if (pts.length === 1 && pts[0].index >= 0 && pts[0].index < n) out[pts[0].index] = pts[0].price;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    const span = b.index - a.index;
    if (span <= 0 || a.index < 0 || b.index >= n) continue;
    for (let i = a.index; i <= b.index; i++) out[i] = a.price + ((b.price - a.price) * (i - a.index)) / span;
  }
  return points(rows, out, null);
}
