// Annotations: anchored text, callout, price label, price note, arrow markers up and down, flag, highlighter.

import { distToSegment, inBox, type Pt } from '../geometry';
import type { Drawing, Proj, RenderCtx, ToolDefinition, View } from '../contract';
import { alpha, colorOf, dot, font, label, labelPx, roundRect, stroke } from '../paint';
import { hitPath } from './basic';
import { ok, ring } from './common';

const PAD_X = 8;

/** Box of a text block whose left middle is at (x, y). */
function textBox(view: View, text: string, x: number, y: number): { x: number; y: number; w: number; h: number } {
  const w = view.measure(text, 500) + 2 * PAD_X;
  const h = Math.max(12, view.fontSize) + 12;
  return { x, y: y - h / 2, w, h };
}

/** A rounded box with a hairline border in the drawing colour and ink text. */
function boxText(rc: RenderCtx, d: Drawing, text: string, b: { x: number; y: number; w: number; h: number }, extra: number): void {
  const color = colorOf(d, rc.colors);
  rc.ctx.beginPath();
  roundRect(rc.ctx, b.x, b.y, b.w, b.h, 6);
  rc.ctx.fillStyle = alpha(rc.colors.background, 0.96);
  rc.ctx.fill();
  rc.ctx.fillStyle = alpha(color, 0.1);
  rc.ctx.fill();
  stroke(rc, d, color, extra, 'solid', 1);
  rc.text(text, b.x + b.w / 2, b.y + b.h / 2, rc.colors.text, 500, 'center');
}

const shown = (d: Drawing, placeholder: string): string => (d.text && d.text.trim() ? d.text : placeholder);

export const anchoredText: ToolDefinition = {
  id: 'anchoredText', label: 'Pinned text', group: 'annotate', points: 1, text: 'Note',
  hint: 'Pinned text: a note in a box, pinned to a bar and a price',
  icon: `${ring(5, 18)}M6.5 16.5L9 14M9 5h11.5v9H9zM12 8.5h5.5M12 11h3.5`,
  render(rc, d, [a], extra) {
    if (!ok([a], 1)) return;
    const b = textBox(rc, shown(d, 'Note'), a.x + 10, a.y - 16);
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x + 6, b.y + b.h);
    stroke(rc, d, colorOf(d, rc.colors), extra, 'solid', 1);
    boxText(rc, d, shown(d, 'Note'), b, extra);
    dot(rc, a, 3, colorOf(d, rc.colors));
  },
  hit(d, [a], p, tol, view) {
    if (!ok([a], 1)) return false;
    const b = textBox(view, shown(d, 'Note'), a.x + 10, a.y - 16);
    return inBox(p, { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, tol) || Math.hypot(p.x - a.x, p.y - a.y) <= tol;
  },
};

export const callout: ToolDefinition = {
  id: 'callout', label: 'Callout', group: 'annotate', points: 2, text: 'Callout',
  hint: 'Callout: the point it refers to, then where the text goes',
  icon: `${ring(5, 19)}M6.4 17.6L10 14M8 4.5h12.5v9.5H8z`,
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const t = shown(d, 'Callout');
    const box = textBox(rc, t, b.x, b.y);
    box.x -= box.w / 2;
    const cx = Math.max(box.x, Math.min(box.x + box.w, a.x)), cy = Math.max(box.y, Math.min(box.y + box.h, a.y));
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(cx, cy);
    stroke(rc, d, colorOf(d, rc.colors), extra);
    boxText(rc, d, t, box, extra);
    dot(rc, a, 3, colorOf(d, rc.colors));
  },
  hit(d, [a, b], p, tol, view) {
    if (!ok([a, b], 2)) return false;
    const box = textBox(view, shown(d, 'Callout'), b.x, b.y);
    box.x -= box.w / 2;
    return inBox(p, { x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h }, tol) || distToSegment(p, a, b) <= tol;
  },
  handles: (_d, [a, b]) => [a, b],
};

/** A tag above the point with a small pointer down to it. */
function tagBox(view: View, text: string, a: Pt): { x: number; y: number; w: number; h: number } {
  const w = view.measure(text, 600) + 14;
  const h = Math.max(12, view.fontSize) + 10;
  return { x: a.x - w / 2, y: a.y - h - 7, w, h };
}

export const priceLabel: ToolDefinition = {
  id: 'priceLabel', label: 'Price label', group: 'annotate', points: 1,
  hint: 'Price label: a tag with the price of the point',
  icon: 'M5 4.5h14v10h-4.5L12 18l-2.5-3.5H5zM9 9.5h6',
  render(rc, d, [a]) {
    if (!ok([a], 1)) return;
    const t = rc.fmt(d.points[0].price);
    const b = tagBox(rc, t, a);
    const color = colorOf(d, rc.colors);
    rc.ctx.beginPath();
    roundRect(rc.ctx, b.x, b.y, b.w, b.h, 5);
    rc.ctx.moveTo(a.x - 5, b.y + b.h); rc.ctx.lineTo(a.x, a.y - 1); rc.ctx.lineTo(a.x + 5, b.y + b.h);
    rc.ctx.fillStyle = color;
    rc.ctx.fill();
    rc.text(t, a.x, b.y + b.h / 2, rc.colors.background, 600, 'center');
  },
  hit(d, [a], p, tol, view) {
    if (!ok([a], 1)) return false;
    const b = tagBox(view, String(d.points[0].price), a);
    return inBox(p, { x: b.x, y: b.y }, { x: b.x + b.w, y: a.y }, tol);
  },
  handles: (_d, [a]) => (a ? [a] : []),
};

