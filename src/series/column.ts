// Column series: one column per row, coloured up or down. Meant for price columns (a column from the pane bottom up to
// the close, coloured by close vs open) and, with `base: 0` on an overlay scale, for volume (see ARCHITECTURE.md,
// "Adding a series type"). A row says which way it went with `up`, or with `open` and `close`; a row with neither is
// up when its value is not below the previous row's. Two paths per frame (one per colour). Under 3 device px per bar
// the rows fold to one column per device pixel, taking the farthest value of the pixel and the direction of its row.

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { candleLayout } from '../render/pixel';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';

export interface ColumnData extends RowBase {
  time: Time;
  value: number;
  /** Direction of the bar; derived from `open` and `close` when those are given. */
  up?: boolean;
}

export interface ColumnOptions {
  /** Defaults follow the theme's up and down colours. */
  upColor?: string;
  downColor?: string;
  /** The value columns grow from. Default: the bottom of the pane (price columns). Use 0 for volume. */
  base?: number;
  /** Opacity of the columns, 0 to 1. Default 1. */
  opacity: number;
}

// Scratch for the folded form (reused, grown on demand).
let fx = new Float64Array(256);
let fv = new Float64Array(256);
let fu = new Uint8Array(256);

function growFold(n: number): void {
  if (n <= fx.length) return;
  let cap = fx.length;
  while (cap < n) cap *= 2;
  fx = new Float64Array(cap); fv = new Float64Array(cap); fu = new Uint8Array(cap);
}

function isUp(rows: readonly (ColumnData | null)[], i: number): boolean {
  const r = rows[i] as ColumnData;
  if (r.up !== undefined) return r.up;
  for (let j = i - 1, n = 0; j >= 0 && n < 8; j--, n++) {
    const p = rows[j];
    if (p) return r.value >= p.value;
  }
  return true;
}

function drawColumns(s: SeriesDrawScope<ColumnData, ColumnOptions>): void {
  const { ctx, rows, from, to, x, y, options: o, colors, pane } = s;
  const up = o.upColor ?? colors.up;
  const down = o.downColor ?? colors.down;
  const baseY = o.base === undefined ? pane.y + pane.height : Math.round(y(o.base));
  if (!Number.isFinite(baseY)) return;
  const layout = candleLayout(s.barSpacing, s.pixelRatio);
  ctx.globalAlpha = o.opacity;

  if (layout.mode === 'columns') {
    growFold(to - from + 2);
    // Farthest from the base (from the pane bottom, when there is none: the highest value).
    const baseV = o.base;
    const far = (v: number): number => (baseV === undefined ? v : Math.abs(v - baseV));
    let n = 0;
    let cur = Number.NaN;
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r) continue;
      const col = Math.floor(x(i));
      if (col !== cur) { cur = col; fx[n] = col; fv[n] = r.value; fu[n] = isUp(rows, i) ? 1 : 0; n++; }
      else if (far(r.value) > far(fv[n - 1])) { fv[n - 1] = r.value; fu[n - 1] = isUp(rows, i) ? 1 : 0; }
    }
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        if ((fu[k] === 1) !== (pass === 0)) continue;
        const yy = Math.round(y(fv[k]));
        if (!Number.isFinite(yy)) continue;
        ctx.rect(fx[k], Math.min(yy, baseY), 1, Math.max(1, Math.abs(yy - baseY)));
      }
      ctx.fillStyle = pass === 0 ? up : down;
      ctx.fill();
    }
    return;
  }

  const width = layout.body;
  for (let pass = 0; pass < 2; pass++) {
    const wantUp = pass === 0;
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r || isUp(rows, i) !== wantUp) continue;
      const yy = Math.round(y(r.value));
      if (!Number.isFinite(yy)) continue;
      ctx.rect(Math.round(x(i) - width / 2), Math.min(yy, baseY), width, Math.max(1, Math.abs(yy - baseY)));
    }
    ctx.fillStyle = wantUp ? up : down;
    ctx.fill();
  }
}

export const ColumnSeries: SeriesDefinition<ColumnData, ColumnOptions> = {
  type: 'column',
  defaults: { opacity: 1 },
  normalize(input) {
    if (input.value === undefined) return null;
    const v = input.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`Chartist Lite: column row needs a finite "value" (time ${JSON.stringify(input.time)})`);
    }
    const row: ColumnData = { time: copyTime(input.time), value: v };
    const { up, open, close } = input;
    if (typeof up === 'boolean') row.up = up;
    else if (typeof open === 'number' && typeof close === 'number' && Number.isFinite(open) && Number.isFinite(close)) row.up = close >= open;
    return row;
  },
  value: r => r.value,
  // Columns grow from `base` when there is one, so autoscale includes it (the chart passes the options).
  low: (r, o) => (o?.base === undefined ? r.value : Math.min(r.value, o.base)),
  high: (r, o) => (o?.base === undefined ? r.value : Math.max(r.value, o.base)),
  lastValueColor: (r, o, c) => (r.up === false ? o.downColor ?? c.down : o.upColor ?? c.up),
  draw: drawColumns,
};
