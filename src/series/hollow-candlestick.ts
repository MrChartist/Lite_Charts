// Hollow candlesticks: the body is hollow when the bar closed up (close above open) and filled when it closed down;
// the COLOUR follows the change from the previous close (a bar that closed above the previous close is up-coloured
// whatever its own body did). Bodies are drawn as an outer rectangle minus an inner one (even-odd fill), so the
// outline is whole device pixels and costs no stroke. Under 3 device px per bar the bars fold into one-pixel columns
// through the shared decimation (lowest low to highest high per column).

import type { Time } from '../core/time';
import { copyTime } from '../core/time';
import { candleLayout, hairline } from '../render/pixel';
import { createColumns, decimateColumns } from '../render/decimate';
import type { RowBase, SeriesDefinition, SeriesDrawScope } from './definition';

export interface HollowCandlestickData extends RowBase {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HollowCandlestickOptions {
  /** Defaults follow the theme's up and down colours. */
  upColor?: string;
  downColor?: string;
  wickVisible: boolean;
}

const ACCESS = {
  high: (r: HollowCandlestickData) => r.high,
  low: (r: HollowCandlestickData) => r.low,
  first: (r: HollowCandlestickData) => r.open,
  last: (r: HollowCandlestickData) => r.close,
};
const folded = createColumns();

function num(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`Chartist Lite: hollow candlestick row needs a finite "${key}" (time ${JSON.stringify(row.time)})`);
  }
  return v;
}

/** Close of the nearest earlier non-whitespace row (looking back a few rows), or NaN. */
function previousClose(rows: readonly (HollowCandlestickData | null)[], i: number): number {
  for (let j = i - 1, n = 0; j >= 0 && n < 8; j--, n++) {
    const r = rows[j];
    if (r) return r.close;
  }
  return Number.NaN;
}

/** Is the bar up-coloured: its close is not below the previous close (the first bar: its own open). */
export function isUpBar(r: HollowCandlestickData, prevClose: number): boolean {
  return r.close >= (prevClose === prevClose ? prevClose : r.open);
}

function draw(s: SeriesDrawScope<HollowCandlestickData, HollowCandlestickOptions>): void {
  const { ctx, rows, from, to, x, y, options: o, colors } = s;
  const up = o.upColor ?? colors.up;
  const down = o.downColor ?? colors.down;
  const layout = candleLayout(s.barSpacing, s.pixelRatio);

  if (layout.mode === 'columns') {
    const cols = s.decimate ? s.decimate(ACCESS) : decimateColumns(rows, from, to, x, ACCESS, folded);
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let k = 0; k < cols.count; k++) {
        if ((cols.last[k] >= cols.first[k]) !== (pass === 0)) continue;
        const top = Math.round(y(cols.high[k]));
        const bottom = Math.round(y(cols.low[k]));
        if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
        ctx.rect(cols.x[k], top, 1, Math.max(1, bottom - top));
      }
      ctx.fillStyle = pass === 0 ? up : down;
      ctx.fill();
    }
    return;
  }

  const { body, wick } = layout;
  const edge = Math.max(1, Math.min(hairline(s.pixelRatio), Math.floor(body / 2)));
  // pass 0/1: wicks (up, down colour), under the bodies; pass 2/3: bodies. One path per colour, hollow and filled
  // bodies together (the hollow ones are rectangle-minus-rectangle in the same even-odd path).
  for (let pass = 0; pass < 4; pass++) {
    const isWick = pass < 2;
    if (isWick && !o.wickVisible) continue;
    const wantUp = pass % 2 === 0;
    ctx.beginPath();
    let prev = previousClose(rows, from);
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r) continue;
      const isUp = isUpBar(r, prev);
      prev = r.close;
      if (isUp !== wantUp) continue;
      const left = Math.round(x(i) - body / 2);
      if (isWick) {
        const top = Math.round(y(r.high));
        const bottom = Math.round(y(r.low));
        if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
        const wx = left + (body - wick) / 2;
        if (r.close > r.open) {
          // A hollow body shows no wick through it: one stub above and one below.
          const bt = Math.round(y(r.close));
          const bb = Math.round(y(r.open));
          if (Number.isFinite(bt) && Number.isFinite(bb)) {
            if (bt > top) ctx.rect(wx, top, wick, bt - top);
            if (bottom > bb) ctx.rect(wx, bb, wick, bottom - bb);
            continue;
          }
        }
        ctx.rect(wx, top, wick, Math.max(1, bottom - top));
        continue;
      }
      const yo = y(r.open);
      const yc = y(r.close);
      if (!Number.isFinite(yo) || !Number.isFinite(yc)) continue;
      const top = Math.round(Math.min(yo, yc));
      const h = Math.max(1, Math.round(Math.max(yo, yc)) - top);
      ctx.rect(left, top, body, h);
      // Hollow: close above open. The inner rectangle is cut out when the body is thick enough to have one.
      if (r.close > r.open && body > 2 * edge && h > 2 * edge) ctx.rect(left + edge, top + edge, body - 2 * edge, h - 2 * edge);
    }
    ctx.fillStyle = wantUp ? up : down;
    ctx.fill('evenodd');
  }
}

export const HollowCandlestickSeries: SeriesDefinition<HollowCandlestickData, HollowCandlestickOptions> = {
  type: 'hollowCandlestick',
  defaults: { wickVisible: true },
  normalize(input) {
    if (input.open === undefined && input.high === undefined && input.low === undefined && input.close === undefined) return null;
    const open = num(input, 'open');
    const high = num(input, 'high');
    const low = num(input, 'low');
    const close = num(input, 'close');
    return { time: copyTime(input.time), open, high: Math.max(open, high, low, close), low: Math.min(open, high, low, close), close };
  },
  value: r => r.close,
  low: r => r.low,
  high: r => r.high,
  // The tag follows the colour logic of the bar, which needs the previous close the definition does not have: the
  // body direction is the best stand-in (it agrees with the colour on every bar that opens at the previous close).
  lastValueColor: (r, o, c) => (r.close >= r.open ? o.upColor ?? c.up : o.downColor ?? c.down),
  draw,
};