export const priceNote: ToolDefinition = {
  id: 'priceNote', label: 'Price note', group: 'annotate', points: 2,
  hint: 'Price note: a line from a point to a label with its price',
  icon: `${ring(5, 18)}M6.5 16.5L11 12M11 7.5h9.5V12H11z`,
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x, b.y);
    stroke(rc, d, color, extra);
    dot(rc, a, 3, color);
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    label(rc, rc.fmt(d.points[0].price), b.x + (b.x >= a.x ? 4 : -4), b.y, colorOf(d, rc.colors), b.x >= a.x ? 'left' : 'right', { border: alpha(colorOf(d, rc.colors), 0.6) });
  },
  hit: (_d, [a, b], p, tol) => ok([a, b], 2) && distToSegment(p, a, b) <= tol,
};

/** A filled marker arrow 16 px wide: up below the point (tip at the point), down above it. */
function markerPath(rc: { ctx: CanvasRenderingContext2D }, a: Pt, up: boolean, s = 1): void {
  const k = up ? 1 : -1;
  const tip = { x: a.x, y: a.y + k * 4 };
  const { ctx } = rc;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + 8 * s, tip.y + k * 9 * s);
  ctx.lineTo(tip.x + 3.5 * s, tip.y + k * 9 * s);
  ctx.lineTo(tip.x + 3.5 * s, tip.y + k * 20 * s);
  ctx.lineTo(tip.x - 3.5 * s, tip.y + k * 20 * s);
  ctx.lineTo(tip.x - 3.5 * s, tip.y + k * 9 * s);
  ctx.lineTo(tip.x - 8 * s, tip.y + k * 9 * s);
  ctx.closePath();
}

function marker(up: boolean): ToolDefinition {
  return {
    id: up ? 'arrowUp' : 'arrowDown', label: up ? 'Arrow mark up' : 'Arrow mark down', group: 'annotate', points: 1,
    hint: up ? 'Arrow mark up: a buy or rise marker under the point' : 'Arrow mark down: a sell or fall marker over the point',
    icon: up ? 'M12 4l6.5 7H14v8.5h-4V11H5.5z' : 'M12 20l6.5-7H14V4.5h-4V13H5.5z',
    render(rc, d, [a], extra) {
      if (!ok([a], 1)) return;
      const color = d.style.color ?? (up ? rc.colors.up : rc.colors.down);
      markerPath(rc, a, up, 1 + extra * 0.08);
      rc.ctx.fillStyle = color;
      rc.ctx.fill();
      if (d.text) label(rc, d.text, a.x, a.y + (up ? 1 : -1) * (24 + labelPx(rc) / 2 + 4), up ? rc.colors.upText : rc.colors.downText);
    },
    hit: (_d, [a], p, tol) => ok([a], 1) && inBox(p, { x: a.x - 8, y: a.y }, { x: a.x + 8, y: a.y + (up ? 24 : -24) }, tol),
    handles: (_d, [a]) => (a ? [a] : []),
  };
}

export const arrowUp = marker(true);
export const arrowDown = marker(false);

export const flag: ToolDefinition = {
  id: 'flag', label: 'Flag', group: 'annotate', points: 1,
  hint: 'Flag: marks a bar',
  icon: 'M6 20.5V4M6 4.5h11l-2.5 4 2.5 4H6',
  render(rc, d, [a], extra) {
    if (!ok([a], 1)) return;
    const color = colorOf(d, rc.colors);
    const top = a.y - 26;
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(a.x, top);
    stroke(rc, d, color, extra, 'solid', 2);
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, top); rc.ctx.lineTo(a.x + 16, top); rc.ctx.lineTo(a.x + 12, top + 5.5); rc.ctx.lineTo(a.x + 16, top + 11); rc.ctx.lineTo(a.x, top + 11); rc.ctx.closePath();
    rc.ctx.fillStyle = color;
    rc.ctx.fill();
    if (d.text) { font(rc); rc.ctx.textAlign = 'left'; rc.ctx.fillStyle = rc.colors.text; rc.ctx.fillText(d.text, a.x + 20, top + 5.5); }
  },
  hit: (_d, [a], p, tol) => ok([a], 1) && inBox(p, { x: a.x - 2, y: a.y - 26 }, { x: a.x + 16, y: a.y }, tol),
  handles: (_d, [a]) => (a ? [a] : []),
};

/** Highlighter: a wide translucent freehand stroke (12 px at width 2) that never hides what is under it. */
export const highlighter: ToolDefinition = {
  id: 'highlighter', label: 'Highlighter', group: 'annotate', points: 0, minPoints: 2, maxPoints: 0,
  hint: 'Highlighter: press and drag to mark an area',
  icon: 'M14.5 4.5l5 5-8 8H6.5v-5zM4 20.5h16',
  style: { color: '#F5B700' },
  render(rc, d, pts, extra) {
    if (pts.length < 2) return;
    const { ctx } = rc;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineWidth = 6 * d.style.width + extra;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = alpha(colorOf(d, rc.colors), 0.32);
    ctx.stroke();
  },
  hit: (d, pts: readonly Proj[], p, tol) => pts.length >= 2 && hitPath(pts, p, tol + 3 * d.style.width),
  handles: () => [],
};

export const ANNOTATION_TOOLS: readonly ToolDefinition[] = [anchoredText, callout, priceLabel, priceNote, arrowUp, arrowDown, flag, highlighter];
