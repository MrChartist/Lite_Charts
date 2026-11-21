// Price line: a horizontal line at a fixed price with a tag on the price axis and an optional title on the plot.
// Built as a primitive attached to one series, so its price maps through that series' scale.

import type { ChartPrimitive, PriceAxisLabel, PrimitiveDrawScope, PrimitiveHost } from './primitive';
import { crispCoord, deviceWidth } from '../render/pixel';

export type PriceLineStyle = 'solid' | 'dashed' | 'dotted';

export interface PriceLineOptions {
  price: number;
  /** CSS colour. Defaults to the theme's line colour. */
  color?: string;
  /** CSS px. Default 1. */
  lineWidth: number;
  /** Default 'dashed'. */
  lineStyle: PriceLineStyle;
  /** Text drawn on the plot at the right end of the line. Default none. */
  title: string;
  /** Tag with the price on the price axis. Default true. */
  axisLabelVisible: boolean;
}

/** The part of a series a price line needs. */
export interface PrimitiveOwner {
  attachPrimitive(primitive: ChartPrimitive): void;
  detachPrimitive(primitive: ChartPrimitive): void;
}

export interface PriceLineHandle {
  applyOptions(options: Partial<PriceLineOptions>): void;
  options(): Readonly<PriceLineOptions>;
  remove(): void;
}

const NO_LABELS: readonly PriceAxisLabel[] = [];
const STYLES: readonly string[] = ['solid', 'dashed', 'dotted'];

/** Merge `patch` into `base`, validating every field it touches. Throws a TypeError naming the bad field. */
export function mergePriceLineOptions(base: PriceLineOptions, patch: Partial<PriceLineOptions>): PriceLineOptions {
  const out: PriceLineOptions = { ...base };
  if (patch.price !== undefined) {
    if (typeof patch.price !== 'number' || !Number.isFinite(patch.price)) throw new TypeError('Chartist Lite: price line "price" must be a finite number');
    out.price = patch.price;
  }
  if (patch.lineWidth !== undefined) {
    if (typeof patch.lineWidth !== 'number' || !(patch.lineWidth > 0) || !Number.isFinite(patch.lineWidth)) throw new TypeError('Chartist Lite: price line "lineWidth" must be a number above 0');
    out.lineWidth = patch.lineWidth;
  }
  if (patch.lineStyle !== undefined) {
    if (!STYLES.includes(patch.lineStyle)) throw new TypeError('Chartist Lite: price line "lineStyle" must be "solid", "dashed" or "dotted"');
    out.lineStyle = patch.lineStyle;
  }
  if (patch.color !== undefined) out.color = patch.color;
  if (patch.title !== undefined) out.title = String(patch.title);
  if (patch.axisLabelVisible !== undefined) out.axisLabelVisible = !!patch.axisLabelVisible;
  return out;
}

/** Dash pattern in device px for a stroke `w` device px wide. */
export function dashPattern(style: PriceLineStyle, w: number): number[] {
  if (style === 'dashed') return [w * 4 + 2, w * 3 + 2];
  if (style === 'dotted') return [w, w + 2];
  return [];
}

export function createPriceLine(series: PrimitiveOwner, options: Partial<PriceLineOptions> & { price: number }): PriceLineHandle {
  let opts = mergePriceLineOptions(
    { price: NaN, lineWidth: 1, lineStyle: 'dashed', title: '', axisLabelVisible: true },
    options,
  );
  if (!Number.isFinite(opts.price)) throw new TypeError('Chartist Lite: createPriceLine needs a finite "price"');
  let host: PrimitiveHost | null = null;
  let attached = true;
  // The theme's line colour, remembered from the last draw so the axis tag follows a theme switch.
  let themeLine = '#0066CC';

  const primitive: ChartPrimitive = {
    zOrder: 'normal',
    attached(h) { host = h; },
    detached() { host = null; },
    draw(s: PrimitiveDrawScope) {
      themeLine = s.colors.line;
      const y = s.priceToY(opts.price);
      if (y === null) return;
      const { ctx, pane, pixelRatio: r } = s;
      const color = opts.color ?? s.colors.line;
      const w = deviceWidth(opts.lineWidth, r);
      const yc = crispCoord(y, w, r) / r;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = w / r;
      ctx.setLineDash(dashPattern(opts.lineStyle, w).map(d => d / r));
      ctx.beginPath();
      ctx.moveTo(pane.x, yc);
      ctx.lineTo(pane.x + pane.width, yc);
      ctx.stroke();
      ctx.restore();
      if (opts.title) {
        const size = Math.max(12, s.fontSize);
        ctx.save();
        ctx.font = `500 ${size}px ${s.fontFamily}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        const tw = ctx.measureText(opts.title).width;
        const right = pane.x + pane.width - 6;
        const ty = yc - size / 2 - 4;
        // A backing in the chart background keeps the title readable over bars.
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = s.colors.background;
        ctx.fillRect(right - tw - 4, ty - size / 2 - 1, tw + 8, size + 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.fillText(opts.title, right, ty);
        ctx.restore();
      }
    },
    priceAxisLabels() {
      return opts.axisLabelVisible ? [{ price: opts.price, color: opts.color ?? themeLine }] : NO_LABELS;
    },
  };
  series.attachPrimitive(primitive);

  return {
    applyOptions(patch) {
      opts = mergePriceLineOptions(opts, patch);
      host?.requestUpdate();
    },
    options: () => ({ ...opts }),
    remove() {
      if (!attached) return;
      attached = false;
      series.detachPrimitive(primitive);
    },
  };
}
