// Custom series example: ROUNDED CANDLES. Starts from the built-in candlestick (rows, autoscale, colours are reused as
// they are) and replaces only `draw`: bodies get rounded corners and wicks round caps. When bars are narrow the
// built-in painter takes over, so a zoomed-out chart still folds into columns and stays fast.

import type { SeriesDefinition, SeriesDrawScope } from '../../../series/definition';
import type { CandlestickData, CandlestickOptions } from '../../../series/candlestick';
import { CandlestickSeries } from '../../../series/candlestick';
import { candleLayout } from '../../../render/pixel';

export interface RoundedCandlesOptions extends CandlestickOptions {
  /** 0 (square) to 1 (fully round ends) of half the body width. Default 0.5. */
  radius: number;
}

/** The corner radius in device px for a body `w` wide and `h` tall. Pure. */
export function cornerRadius(radius: number, w: number, h: number): number {
  return Math.max(0, Math.min(radius * (w / 2), h / 2));
}

function path(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawRounded(s: SeriesDrawScope<CandlestickData, RoundedCandlesOptions>): void {
  const layout = candleLayout(s.barSpacing, s.pixelRatio);
  // Narrow bars: the built-in painter (columns, or bodies too small to round).
  if (layout.mode === 'columns' || layout.body < 6) { CandlestickSeries.draw(s as unknown as SeriesDrawScope<CandlestickData, CandlestickOptions>); return; }
  const { ctx, rows, from, to, x, y, options: o, colors } = s;
  const up = o.upColor ?? colors.up;
  const down = o.downColor ?? colors.down;
  const { body, wick } = layout;
  for (let pass = 0; pass < 2; pass++) {
    const wantUp = pass === 0;
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const r = rows[i];
      if (!r || (r.close >= r.open) !== wantUp) continue;
      const left = Math.round(x(i) - body / 2);
      if (o.wickVisible) {
        const top = Math.round(y(r.high));
        const bottom = Math.round(y(r.low));
        if (Number.isFinite(top) && Number.isFinite(bottom)) path(ctx, left + (body - wick) / 2, top, wick, Math.max(1, bottom - top), wick / 2);
      }
      const yo = y(r.open);
      const yc = y(r.close);
      if (!Number.isFinite(yo) || !Number.isFinite(yc)) continue;
      const top = Math.round(Math.min(yo, yc));
      const h = Math.max(2, Math.round(Math.max(yo, yc)) - top);
      path(ctx, left, top, body, h, cornerRadius(o.radius, body, h));
    }
    ctx.fillStyle = wantUp ? up : down;
    ctx.fill();
  }
}

export const RoundedCandlesSeries: SeriesDefinition<CandlestickData, RoundedCandlesOptions> = {
  ...(CandlestickSeries as unknown as SeriesDefinition<CandlestickData, RoundedCandlesOptions>),
  type: 'rounded-candles',
  defaults: { ...CandlestickSeries.defaults, radius: 0.5 },
  draw: drawRounded,
};
