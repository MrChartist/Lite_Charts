// Shared painting helpers for tool definitions: strokes on whole device pixels, translucent fills, labels on a backing
// that stays inside the pane, direction text. CSS px on a context that already carries the device transform.

import { deviceWidth, crispCoord } from '../render/pixel';
import { MINUS_SIGN } from '../core/format';
import { arrowHead, clipLine, type Pt } from './geometry';
import type { Drawing, RenderCtx } from './contract';

export const colorOf = (d: Drawing, c: RenderCtx['colors']): string => d.style.color ?? c.line;

/** `color` at opacity `a` (hex #RRGGBB or rgb / rgba; anything else is returned as is). */
export function alpha(color: string, a: number): string {
  const h = color.trim();
  if (h[0] === '#' && h.length === 7) return `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${a})`;
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(h);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})` : h;
}

/** Stroke the current path with the drawing's width (+ `extra`) and dash. `width` overrides the drawing's. */
export function stroke(rc: RenderCtx, d: Drawing, color: string, extra = 0, dash: 'solid' | 'dashed' = d.style.dash, width?: number): void {
  const { ctx } = rc;
  const w = deviceWidth((width ?? d.style.width) + extra, rc.ratio) / rc.ratio;
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash === 'dashed' ? [w * 4, w * 3] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** A thin secondary stroke (guides, levels): 1 px (+ extra), the colour at `a`. */
export function guide(rc: RenderCtx, d: Drawing, color: string, extra = 0, a = 0.7, dash: 'solid' | 'dashed' = 'solid'): void {
  const prev = rc.ctx.globalAlpha;
  rc.ctx.globalAlpha = prev * a;
  stroke(rc, d, color, extra, dash, 1);
  rc.ctx.globalAlpha = prev;
}

/** y on whole device pixels for a horizontal stroke of `width` (default: the drawing's). */
export function crispY(rc: RenderCtx, d: Drawing, y: number, width = d.style.width): number {
  const w = deviceWidth(width, rc.ratio);
  return crispCoord(y, w, rc.ratio) / rc.ratio;
}

export function crispX(rc: RenderCtx, d: Drawing, x: number, width = d.style.width): number {
  const w = deviceWidth(width, rc.ratio);
  return crispCoord(x, w, rc.ratio) / rc.ratio;
}

/** Label text size: the chart's, never under 12 px. */
export const labelPx = (rc: { fontSize: number }): number => Math.max(12, rc.fontSize);

/** A small label: text on a rounded backing in the background colour, kept inside the pane. Returns its box. */
export function label(rc: RenderCtx, text: string, x: number, y: number, color: string, align: 'left' | 'center' | 'right' = 'center', opts: { fill?: string; border?: string; weight?: number } = {}): { x: number; y: number; w: number; h: number } {
  const weight = opts.weight ?? 500;
  const w = rc.measure(text, weight) + 12;
  const h = labelPx(rc) + 8;
  let left = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w;
  left = Math.max(rc.rect.x + 2, Math.min(rc.rect.x + rc.rect.width - w - 2, left));
  const top = Math.max(rc.rect.y + 2, Math.min(rc.rect.y + rc.rect.height - h - 2, y - h / 2));
  const { ctx } = rc;
  ctx.fillStyle = opts.fill ?? alpha(rc.colors.background, 0.92);
  ctx.beginPath();
  roundRect(ctx, left, top, w, h, 4);
  ctx.fill();
  if (opts.border) { ctx.lineWidth = 1; ctx.strokeStyle = opts.border; ctx.stroke(); }
  rc.text(text, left + w / 2, top + h / 2, color, weight, 'center');
  return { x: left, y: top, w, h };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

/** A signed figure: '+' or a true minus in front when the body has a non-zero digit. */
export const sign = (v: number, body: string): string => (/[1-9]/.test(body) ? (v > 0 ? '+' : v < 0 ? MINUS_SIGN : '') : '') + body;

/** Text and arrow for a direction: '▲ ' / '▼ ' / ''. */
export const arrowFor = (dir: number): string => (dir > 0 ? '▲ ' : dir < 0 ? '▼ ' : '');

/** Text colour of a direction (the theme's up / down text colours, ink when flat). */
export const dirText = (rc: RenderCtx, dir: number): string => (dir > 0 ? rc.colors.upText : dir < 0 ? rc.colors.downText : rc.colors.text);
/** Mark colour of a direction. */
export const dirMark = (rc: RenderCtx, dir: number): string => (dir > 0 ? rc.colors.up : dir < 0 ? rc.colors.down : rc.colors.text);

/** Path through `pts` (closed when `close`). */
export function path(ctx: CanvasRenderingContext2D, pts: readonly Pt[], close = false): void {
  if (!pts.length) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (close) ctx.closePath();
}

/** Fill a polygon with `color` at `a`. */
export function fillPoly(rc: RenderCtx, pts: readonly Pt[], color: string, a: number): void {
  rc.ctx.beginPath();
  path(rc.ctx, pts, true);
  rc.ctx.fillStyle = alpha(color, a);
  rc.ctx.fill();
}

/** Add the visible part of the line a-b ('segment' | 'ray' | 'extended') to the path; false when nothing shows. */
export function lineTo(rc: RenderCtx, a: Pt, b: Pt, mode: 'segment' | 'ray' | 'extended'): boolean {
  const s = clipLine(a, b, rc.rect, mode);
  if (!s) return false;
  rc.ctx.moveTo(s[0].x, s[0].y);
  rc.ctx.lineTo(s[1].x, s[1].y);
  return true;
}

/** A filled arrow head at `tip`, pointing away from `tail`. */
export function head(rc: RenderCtx, tail: Pt, tip: Pt, size: number, color: string): void {
  const h = arrowHead(tail, tip, size);
  if (!h) return;
  rc.ctx.beginPath();
  rc.ctx.moveTo(h[0].x, h[0].y); rc.ctx.lineTo(h[1].x, h[1].y); rc.ctx.lineTo(h[2].x, h[2].y); rc.ctx.closePath();
  rc.ctx.fillStyle = color;
  rc.ctx.fill();
}

/** A ring of radius r (a point marker). */
export function dot(rc: RenderCtx, p: Pt, r: number, color: string, filled = true): void {
  rc.ctx.beginPath();
  rc.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  if (filled) { rc.ctx.fillStyle = color; rc.ctx.fill(); } else { rc.ctx.lineWidth = 1.5; rc.ctx.strokeStyle = color; rc.ctx.stroke(); }
}

/** y of the line a-b at x (a's y when vertical). */
export function lineYAt(a: Pt, b: Pt, x: number): number {
  return b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** Every point is drawable. */
export const finite = (pts: readonly Pt[], n = pts.length): boolean => {
  if (pts.length < n) return false;
  for (let i = 0; i < n; i++) if (!Number.isFinite(pts[i].x) || !Number.isFinite(pts[i].y)) return false;
  return true;
};

/** Set the label font on the context (for text painted directly). */
export function font(rc: RenderCtx, weight = 500, px = labelPx(rc)): void {
  rc.ctx.font = `${weight} ${px}px ${rc.fontFamily}`;
  rc.ctx.textBaseline = 'middle';
  rc.ctx.direction = 'ltr';
}

/**
 * Label y positions that do not overlap: given wanted ys (any order), returns for each whether it fits (at least one
 * label height from the last kept one, in y order). Used by tools with many level labels.
 */
export function spaced(ys: readonly number[], gap: number): boolean[] {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const keep = new Array<boolean>(ys.length).fill(false);
  let last = -Infinity;
  for (const [y, i] of order) if (Number.isFinite(y) && y - last >= gap) { keep[i] = true; last = y; }
  return keep;
}
