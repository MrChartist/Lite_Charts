// Custom series example: WHISKER BOX (box and whisker). A row is five numbers: min, first quartile, median, third
// quartile and max (a range of outcomes, a distribution per bucket). Whiskers run from min to max with caps, the box
// from the first to the third quartile, the median is a bar across it. `value` is the median, `low` and `high` the
// whisker ends. Everything is drawn on whole device pixels from `scope.x` / `scope.y`.

import type { Time } from '../../../core/time';
import { copyTime } from '../../../core/time';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from '../../../series/definition';
import { alphaOf } from './palette';

export interface WhiskerBoxData extends RowBase {
  time: Time;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

export interface WhiskerBoxOptions {
  /** CSS colour. Default: the theme's line colour. */
  color?: string;
  /** Box fill opacity 0..1. Default 0.22. */
  fillOpacity: number;
}

const KEYS = ['min', 'q1', 'median', 'q3', 'max'] as const;

/** Box width in whole device px for a bar spacing: 60% of it, odd, never under 3, never over 40. Pure. */
export function boxWidth(spacing: number): number {
  let w = Math.max(3, Math.min(40, Math.round(spacing * 0.6)));
  if (w % 2 === 0) w += 1;
  return w;
}

function drawBoxes(s: SeriesDrawScope<WhiskerBoxData, WhiskerBoxOptions>): void {
  const { ctx, rows, from, to, x, y, options: o } = s;
  const colour = o.color ?? s.colors.line;
  const w = boxWidth(s.barSpacing);
  const line = Math.max(1, Math.round(s.pixelRatio));
  const cap = Math.max(3, Math.floor(w * 0.6));
  ctx.fillStyle = alphaOf(colour, o.fillOpacity);
  ctx.beginPath();
  for (let i = from; i <= to; i++) {
    const r = rows[i];
    if (!r) continue;
    const yTop = y(r.q3);
    const yBot = y(r.q1);
    if (!Number.isFinite(yTop) || !Number.isFinite(yBot)) continue;
    const left = Math.round(x(i)) - (w - 1) / 2;
    const top = Math.round(yTop);
    ctx.rect(left, top, w, Math.max(1, Math.round(yBot) - top));
  }
  ctx.fill();
  // Whiskers, caps, box outline and median in one stroke path.
  ctx.strokeStyle = colour;
  ctx.lineWidth = line;
  ctx.beginPath();
  const half = line % 2 === 1 ? 0.5 : 0;
  for (let i = from; i <= to; i++) {
    const r = rows[i];
    if (!r) continue;
    const cx = Math.round(x(i)) + half;
    const yMax = Math.round(y(r.max)) + half;
    const yMin = Math.round(y(r.min)) + half;
    const yQ3 = Math.round(y(r.q3)) + half;
    const yQ1 = Math.round(y(r.q1)) + half;
    const yMed = Math.round(y(r.median)) + half;
    if (![yMax, yMin, yQ3, yQ1, yMed].every(Number.isFinite)) continue;
    const left = Math.round(x(i)) - (w - 1) / 2 + half;
    ctx.moveTo(cx, yMax); ctx.lineTo(cx, yQ3);
    ctx.moveTo(cx, yQ1); ctx.lineTo(cx, yMin);
    ctx.moveTo(cx - cap / 2, yMax); ctx.lineTo(cx + cap / 2, yMax);
    ctx.moveTo(cx - cap / 2, yMin); ctx.lineTo(cx + cap / 2, yMin);
    ctx.rect(left, yQ3, w - 1, Math.max(0, yQ1 - yQ3));
  }
  ctx.stroke();
  ctx.lineWidth = line * 2;
  ctx.beginPath();
  for (let i = from; i <= to; i++) {
    const r = rows[i];
    if (!r) continue;
    const ym = Math.round(y(r.median));
    if (!Number.isFinite(ym)) continue;
    const left = Math.round(x(i)) - (w - 1) / 2;
    ctx.moveTo(left, ym); ctx.lineTo(left + w, ym);
  }
  ctx.stroke();
}

export const WhiskerBoxSeries: SeriesDefinition<WhiskerBoxData, WhiskerBoxOptions> = {
  type: 'whisker-box',
  defaults: { fillOpacity: 0.22 },
  normalize(input) {
    if (KEYS.every(k => input[k] === undefined)) return null;
    const at = `(time ${JSON.stringify(input.time)})`;
    const v: number[] = [];
    for (const k of KEYS) {
      const n = input[k];
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new TypeError(`Chartist Lite: whisker box row needs a finite "${k}" ${at}`);
      v.push(n);
    }
    for (let i = 1; i < v.length; i++) {
      if (v[i] < v[i - 1]) throw new TypeError(`Chartist Lite: whisker box row needs min <= q1 <= median <= q3 <= max ${at}`);
    }
    return { time: copyTime(input.time), min: v[0], q1: v[1], median: v[2], q3: v[3], max: v[4] };
  },
  value: r => r.median,
  low: r => r.min,
  high: r => r.max,
  lastValueColor: (_r, o, c) => o.color ?? c.line,
  draw: drawBoxes,
  crosshairMarker: (r, o, c) => ({ price: r.median, color: o.color ?? c.line }),
};
