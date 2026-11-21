// Line series. One path per frame; when bars are closer than one device pixel each pixel column draws its
// lowest and highest value, so the shape of a 100k-point line survives any zoom at the cost of one column.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { deviceWidth } from '../render/pixel';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';

export interface LineData extends RowBase {
  time: Time;
  value: number;
}

export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface LineOptions {
  /** Defaults to the theme's line colour. */
  color?: string;
  /** CSS px. */
  lineWidth: number;
  lineStyle: LineStyle;
  /** 'simple' joins points directly; 'step' holds each value until the next bar. */
  lineType: 'simple' | 'step';
  /** Dot at the hovered value while the crosshair is on. */
  crosshairMarkerVisible: boolean;
}

export function applyLineStyle(ctx: CanvasRenderingContext2D, style: LineStyle, widthDev: number): void {
  if (style === 'dashed') ctx.setLineDash([widthDev * 3, widthDev * 2]);
  else if (style === 'dotted') ctx.setLineDash([widthDev, widthDev * 1.5]);
  else ctx.setLineDash([]);
}

function drawLine(s: SeriesDrawScope<LineData, LineOptions>): void {
  const { ctx, rows, from, to, x, y, options: o } = s;
  const w = deviceWidth(o.lineWidth, s.pixelRatio);
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = o.color ?? s.colors.line;
  applyLineStyle(ctx, o.lineStyle, w);
  ctx.beginPath();
  const step = o.lineType === 'step';
  let pen = false;
  let prevY = 0;

  if (s.barSpacing >= 1 || step) {
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      const yy = r ? y(r.value) : NaN;
      if (!Number.isFinite(yy)) { pen = false; continue; }
      const xx = x(i);
      if (!pen) { ctx.moveTo(xx, yy); pen = true; }
      else if (step) { ctx.lineTo(xx, prevY); ctx.lineTo(xx, yy); }
      else ctx.lineTo(xx, yy);
      prevY = yy;
    }
  } else {
    // Compressed form: per device-pixel column the lowest and highest value, folded in price space in one pass (y is
    // computed twice per column, not per row; whole blocks of rows inside a column use their cached min / max). A whitespace row or a value that is not finite breaks
    // the line, as at full zoom.
    let col = Number.NaN;
    let open = false;
    let lo = 0;
    let hi = 0;
    let first = 0;
    // Each canvas call crosses into the browser, so a column gets as few vertices as show the same pixels: one when
    // its range is under a device pixel, else its two extremes, nearer one first (the trace then covers the column's
    // whole range and continues from its far end; within one pixel column that is the same picture).
    let prevY = Number.NaN;
    // One fold column per CSS pixel (2 device px at 2x): the same picture at this density, half the vertices.
    const cw = Math.max(1, Math.floor(s.pixelRatio));
    const flush = (): void => {
      if (!open) return;
      open = false;
      const cx = col * cw + cw / 2;
      const yh = y(hi);
      const yl = y(lo);
      if (!Number.isFinite(yh) || !Number.isFinite(yl)) { pen = false; return; }
      if (Math.abs(yh - yl) < 1) {
        const ym = (yh + yl) / 2;
        if (!pen) { ctx.moveTo(cx, ym); pen = true; } else ctx.lineTo(cx, ym);
        prevY = ym;
        return;
      }
      const a = pen && Math.abs(prevY - yl) < Math.abs(prevY - yh) ? yl : yh;
      const b = a === yh ? yl : yh;
      if (!pen) { ctx.moveTo(cx, y(first)); pen = true; }
      ctx.lineTo(cx, a);
      ctx.lineTo(cx, b);
      prevY = b;
    };
    const vals = s.values;
    const slots = s.slots;
    if (vals && slots && s.xStep !== undefined && s.xOrigin !== undefined) {
      // Typed fast path: values and slots from the chart's arrays, no object reads or closures per row. Rows of one
      // pixel column are folded until the slot passes the column's right edge (no floor per row).
      const x0 = s.xOrigin;
      const xs = s.xStep;
      let edge = -Infinity;
      const vb = s.valueBlocks;
      const B = vb ? vb.size : 0;
      for (let i = from; i <= to; i++) {
        // A whole block inside the open column: its precomputed min / max instead of its rows.
        if (vb && open && i % B === 0 && i + B - 1 <= to && slots[i + B - 1] < edge) {
          const k = i / B;
          const bmin = vb.min[k];
          if (bmin === bmin) {
            if (bmin < lo) lo = bmin;
            if (vb.max[k] > hi) hi = vb.max[k];
            i += B - 1;
            continue;
          }
        }
        const v = vals[i];
        if (v !== v || v === Infinity || v === -Infinity) { flush(); pen = false; col = Number.NaN; edge = -Infinity; continue; }
        const sl = slots[i];
        if (sl < edge) { if (v < lo) lo = v; else if (v > hi) hi = v; continue; }
        flush();
        col = Math.floor((x0 + xs * sl) / cw);
        edge = ((col + 1) * cw - x0) / xs;
        lo = hi = first = v;
        open = true;
      }
    } else {
      for (let i = from; i <= to; i++) {
        const r = rows[i];
        const v = r ? r.value : Number.NaN;
        if (!Number.isFinite(v)) { flush(); pen = false; col = Number.NaN; continue; }
        const c = Math.floor(x(i) / cw);
        if (c !== col) { flush(); col = c; lo = hi = first = v; open = true; }
        else { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
    }
    flush();
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

export const LineSeries: SeriesDefinition<LineData, LineOptions> = {
  type: 'line',
  defaults: { lineWidth: 2, lineStyle: 'solid', lineType: 'simple', crosshairMarkerVisible: true },
  normalize(input) {
    if (input.value === undefined) return null;
    const v = input.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`Chartist Lite: line row needs a finite "value" (time ${JSON.stringify(input.time)})`);
    }
    return { time: copyTime(input.time), value: v };
  },
  value: r => r.value,
  low: r => r.value,
  high: r => r.value,
  lastValueColor: (_r, o, c) => o.color ?? c.line,
  draw: drawLine,
  crosshairMarker: (r, o, c) => (o.crosshairMarkerVisible ? { price: r.value, color: o.color ?? c.line } : null),
};
