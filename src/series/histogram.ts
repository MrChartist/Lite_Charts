// Histogram series: one column per row from a base value (default 0) to the row's value. Meant for volume on an
// overlay scale ('volume', see ARCHITECTURE.md). Rows may carry their own `color`; each distinct colour is one path.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { candleLayout } from '../render/pixel';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';

export interface HistogramData extends RowBase {
  time: Time;
  value: number;
  /** Colour of this column; the series colour when absent. */
  color?: string;
}

export interface HistogramOptions {
  /** Series colour. Defaults to the theme's quiet `volume` ink, so volume sits behind price. */
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

// Scratch for the folded form: per device-pixel column its extreme value and that row's colour (reused, no per-frame
// allocation once grown).
let foldX = new Float64Array(256);
let foldV = new Float64Array(256);
let foldC: (string | undefined)[] = [];

/**
 * Bars closer than one device pixel: one column per pixel, from the base to the value farthest from it, in that row's
 * colour. Keeps a 100k-row histogram to one rectangle per pixel column (was one per row).
 */
function drawFolded(s: SeriesDrawScope<HistogramData, HistogramOptions>, baseY: number, fallback: string): void {
  const { ctx, rows, from, to, x, y, options: o } = s;
  if (foldX.length < to - from + 2) {
    foldX = new Float64Array((to - from + 2) * 2);
    foldV = new Float64Array(foldX.length);
  }
  let n = 0;
  const vals = s.values;
  const slots = s.slots;
  if (vals && slots && s.xStep !== undefined && s.xOrigin !== undefined) {
    // Typed path: the row object is read only for a column's first row and a new extreme (its colour).
    const x0 = s.xOrigin;
    const xs = s.xStep;
    const base = o.base;
    let edge = -Infinity;
    for (let i = from; i <= to; i++) {
      const v = vals[i];
      if (v !== v) continue;
      const sl = slots[i];
      if (sl < edge) {
        if (Math.abs(v - base) > Math.abs(foldV[n - 1] - base)) { foldV[n - 1] = v; foldC[n - 1] = (rows[i] as HistogramData).color; }
        continue;
      }
      const col = Math.floor(x0 + xs * sl);
      edge = (col + 1 - x0) / xs;
      foldX[n] = col; foldV[n] = v; foldC[n] = (rows[i] as HistogramData).color;
      n++;
    }
  } else {
    let cur = Number.NaN;
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r) continue;
      const col = Math.floor(x(i));
      if (col !== cur) {
        cur = col;
        foldX[n] = col; foldV[n] = r.value; foldC[n] = r.color;
        n++;
      } else if (Math.abs(r.value - o.base) > Math.abs(foldV[n - 1] - o.base)) {
        foldV[n - 1] = r.value; foldC[n - 1] = r.color;
      }
    }
  }
  // One path per colour: the series colour first, then each row colour in turn.
  let done = 0;
  let pass = 0;
  const seen = distinct;
  seen.length = 0;
  while (done < n && pass < 64) {
    const want = pass === 0 ? fallback : seen[pass - 1];
    if (pass > 0 && want === undefined) break;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const c = foldC[k] ?? fallback;
      if (c !== want) { if (pass === 0 && seen.indexOf(c) < 0) seen.push(c); continue; }
      const yv = Math.round(y(foldV[k]));
      if (!Number.isFinite(yv)) continue;
      ctx.rect(foldX[k], Math.min(yv, baseY), 1, Math.max(1, Math.abs(yv - baseY)));
      done++;
    }
    ctx.fillStyle = want;
    ctx.fill();
    pass++;
  }
}

function drawHistogram(s: SeriesDrawScope<HistogramData, HistogramOptions>): void {
  const { ctx, rows, from, to, x, y, options: o, colors } = s;
  const baseY = Math.round(y(o.base));
  if (!Number.isFinite(baseY)) return;
  const fallback = o.color ?? colors.volume;
  const { width, columns } = histogramColumn(s.barSpacing, s.pixelRatio);
  if (s.barSpacing < 1) { drawFolded(s, baseY, fallback); return; }

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
  // Columns grow from `base`, so autoscale includes it (the chart passes the options).
  low: (r, o) => Math.min(r.value, o?.base ?? 0),
  high: (r, o) => Math.max(r.value, o?.base ?? 0),
  // The quiet default fill is too faint for a tag or a legend dot: those take the muted ink instead.
  lastValueColor: (r, o, c) => r.color ?? o.color ?? c.mutedText,
  draw: drawHistogram,
};
