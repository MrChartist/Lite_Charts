// Point and figure: classic box-size, N-box-reversal columns over prices. A column extends while price makes a new box
// in its direction; it reverses once price is `reversal` boxes back the other way, and the new column starts one box in
// from the old column's terminal box (so two adjacent columns never both claim the same cell). Ported from the host's
// `computePointFigure`.
//
// A column stores its lowest and highest box LEVEL (price = level x box), both inclusive: it draws
// `round((high - low) / box) + 1` marks. Up columns are X, down columns O. The last column is the one still forming.

import { cloneTime, autoBoxSize, priceOf, resolveSize, volumeOf, MAX_ROWS, type BrickRow, type PriceSource, type SizeSpec, type TransformRow } from './shared';

export interface PointFigureRow extends BrickRow {
  /** true for an X column (rising), false for an O column. */
  up: boolean;
}

export interface PointFigureOptions {
  /** Box size: a price amount, `{ atr: period }`, `{ percent }`. Default: about 60 boxes across the data. */
  box?: SizeSpec;
  /** Boxes of reversal. Default 3; a whole number from 1 to 20. */
  reversal?: number;
  /** Price a bar contributes. Default 'close'. */
  source?: PriceSource;
}

export interface PointFigureResult {
  rows: PointFigureRow[];
  /** The box size used. */
  box: number;
  /** The reversal, in boxes. */
  reversal: number;
}

export function pointFigure(rows: readonly TransformRow[], options: PointFigureOptions = {}): PointFigureResult {
  const source = options.source ?? 'close';
  const box = resolveSize(rows, options.box, source, autoBoxSize);
  const rv = typeof options.reversal === 'number' && Number.isFinite(options.reversal) ? Math.min(20, Math.max(1, Math.floor(options.reversal))) : 3;
  const out: PointFigureRow[] = [];

  let started = false;
  let dir = 0;
  let colLow = 0;
  let colHigh = 0;
  let colTime: TransformRow['time'] = 0;
  let colIndex = 0;
  let colVol = 0;
  const push = (up: boolean): void => {
    if (out.length >= MAX_ROWS) return;
    out.push({
      time: cloneTime(colTime), volume: colVol, sourceIndex: colIndex, up,
      open: up ? colLow * box : colHigh * box, close: up ? colHigh * box : colLow * box, high: colHigh * box, low: colLow * box,
    });
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const price = priceOf(row, source);
    if (price !== price) continue;
    const vol = volumeOf(row);
    const b = Math.round(price / box);
    if (!started) {
      started = true;
      colLow = colHigh = b;
      colTime = row.time; colIndex = i; colVol = vol;
      continue;
    }
    if (dir === 0) {
      colVol += vol;
      if (b > colHigh) { dir = 1; colHigh = b; colTime = row.time; colIndex = i; }
      else if (b < colLow) { dir = -1; colLow = b; colTime = row.time; colIndex = i; }
    } else if (dir === 1) {
      if (b > colHigh) { colVol += vol; colHigh = b; colTime = row.time; colIndex = i; }
      else if (colHigh - b >= rv) {
        push(true);
        colLow = b; colHigh = colHigh - 1; dir = -1; colTime = row.time; colIndex = i; colVol = vol;
      } else colVol += vol;
    } else if (b < colLow) { colVol += vol; colLow = b; colTime = row.time; colIndex = i; }
    else if (b - colLow >= rv) {
      push(false);
      colHigh = b; colLow = colLow + 1; dir = 1; colTime = row.time; colIndex = i; colVol = vol;
    } else colVol += vol;
  }
  if (started) push(dir !== -1);
  return { rows: out, box, reversal: rv };
}
