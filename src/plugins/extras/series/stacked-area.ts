// Custom series example: STACKED AREA. One row holds several values; layer k is drawn between the running totals of the
// layers under it. Shows the contract's multi-value case: `normalize` copies an array, `value` is the total, `low` is
// 0 and `high` is the total, `draw` walks only the visible rows and uses `scope.x` / `scope.y` in device pixels.
//
//   chart.addSeries(StackedAreaSeries, { title: 'Volume by venue' }).setData([{ time: '2026-01-02', values: [3, 5, 2] }]);

import type { Time } from '../../../core/time';
import { copyTime } from '../../../core/time';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from '../../../series/definition';
import { alphaOf, seriesPalette } from './palette';

export interface StackedAreaData extends RowBase {
  time: Time;
  /** One non-negative number per layer, bottom layer first. Every row of a series has the same count. */
  values: readonly number[];
  /** The total, filled in by the series (`values` summed). */
  value?: number;
}

export interface StackedAreaOptions {
  /** One CSS colour per layer; missing ones come from the theme palette. */
  colors?: readonly string[];
  /** Fill opacity 0..1. Default 0.78. */
  fillOpacity: number;
  /** CSS px of the line along each layer's top edge. Default 1.5. */
  lineWidth: number;
}

const sum = (v: readonly number[]): number => { let t = 0; for (const x of v) t += x; return t; };

function drawStacked(s: SeriesDrawScope<StackedAreaData, StackedAreaOptions>): void {
  const { ctx, rows, from, to, x, y, options: o } = s;
  let layers = 0;
  for (let i = from; i <= to; i++) { const r = rows[i]; if (r) layers = Math.max(layers, r.values.length); }
  if (layers === 0) return;
  const palette = seriesPalette(s.colors);
  const colour = (k: number): string => o.colors?.[k] ?? palette[k % palette.length];
  const base = y(0);
  // The folded form is not needed: a stacked area is cheap at one vertex per visible row, and past one row per device
  // pixel we skip rows (the top edge of a layer is smooth enough that every nth row draws the same shape).
  const stride = Math.max(1, Math.floor(1 / Math.max(0.001, s.barSpacing)));
  ctx.lineJoin = 'round';
  // Segments of consecutive rows (a whitespace row breaks the area).
  const segs: number[][] = [];
  let cur: number[] = [];
  for (let i = from; i <= to; i += stride) {
    if (rows[i]) cur.push(i); else if (cur.length) { segs.push(cur); cur = []; }
  }
  if (cur.length) segs.push(cur);
  for (let k = layers - 1; k >= 0; k--) {
    // Top edge of layer k = sum of layers 0..k; bottom edge = sum of layers 0..k-1.
    for (const seg of segs) {
      if (seg.length < 2) continue;
      const topY = new Float64Array(seg.length);
      const botY = new Float64Array(seg.length);
      seg.forEach((ri, n) => {
        const v = (rows[ri] as StackedAreaData).values;
        let t = 0;
        for (let j = 0; j <= k; j++) { if (j === k) botY[n] = y(t); t += v[j] ?? 0; }
        topY[n] = y(t);
      });
      ctx.beginPath();
      ctx.moveTo(x(seg[0]), topY[0]);
      for (let n = 1; n < seg.length; n++) ctx.lineTo(x(seg[n]), topY[n]);
      for (let n = seg.length - 1; n >= 0; n--) ctx.lineTo(x(seg[n]), k === 0 ? base : botY[n]);
      ctx.closePath();
      ctx.fillStyle = alphaOf(colour(k), o.fillOpacity);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x(seg[0]), topY[0]);
      for (let n = 1; n < seg.length; n++) ctx.lineTo(x(seg[n]), topY[n]);
      ctx.strokeStyle = colour(k);
      ctx.lineWidth = Math.max(1, Math.round(o.lineWidth * s.pixelRatio));
      ctx.stroke();
    }
  }
}

export const StackedAreaSeries: SeriesDefinition<StackedAreaData, StackedAreaOptions> = {
  type: 'stacked-area',
  defaults: { fillOpacity: 0.78, lineWidth: 1.5 },
  normalize(input) {
    if (input.values === undefined) return null;
    const v = input.values;
    if (!Array.isArray(v) || v.length === 0 || v.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) {
      throw new TypeError(`Chartist Lite: stacked area row needs "values": a non-empty array of finite numbers from 0 up (time ${JSON.stringify(input.time)})`);
    }
    return { time: copyTime(input.time), values: [...v], value: sum(v) };
  },
  value: r => r.value ?? sum(r.values),
  low: () => 0,
  high: r => r.value ?? sum(r.values),
  lastValueColor: (_r, o, c) => o.colors?.[0] ?? seriesPalette(c)[0],
  draw: drawStacked,
  crosshairMarker: (r, o, c) => ({ price: r.value ?? sum(r.values), color: o.colors?.[r.values.length - 1] ?? seriesPalette(c)[(r.values.length - 1) % 6] }),
};
