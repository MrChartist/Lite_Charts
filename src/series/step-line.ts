// Step line: a value is held flat until the next bar, then jumps (a stair). Horizontal and vertical runs sit on whole
// device pixels, so the stairs stay crisp at any ratio. One path, one stroke per frame. Under one device pixel per bar
// the rows fold to the first, highest, lowest and last value per pixel column (the shared decimation) and are joined
// straight, since no step is wider than a pixel any more.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { deviceWidth } from '../render/pixel';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';
import { collectPoints } from './area';
import { applyLineStyle, type LineStyle } from './line';

export interface StepLineData extends RowBase {
  time: Time;
  value: number;
}

export interface StepLineOptions {
  /** Defaults to the theme's line colour. */
  color?: string;
  /** CSS px. */
  lineWidth: number;
  lineStyle: LineStyle;
  /** Where the jump happens: 'after' holds each value until the next bar (default), 'before' jumps at the previous bar, 'middle' halfway. */
  stepAt: 'after' | 'before' | 'middle';
  crosshairMarkerVisible: boolean;
}

/** Whole-device-pixel position for a stroke `w` px wide: a pixel centre for an odd width, an edge for an even one. */
function snap(v: number, w: number): number {
  return w % 2 === 1 ? Math.floor(v) + 0.5 : Math.round(v);
}

function drawStep(s: SeriesDrawScope<StepLineData, StepLineOptions>): void {
  const { ctx, options: o } = s;
  const { n, xs, ys } = collectPoints(s, r => r.value);
  if (n === 0) return;
  const w = deviceWidth(o.lineWidth, s.pixelRatio);
  ctx.lineWidth = w;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.strokeStyle = o.color ?? s.colors.line;
  applyLineStyle(ctx, o.lineStyle, w);
  const steps = s.barSpacing >= 1;
  const at = o.stepAt;
  ctx.beginPath();
  let pen = false;
  let px = 0;
  let py = 0;
  for (let k = 0; k < n; k++) {
    const yy = ys[k];
    if (yy !== yy) { pen = false; continue; }
    if (!steps) {
      if (!pen) { ctx.moveTo(xs[k], yy); pen = true; } else ctx.lineTo(xs[k], yy);
      continue;
    }
    const cy = snap(yy, w);
    const cx = snap(xs[k], w);
    if (!pen) { ctx.moveTo(cx, cy); pen = true; px = cx; py = cy; continue; }
    if (at === 'after') { ctx.lineTo(cx, py); ctx.lineTo(cx, cy); }
    else if (at === 'before') { ctx.lineTo(px, cy); ctx.lineTo(cx, cy); }
    else { const mx = snap((px + cx) / 2, w); ctx.lineTo(mx, py); ctx.lineTo(mx, cy); ctx.lineTo(cx, cy); }
    px = cx;
    py = cy;
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

export const StepLineSeries: SeriesDefinition<StepLineData, StepLineOptions> = {
  type: 'stepLine',
  defaults: { lineWidth: 2, lineStyle: 'solid', stepAt: 'after', crosshairMarkerVisible: true },
  normalize(input) {
    if (input.value === undefined) return null;
    const v = input.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`Chartist Lite: step line row needs a finite "value" (time ${JSON.stringify(input.time)})`);
    }
    return { time: copyTime(input.time), value: v };
  },
  value: r => r.value,
  low: r => r.value,
  high: r => r.value,
  lastValueColor: (_r, o, c) => o.color ?? c.line,
  draw: drawStep,
  crosshairMarker: (r, o, c) => (o.crosshairMarkerVisible ? { price: r.value, color: o.color ?? c.line } : null),
};
