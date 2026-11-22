// Kagi: a line that extends while price makes new extremes in its direction and turns once price moves `reversal`
// back off the extreme. Each output row is one vertical segment (open = where it starts, close = where it ends);
// segments alternate up and down. Ported from the host's `computeKagi` and `kagiYangYin` (PROVENANCE.md).
//
// Thickness (classic rule): a SHOULDER is the top of an up segment, a WAIST the bottom of a down segment. The line
// turns yang (thick) when an up segment rises above the previous shoulder, and yin (thin) when a down segment falls
// below the previous waist, at that price (`flipAt`), part way along the segment. Otherwise it keeps its thickness. The
// first segment has no earlier shoulder or waist: an up first segment starts yang, a down one yin.

import { cloneTime, isNum, measureSize, priceOf, volumeOf, MAX_ROWS, type BrickRow, type PriceSource, type SizeSpec, type TransformRow } from './shared';

export interface KagiRow extends BrickRow {
  /** Thick (yang) line at the start of the segment. */
  startYang: boolean;
  /** Thick line at the end of the segment. */
  endYang: boolean;
  /** Price where the thickness changes inside this segment, or null. */
  flipAt: number | null;
}

export interface KagiOptions {
  /**
   * Reversal: a price amount, `{ atr: period, multiplier? }`, or `{ percent }` of the extreme (the segment's end).
   * Default `{ percent: 4 }`.
   */
  reversal?: SizeSpec;
  /** Price a bar contributes. Default 'close'. */
  source?: PriceSource;
}

export interface KagiResult {
  rows: KagiRow[];
  /** The reversal used: a percentage of the extreme when `mode` is 'percent', else a price amount. */
  reversal: number;
  mode: 'percent' | 'price';
}

export function kagi(rows: readonly TransformRow[], options: KagiOptions = {}): KagiResult {
  const source = options.source ?? 'close';
  const spec = options.reversal;
  let mode: 'percent' | 'price' = 'percent';
  let reversal = 4;
  if (spec === undefined) { /* default */ }
  else if (typeof spec === 'object' && 'percent' in spec) {
    if (isNum(spec.percent) && spec.percent > 0) reversal = spec.percent;
  } else {
    const size = measureSize(rows, spec, source);
    if (size === size) { mode = 'price'; reversal = size; }
  }
  const pct = reversal / 100;

  const out: KagiRow[] = [];
  let started = false;
  let dir = 0;
  let vertex = 0;
  let pend = 0;
  const start = (index: number, time: TransformRow['time'], from: number, to: number, vol: number): void => {
    if (out.length >= MAX_ROWS) return;
    out.push({
      time: cloneTime(time), open: from, high: Math.max(from, to), low: Math.min(from, to), close: to, volume: vol, sourceIndex: index,
      startYang: false, endYang: false, flipAt: null,
    });
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const price = priceOf(row, source);
    if (price !== price) continue;
    const vol = volumeOf(row);
    if (!started) { started = true; vertex = price; pend = vol; continue; }
    const rev = mode === 'percent' ? vertex * pct : reversal;
    let act = 0; // 0 nothing, 1 extend, 2 start a new segment
    if (dir === 0) {
      if (price - vertex >= rev) { dir = 1; act = 2; }
      else if (vertex - price >= rev) { dir = -1; act = 2; }
    } else if (dir === 1) {
      if (price >= vertex) act = 1;
      else if (vertex - price >= rev) { dir = -1; act = 2; }
    } else if (price <= vertex) act = 1;
    else if (price - vertex >= rev) { dir = 1; act = 2; }

    if (act === 2) {
      start(i, row.time, vertex, price, pend + vol);
      pend = 0;
      vertex = price;
    } else {
      const last = out[out.length - 1];
      if (!last) { pend += vol; continue; }
      last.volume += vol;
      if (act === 1) {
        vertex = price;
        last.close = price;
        if (price > last.high) last.high = price;
        if (price < last.low) last.low = price;
        last.time = cloneTime(row.time);
        last.sourceIndex = i;
      }
    }
  }

  // Thickness pass (the state at any segment depends on every segment before it).
  let yang = out.length > 0 && out[0].close >= out[0].open;
  let shoulder = NaN;
  let waist = NaN;
  for (let k = 0; k < out.length; k++) {
    const seg = out[k];
    seg.startYang = yang;
    if (seg.close >= seg.open) {
      if (!yang && shoulder === shoulder && seg.close > shoulder) { yang = true; seg.flipAt = shoulder; }
      shoulder = seg.close;
    } else {
      if (yang && waist === waist && seg.close < waist) { yang = false; seg.flipAt = waist; }
      waist = seg.close;
    }
    seg.endYang = yang;
  }
  return { rows: out, reversal, mode };
}
