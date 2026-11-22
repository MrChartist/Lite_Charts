// Point and figure series: one bar is one column of boxes, X for a rising column and O for a falling one. A row holds
// the column's lowest and highest box prices (`low`, `high`, both boxes inclusive) and `up`; the `box` option is the
// price of one box, so a column draws `round((high - low) / box) + 1` marks centred on `low + k * box`.
//
// Three looks by size, so it stays legible when small and folds when tiny:
//   glyphs   a mark is at least 5 device px: X as two strokes, O as an ellipse (one path per colour)
//   bars     marks are smaller but a column is 3+ px wide: each column is one bar, solid for X and an outline for O
//   fold     under 3 px per column: one-pixel columns from the lowest to the highest box (shared decimation)

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { hairline } from '../render/pixel';
import { createColumns, decimateColumns } from '../render/decimate';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';

export interface PointFigureData extends RowBase {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  /** X column (true) or O column (false). */
  up: boolean;
}

export interface PointFigureOptions {
  /** Price of one box. Required for marks; the `pointFigure` transform returns the one it used. Default 1. */
  box: number;
  /** Colour of X columns. Defaults to the theme's up colour. */
  upColor?: string;
  /** Colour of O columns. Defaults to the theme's down colour. */
  downColor?: string;
}

const ACCESS = {
  high: (r: PointFigureData) => r.high,
  low: (r: PointFigureData) => r.low,
  first: () => 0,
  last: (r: PointFigureData) => (r.up ? 1 : 0),
};
const folded = createColumns();

/** Smallest glyph side, device px, for X and O strokes; below it the column is drawn as a bar. */
export const GLYPH_MIN = 5;

export interface PointFigureLayout {
  mode: 'glyphs' | 'bars' | 'fold';
  /** Glyph box (device px). */
  gw: number;
  gh: number;
}

/** Look for a column spacing and box height in device px (pure, tested). */
export function pointFigureLayout(spacing: number, cellH: number): PointFigureLayout {
  if (!(spacing >= 3) || !(cellH > 0)) return { mode: 'fold', gw: 0, gh: 0 };
  const gw = Math.min(spacing * 0.8, cellH * 1.25);
  const gh = Math.min(cellH * 0.8, spacing * 1.25);
  return Math.min(gw, gh) >= GLYPH_MIN ? { mode: 'glyphs', gw, gh } : { mode: 'bars', gw, gh };
}

function drawPointFigure(s: SeriesDrawScope<PointFigureData, PointFigureOptions>): void {
  const { ctx, rows, from, to, x, y, options: o, colors, pane } = s;
  const upC = o.upColor ?? colors.up;
  const downC = o.downColor ?? colors.down;
  const box = o.box > 0 && Number.isFinite(o.box) ? o.box : 1;

  // Box height in device px, measured on the first drawable column.
  let cellH = 0;
  for (let i = from; i <= to && cellH === 0; i++) {
    const r = rows[i];
    if (!r) continue;
    const h = Math.abs(y(r.low - box / 2) - y(r.low + box / 2));
    if (Number.isFinite(h)) cellH = h;
  }
  const L = pointFigureLayout(s.barSpacing, cellH);

  if (L.mode === 'fold') {
    const cols = s.decimate ? s.decimate(ACCESS) : decimateColumns(rows, from, to, x, ACCESS, folded);
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let k = 0; k < cols.count; k++) {
        if ((cols.last[k] === 1) !== (pass === 0)) continue;
        const top = Math.round(y(cols.high[k] + box / 2));
        const bottom = Math.round(y(cols.low[k] - box / 2));
        if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
        ctx.rect(cols.x[k], top, 1, Math.max(1, bottom - top));
      }
      ctx.fillStyle = pass === 0 ? upC : downC;
      ctx.fill();
    }
    return;
  }

  if (L.mode === 'bars') {
    const bw = Math.max(1, Math.round(s.barSpacing * 0.6));
    const edge = hairline(s.pixelRatio);
    for (let pass = 0; pass < 2; pass++) {
      const wantUp = pass === 0;
      ctx.beginPath();
      for (let i = from; i <= to; i++) {
        const r = rows[i];
        if (!r || r.up !== wantUp) continue;
        const top = Math.round(y(r.high + box / 2));
        const bottom = Math.round(y(r.low - box / 2));
        if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
        const left = Math.round(x(i) - bw / 2);
        const h = Math.max(1, bottom - top);
        ctx.rect(left, top, bw, h);
        // O columns are outlines (where wide enough to have an inside), X columns are solid.
        if (!wantUp && bw > 2 * edge + 1 && h > 2 * edge + 1) ctx.rect(left + edge, top + edge, bw - 2 * edge, h - 2 * edge);
      }
      ctx.fillStyle = wantUp ? upC : downC;
      ctx.fill('evenodd');
    }
    return;
  }

  // Glyphs: X strokes in one path, O ellipses in another.
  const rx = L.gw / 2;
  const ry = L.gh / 2;
  ctx.lineWidth = Math.max(1, Math.round(Math.min(L.gw, L.gh) * 0.12));
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.setLineDash([]);
  const pad = L.gh + 2;
  const minY = pane.y - pad;
  const maxY = pane.y + pane.height + pad;
  for (let pass = 0; pass < 2; pass++) {
    const wantUp = pass === 0;
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r || r.up !== wantUp) continue;
      const cx = x(i);
      const marks = Math.max(1, Math.round((r.high - r.low) / box) + 1);
      for (let k = 0; k < marks; k++) {
        const cy = y(r.low + k * box);
        if (!(cy > minY && cy < maxY)) continue;
        if (wantUp) {
          ctx.moveTo(cx - rx, cy - ry); ctx.lineTo(cx + rx, cy + ry);
          ctx.moveTo(cx + rx, cy - ry); ctx.lineTo(cx - rx, cy + ry);
        } else {
          ctx.moveTo(cx + rx, cy);
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        }
      }
    }
    ctx.strokeStyle = wantUp ? upC : downC;
    ctx.stroke();
  }
}

function num(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`Chartist Lite: point and figure row needs a finite "${key}" (time ${JSON.stringify(row.time)})`);
  }
  return v;
}

export const PointFigureSeries: SeriesDefinition<PointFigureData, PointFigureOptions> = {
  type: 'pointFigure',
  defaults: { box: 1 },
  normalize(input) {
    if (input.high === undefined && input.low === undefined && input.open === undefined && input.close === undefined) return null;
    const high = num(input, 'high');
    const low = num(input, 'low');
    const hi = Math.max(high, low);
    const lo = Math.min(high, low);
    let up = true;
    let open = lo;
    let close = hi;
    if (typeof input.up === 'boolean') up = input.up;
    else if (typeof input.open === 'number' && typeof input.close === 'number') up = input.close >= input.open;
    if (!up) { open = hi; close = lo; }
    return { time: copyTime(input.time), open, high: hi, low: lo, close, up };
  },
  value: r => r.close,
  // A column spans half a box beyond its end levels.
  low: (r, o) => r.low - (o && o.box > 0 ? o.box / 2 : 0),
  high: (r, o) => r.high + (o && o.box > 0 ? o.box / 2 : 0),
  lastValueColor: (r, o, c) => (r.up ? o.upColor ?? c.up : o.downColor ?? c.down),
  draw: drawPointFigure,
};
