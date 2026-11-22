// Kagi series: the classic yang / yin line. One bar is one vertical segment (`open` to `close`) joined to the next by
// a horizontal turn. The line is thick (yang, up colour) after it breaks above the previous shoulder and thin (yin,
// down colour) after it breaks below the previous waist; the change happens AT that price (`flipAt`), so one stroke
// can be thin below the old shoulder and thick above it. The transform (`kagi` in the transforms entry) writes
// `startYang`, `endYang` and `flipAt` on each row, which makes every row self-contained: only visible rows are drawn.
// Rows without those fields take their thickness from their own direction (up thick, down thin).
//
// Drawing: two strokes per frame (yang path, yin path), each one continuous zig-zag polyline broken only where the
// thickness changes. Stems and joins are on whole device pixels (both widths share one parity so a thick piece meets a
// thin one on the same pixel line). Under 2 device px per segment the rows fold to one-pixel columns.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { deviceWidth } from '../render/pixel';
import { createColumns, decimateColumns } from '../render/decimate';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';

export interface KagiData extends RowBase {
  time: Time;
  open: number;
  close: number;
  high: number;
  low: number;
  startYang?: boolean;
  endYang?: boolean;
  flipAt?: number | null;
}

export interface KagiOptions {
  /** Colour of the thick (yang) line. Defaults to the theme's up colour. */
  yangColor?: string;
  /** Colour of the thin (yin) line. Defaults to the theme's down colour. */
  yinColor?: string;
  /** CSS px. Default 3. */
  yangWidth: number;
  /** CSS px. Default 1.25. */
  yinWidth: number;
}

const ACCESS = {
  high: (r: KagiData) => r.high,
  low: (r: KagiData) => r.low,
  first: () => 0,
  last: (r: KagiData) => ((r.endYang ?? r.close >= r.open) ? 1 : 0),
};
const folded = createColumns();

function snap(v: number, w: number): number {
  return w % 2 === 1 ? Math.floor(v) + 0.5 : Math.round(v);
}

function drawKagi(s: SeriesDrawScope<KagiData, KagiOptions>): void {
  const { ctx, rows, from, to, x, y, options: o, colors } = s;
  const yang = o.yangColor ?? colors.up;
  const yin = o.yinColor ?? colors.down;

  if (s.barSpacing < 2) {
    const cols = s.decimate ? s.decimate(ACCESS) : decimateColumns(rows, from, to, x, ACCESS, folded);
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let k = 0; k < cols.count; k++) {
        if ((cols.last[k] === 1) !== (pass === 0)) continue;
        const top = Math.round(y(cols.high[k]));
        const bottom = Math.round(y(cols.low[k]));
        if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
        ctx.rect(cols.x[k], top, 1, Math.max(1, bottom - top));
      }
      ctx.fillStyle = pass === 0 ? yang : yin;
      ctx.fill();
    }
    return;
  }

  // Widths on one parity, thin no wider than half a segment, thick no wider than three quarters.
  let wYin = Math.min(deviceWidth(o.yinWidth, s.pixelRatio), Math.max(1, Math.floor(s.barSpacing * 0.5)));
  if (wYin < 1) wYin = 1;
  let wYang = Math.min(deviceWidth(o.yangWidth, s.pixelRatio), Math.max(wYin, Math.floor(s.barSpacing * 0.75)));
  wYang = Math.max(wYin, wYin + 2 * Math.round((wYang - wYin) / 2));

  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  for (let pass = 0; pass < 2; pass++) {
    const wantYang = pass === 0;
    ctx.beginPath();
    let pen = false;
    // One piece of the line in the thickness `isYang`; a piece of the other thickness breaks this pass's subpath.
    const piece = (isYang: boolean, x0: number, y0: number, x1: number, y1: number): void => {
      if (isYang !== wantYang) { pen = false; return; }
      if (!pen) { ctx.moveTo(x0, y0); pen = true; }
      ctx.lineTo(x1, y1);
    };
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r) { pen = false; continue; }
      const own = r.close >= r.open;
      const sy = r.startYang ?? own;
      const ey = r.endYang ?? own;
      const cx = snap(x(i), wYin);
      const yo = snap(y(r.open), wYin);
      const yc = snap(y(r.close), wYin);
      if (!Number.isFinite(cx) || !Number.isFinite(yo) || !Number.isFinite(yc)) { pen = false; continue; }
      if (r.flipAt !== undefined && r.flipAt !== null) {
        const yf = snap(y(r.flipAt), wYin);
        if (Number.isFinite(yf)) { piece(sy, cx, yo, cx, yf); piece(ey, cx, yf, cx, yc); }
        else piece(ey, cx, yo, cx, yc);
      } else piece(ey, cx, yo, cx, yc);
      const next = i < to ? rows[i + 1] : null;
      if (next) piece(ey, cx, yc, snap(x(i + 1), wYin), yc);
      else pen = false;
    }
    ctx.lineWidth = wantYang ? wYang : wYin;
    ctx.strokeStyle = wantYang ? yang : yin;
    ctx.stroke();
  }
}

function num(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`Chartist Lite: Kagi row needs a finite "${key}" (time ${JSON.stringify(row.time)})`);
  }
  return v;
}

export const KagiSeries: SeriesDefinition<KagiData, KagiOptions> = {
  type: 'kagi',
  defaults: { yangWidth: 3, yinWidth: 1.25 },
  normalize(input) {
    if (input.open === undefined && input.close === undefined) return null;
    const open = num(input, 'open');
    const close = num(input, 'close');
    const row: KagiData = { time: copyTime(input.time), open, close, high: Math.max(open, close), low: Math.min(open, close) };
    // The segment's range is its own open and close; a high / low given beyond them is kept.
    const h = input.high;
    const l = input.low;
    if (typeof h === 'number' && Number.isFinite(h) && h > row.high) row.high = h;
    if (typeof l === 'number' && Number.isFinite(l) && l < row.low) row.low = l;
    if (typeof input.startYang === 'boolean') row.startYang = input.startYang;
    if (typeof input.endYang === 'boolean') row.endYang = input.endYang;
    const f = input.flipAt;
    if (typeof f === 'number' && Number.isFinite(f)) row.flipAt = f;
    return row;
  },
  value: r => r.close,
  low: r => r.low,
  high: r => r.high,
  lastValueColor: (r, o, c) => ((r.endYang ?? r.close >= r.open) ? o.yangColor ?? c.up : o.yinColor ?? c.down),
  draw: drawKagi,
};
