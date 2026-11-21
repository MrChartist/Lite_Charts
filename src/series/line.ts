// Line series. One path per frame; when bars are closer than one device pixel each pixel column draws its first,
// lowest, highest and last value, so the shape of a 100k-point line survives any zoom at the cost of one column.

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
    let col = NaN;
    let lo = 0;
    let hi = 0;
    let last = 0;
    const flush = (): void => {
      if (Number.isNaN(col)) return;
      ctx.lineTo(col, lo);
      ctx.lineTo(col, hi);
      ctx.lineTo(col, last);
    };
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      const yy = r ? y(r.value) : NaN;
      if (!Number.isFinite(yy)) { flush(); col = NaN; pen = false; continue; }
      const c = Math.floor(x(i)) + 0.5;
      if (c !== col) {
        flush();
        col = c;
        if (!pen) { ctx.moveTo(c, yy); pen = true; } else ctx.lineTo(c, yy);
        lo = yy; hi = yy;
      } else {
        if (yy < lo) lo = yy;
        if (yy > hi) hi = yy;
      }
      last = yy;
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
