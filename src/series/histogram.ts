// Histogram series: one column per row from a base value (default 0) to the row's value. Meant for volume on an
// overlay scale ('volume', see ARCHITECTURE.md). Rows may carry their own `color`; each distinct colour is one path.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { candleLayout } from '../render/pixel';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';
import { withAlpha } from './area';

export interface HistogramData extends RowBase {
  time: Time;
  value: number;
  /** Colour of this column; the series colour when absent. */
  color?: string;
}

export interface HistogramOptions {
  /** Series colour. Defaults to the theme's line colour at 50% opacity. */
  color?: string;
  /** The value columns grow from. Default 0. */
  base: number;
}

/** Distinct row colours are batched into paths up to this many; beyond it each extra colour fills per run. */
const MAX_BATCHES = 8;
const distinct: string[] = [];

export function histogramColumn(spacingDev: number, ratio: number): { width: number; columns: boolean } {
  const l = candleLayout(spacingDev, ratio);
  return { width: l.body, columns: l.mode === 'columns' };
}

function drawHistogram(s: SeriesDrawScope<HistogramData, HistogramOptions>): void {
  const { ctx, rows, from, to, x, y, options: o, colors } = s;
  const baseY = Math.round(y(o.base));
  if (!Number.isFinite(baseY)) return;
  const fallback = o.color ?? withAlpha(colors.line, 0.5);
  const { width, columns } = histogramColumn(s.barSpacing, s.pixelRatio);

  // Distinct override colours (small, reused array; no per-bar allocation).
  distinct.length = 0;
  let overflow = false;
  for (let i = from; i <= to; i++) {
    const c = rows[i]?.color;
    if (c === undefined || c === fallback) continue;
    if (distinct.indexOf(c) < 0) {
      if (distinct.length >= MAX_BATCHES) { overflow = true; continue; }
      distinct.push(c);
    }
  }

  // pass 0: series colour (rows without a colour, or with one equal to it); pass 1..k: each batched colour;
  // last pass (only on overflow): rows whose colour was not batched, filled one by one.
  const passes = distinct.length + 1 + (overflow ? 1 : 0);
  for (let pass = 0; pass < passes; pass++) {
    const batched = pass <= distinct.length;
    const want = pass === 0 ? fallback : batched ? distinct[pass - 1] : '';
    if (!batched) {
      for (let i = from; i <= to; i++) {
        const r = rows[i];
        if (!r || r.color === undefined || r.color === fallback || distinct.indexOf(r.color) >= 0) continue;
        ctx.beginPath();
        rect(ctx, x(i), y(r.value), baseY, width, columns);
        ctx.fillStyle = r.color;
        ctx.fill();
      }
      continue;
    }
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r) continue;
      const c = r.color === undefined ? fallback : r.color;
      if (c !== want) continue;
      rect(ctx, x(i), y(r.value), baseY, width, columns);
    }
    ctx.fillStyle = want;
    ctx.fill();
  }
}

function rect(ctx: CanvasRenderingContext2D, cx: number, yv: number, baseY: number, width: number, columns: boolean): void {
  if (!Number.isFinite(yv)) return;
  const yy = Math.round(yv);
  const top = Math.min(yy, baseY);
  const h = Math.max(1, Math.abs(yy - baseY));
  ctx.rect(columns ? Math.floor(cx) : Math.round(cx - width / 2), top, width, h);
}

export const HistogramSeries: SeriesDefinition<HistogramData, HistogramOptions> = {
  type: 'histogram',
  defaults: { base: 0 },
  normalize(input) {
    if (input.value === undefined) return null;
    const v = input.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`Chartist Lite: histogram row needs a finite "value" (time ${JSON.stringify(input.time)})`);
    }
    const c = input.color;
    if (c !== undefined && (typeof c !== 'string' || c === '')) {
      throw new TypeError(`Chartist Lite: histogram row "color" must be a non-empty CSS colour string (time ${JSON.stringify(input.time)})`);
    }
    const row: HistogramData = { time: copyTime(input.time), value: v };
    if (c !== undefined) row.color = c;
    return row;
  },
  value: r => r.value,
  // The row cannot see the series' base option: the default base 0 is always inside the range.
  low: r => Math.min(r.value, 0),
  high: r => Math.max(r.value, 0),
  lastValueColor: (r, o, c) => r.color ?? o.color ?? c.line,
  draw: drawHistogram,
};
