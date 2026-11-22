// Custom series example: HEATMAP CELLS. Each row is a column of price buckets with an intensity from 0 to 1 (order
// book depth, volume at price, a profile). Shows a series that draws rectangles in price space: `low` / `high` give
// the buckets' span for autoscale, `value` is the price of the most intense bucket (what the legend and crosshair read).
//
//   chart.addSeries(HeatmapSeries, { title: 'Depth' }).setData([{ time, low: 100, step: 0.5, cells: [0, 0.2, 0.9, 0.4] }]);

import type { Time } from '../../../core/time';
import { copyTime } from '../../../core/time';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from '../../../series/definition';
import { alphaOf } from './palette';

export interface HeatmapData extends RowBase {
  time: Time;
  /** Price of the bottom edge of the first bucket. */
  low: number;
  /** Price height of one bucket (above 0). */
  step: number;
  /** One intensity per bucket, bottom first, 0..1. */
  cells: readonly number[];
  /** Filled in by the series: the price at the centre of the most intense bucket. */
  value?: number;
}

export interface HeatmapOptions {
  /** CSS colour of the full-intensity cell. Default: the theme's line colour. */
  color?: string;
  /** Opacity of a full-intensity cell. Default 0.95. */
  maxOpacity: number;
  /** Below this intensity a cell is not drawn. Default 0.04. */
  floor: number;
}

const LEVELS = 24;

/** Price at the centre of the most intense bucket (the lowest one on a tie). */
export function peakPrice(r: Pick<HeatmapData, 'low' | 'step' | 'cells'>): number {
  let best = 0;
  for (let i = 1; i < r.cells.length; i++) if (r.cells[i] > r.cells[best]) best = i;
  return r.low + (best + 0.5) * r.step;
}

function drawHeat(s: SeriesDrawScope<HeatmapData, HeatmapOptions>): void {
  const { ctx, rows, from, to, x, y, options: o } = s;
  const colour = o.color ?? s.colors.line;
  const fills: string[] = [];
  for (let k = 0; k <= LEVELS; k++) fills.push(alphaOf(colour, (k / LEVELS) * o.maxOpacity));
  // Cells touch their neighbours: each spans from the middle between bars to the next middle.
  const half = s.barSpacing / 2;
  let level = -1;
  for (let i = from; i <= to; i++) {
    const r = rows[i];
    if (!r) continue;
    const x0 = Math.round(x(i) - half);
    const w = Math.max(1, Math.round(x(i) + half) - x0);
    for (let c = 0; c < r.cells.length; c++) {
      const v = r.cells[c];
      if (!(v >= o.floor)) continue;
      const yTop = y(r.low + (c + 1) * r.step);
      const yBot = y(r.low + c * r.step);
      if (!Number.isFinite(yTop) || !Number.isFinite(yBot)) continue;
      const top = Math.round(yTop);
      const lv = Math.max(1, Math.min(LEVELS, Math.round(v * LEVELS)));
      if (lv !== level) { ctx.fillStyle = fills[lv]; level = lv; }
      ctx.fillRect(x0, top, w, Math.max(1, Math.round(yBot) - top));
    }
  }
}

export const HeatmapSeries: SeriesDefinition<HeatmapData, HeatmapOptions> = {
  type: 'heatmap',
  defaults: { maxOpacity: 0.95, floor: 0.04 },
  normalize(input) {
    if (input.cells === undefined && input.low === undefined) return null;
    const { low, step, cells } = input as unknown as { low: unknown; step: unknown; cells: unknown };
    const at = `(time ${JSON.stringify(input.time)})`;
    if (typeof low !== 'number' || !Number.isFinite(low)) throw new TypeError(`Chartist Lite: heatmap row needs a finite "low" ${at}`);
    if (typeof step !== 'number' || !(step > 0) || !Number.isFinite(step)) throw new TypeError(`Chartist Lite: heatmap row needs a "step" above 0 ${at}`);
    if (!Array.isArray(cells) || cells.length === 0 || cells.some(c => typeof c !== 'number' || !Number.isFinite(c))) {
      throw new TypeError(`Chartist Lite: heatmap row needs "cells": a non-empty array of intensities ${at}`);
    }
    const row: HeatmapData = { time: copyTime(input.time), low, step, cells: cells.map(c => Math.max(0, Math.min(1, c as number))) };
    row.value = peakPrice(row);
    return row;
  },
  value: r => r.value ?? peakPrice(r),
  low: r => r.low,
  high: r => r.low + r.step * r.cells.length,
  lastValueColor: (_r, o, c) => o.color ?? c.line,
  draw: drawHeat,
  crosshairMarker: (r, o, c) => ({ price: r.value ?? peakPrice(r), color: o.color ?? c.line }),
};
