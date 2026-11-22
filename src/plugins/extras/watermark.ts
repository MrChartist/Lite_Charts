// Watermarks: text (or an image) drawn on the canvas behind the series, so it is part of every screenshot. A primitive
// on the chart's top pane at the 'bottom' layer; it never touches the DOM (an image is only loaded, never attached).

import type { ChartApi } from '../../api';
import type { ChartPrimitive, PrimitiveHost } from '../primitive';
import type { Removable } from './common';
import { removable } from './common';

export type WatermarkPosition = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
const POSITIONS: readonly string[] = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

export interface WatermarkOptions {
  /** The big line. */
  text: string;
  /** Smaller lines under it (a name and a timeframe, say). */
  lines?: readonly string[];
  /** Default 'center'. */
  position: WatermarkPosition;
  /** 0..1 of the text colour over the background. Default 0.08. */
  opacity: number;
  /** CSS px of the big line; shrinks to fit the pane. Default 56. */
  fontSize: number;
  /** CSS colour. Default the theme's text colour. */
  color?: string;
}

export interface WatermarkHandle extends Removable {
  applyOptions(options: Partial<WatermarkOptions>): void;
  options(): Readonly<WatermarkOptions>;
}

/** Margin kept from the pane edge for a corner placement. */
const EDGE = 16;

/**
 * Where a block of `w` x `h` sits in a pane of `pane` (CSS px, relative to the pane's top-left): returns its top-left.
 * Pure.
 */
export function placeBlock(position: WatermarkPosition, w: number, h: number, pane: { width: number; height: number }): { x: number; y: number } {
  switch (position) {
    case 'top-left': return { x: EDGE, y: EDGE };
    case 'top-right': return { x: pane.width - w - EDGE, y: EDGE };
    case 'bottom-left': return { x: EDGE, y: pane.height - h - EDGE };
    case 'bottom-right': return { x: pane.width - w - EDGE, y: pane.height - h - EDGE };
    default: return { x: (pane.width - w) / 2, y: (pane.height - h) / 2 };
  }
}

/** The font size that makes text `measured` px wide (at `size`) fit `max` px, never above `size`, never below 10. */
export function fitFontSize(size: number, measured: number, max: number): number {
  if (!(measured > max) || !(max > 0)) return size;
  return Math.max(10, Math.floor((size * max) / measured));
}

function merge(base: WatermarkOptions, patch: Partial<WatermarkOptions>): WatermarkOptions {
  const out = { ...base, ...patch };
  if (typeof out.text !== 'string') throw new TypeError('Chartist Lite: watermark "text" must be a string');
  if (!POSITIONS.includes(out.position)) throw new TypeError('Chartist Lite: watermark "position" must be "center", "top-left", "top-right", "bottom-left" or "bottom-right"');
  if (!(out.opacity >= 0 && out.opacity <= 1)) throw new TypeError('Chartist Lite: watermark "opacity" must be between 0 and 1');
  if (!(out.fontSize > 0) || !Number.isFinite(out.fontSize)) throw new TypeError('Chartist Lite: watermark "fontSize" must be a number above 0');
  return out;
}

