// Line series. One path per frame; when bars are closer than one device pixel each pixel column draws its first,
// lowest, highest and last value, so the shape of a 100k-point line survives any zoom at the cost of one column.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { deviceWidth } from '../render/pixel';
import { decimateColumns } from '../render/decimate';
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

const ACCESS = {
  high: (r: LineData) => r.value,
  low: (r: LineData) => r.value,
};

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
    // Compressed form: per device-pixel column the first, lowest, highest and last value. A whitespace row or a value
    // that cannot be drawn breaks the line, as at full zoom.
    let a = from;
    while (a <= to) {
      while (a <= to && !(rows[a] && Number.isFinite(y((rows[a] as LineData).value)))) a++;
      let b = a;
      while (b + 1 <= to && rows[b + 1] && Number.isFinite(y((rows[b + 1] as LineData).value))) b++;
      if (a > to) break;
      const cols = decimateColumns(rows, a, b, x, ACCESS);
      for (let k = 0; k < cols.count; k++) {
        const cx = cols.x[k] + 0.5;
        if (k === 0) ctx.moveTo(cx, y(cols.first[k])); else ctx.lineTo(cx, y(cols.first[k]));
        ctx.lineTo(cx, y(cols.high[k]));
        ctx.lineTo(cx, y(cols.low[k]));
        ctx.lineTo(cx, y(cols.last[k]));
      }
      a = b + 1;
    }
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