export function createWatermark(chart: ChartApi, options: Partial<WatermarkOptions> & { text: string }): WatermarkHandle {
  let opts = merge({ text: '', position: 'center', opacity: 0.08, fontSize: 56 }, options);
  let host: PrimitiveHost | null = null;
  const prim: ChartPrimitive = {
    zOrder: 'bottom',
    attached(h) { host = h; },
    detached() { host = null; },
    draw(s) {
      const lines = [opts.text, ...(opts.lines ?? [])].filter(Boolean);
      if (!lines.length) return;
      const { ctx, pane } = s;
      const place = pane.width - EDGE * 2;
      ctx.save();
      ctx.globalAlpha = opts.opacity;
      ctx.fillStyle = opts.color ?? s.colors.text;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      // The big line sets the scale; the rest are 40% of it (never under 12 px).
      let size = opts.fontSize;
      ctx.font = `700 ${size}px ${s.fontFamily}`;
      size = fitFontSize(size, ctx.measureText(lines[0]).width, place);
      const small = Math.max(12, Math.round(size * 0.4));
      const widths: number[] = [];
      const heights: number[] = [];
      lines.forEach((l, i) => {
        const px = i === 0 ? size : small;
        ctx.font = `${i === 0 ? 700 : 600} ${px}px ${s.fontFamily}`;
        widths.push(ctx.measureText(l).width);
        heights.push(Math.round(px * 1.25));
      });
      const w = Math.max(...widths);
      const h = heights.reduce((a, b) => a + b, 0);
      const at = placeBlock(opts.position, w, h, pane);
      let y = pane.y + at.y;
      lines.forEach((l, i) => {
        const px = i === 0 ? size : small;
        ctx.font = `${i === 0 ? 700 : 600} ${px}px ${s.fontFamily}`;
        // Corner blocks align to their edge; the centre block centres each line.
        const align = opts.position === 'center' ? (w - widths[i]) / 2 : opts.position.endsWith('right') ? w - widths[i] : 0;
        ctx.fillText(l, pane.x + at.x + align, y + heights[i] / 2);
        y += heights[i];
      });
      ctx.restore();
    },
  };
  chart.attachPrimitive(prim);
  return removable({
    applyOptions(patch: Partial<WatermarkOptions>) { opts = merge(opts, patch); host?.requestUpdate(); },
    options: () => ({ ...opts }),
  }, () => { try { chart.detachPrimitive(prim); } catch { /* chart removed */ } });
}

export interface ImageWatermarkOptions {
  /** A URL (loaded with `crossOrigin = 'anonymous'`, so a screenshot stays exportable) or a ready image / canvas / bitmap. */
  image: string | CanvasImageSource;
  position: WatermarkPosition;
  opacity: number;
  /** CSS px width the image is drawn at (height follows its ratio). Default 120. */
  width: number;
}

export interface ImageWatermarkHandle extends Removable {
  applyOptions(options: Partial<ImageWatermarkOptions>): void;
}

export function createImageWatermark(chart: ChartApi, options: Partial<ImageWatermarkOptions> & { image: string | CanvasImageSource }): ImageWatermarkHandle {
  let opts: ImageWatermarkOptions = { position: 'bottom-right', opacity: 0.35, width: 120, ...options };
  let host: PrimitiveHost | null = null;
  let img: CanvasImageSource | null = null;
  let removed = false;
  const load = (src: string | CanvasImageSource): void => {
    if (typeof src !== 'string') { img = src; return; }
    const win = chart.element().ownerDocument.defaultView as (Window & { Image: typeof Image }) | null;
    if (!win) return;
    const el = new win.Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => { if (!removed) { img = el; host?.requestUpdate(); } };
    el.src = src;
  };
  load(opts.image);
  const size = (i: CanvasImageSource): { w: number; h: number } => {
    const a = i as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
    return { w: a.naturalWidth || a.width || 1, h: a.naturalHeight || a.height || 1 };
  };
  const prim: ChartPrimitive = {
    zOrder: 'bottom',
    attached(h) { host = h; },
    detached() { host = null; },
    draw(s) {
      if (!img) return;
      const n = size(img);
      const w = Math.min(opts.width, s.pane.width - EDGE * 2);
      const h = (w * n.h) / n.w;
      const at = placeBlock(opts.position, w, h, s.pane);
      s.ctx.save();
      s.ctx.globalAlpha = opts.opacity;
      s.ctx.drawImage(img, s.pane.x + at.x, s.pane.y + at.y, w, h);
      s.ctx.restore();
    },
  };
  chart.attachPrimitive(prim);
  return removable({
    applyOptions(patch: Partial<ImageWatermarkOptions>) {
      opts = { ...opts, ...patch };
      if (patch.image !== undefined) load(patch.image);
      host?.requestUpdate();
    },
  }, () => { removed = true; try { chart.detachPrimitive(prim); } catch { /* chart removed */ } });
}
