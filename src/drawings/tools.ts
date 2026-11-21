// The tool catalogue: what each drawing needs to be created, how it is painted and how it is hit. Painting is in CSS
// px on a context that already carries the device transform (the primitive scope); axis-aligned edges are placed on
// whole device pixels. Hit testing is pure (projected points in, part index out).

import { crispCoord, deviceWidth } from '../render/pixel';
import { arrowHead, clipLine, distToPolyline, distToSegment, FIB_LEVELS, fibPrices, formatSpan, inBox, measureStats, positionStats, type Pt, type Rect } from './geometry';
import type { ThemeColors } from '../core/theme';
import { formatPercent, MINUS_SIGN } from '../core/format';

export type ToolId =
  | 'trend' | 'ray' | 'extended' | 'horizontal' | 'horizontalRay' | 'vertical' | 'rectangle' | 'channel' | 'fib'
  | 'measure' | 'long' | 'short' | 'arrow' | 'text' | 'brush';

/** A point of a drawing: a time (UNIX seconds; past the data it is extrapolated) and a price. */
export interface Anchor { time: number; price: number }

export interface DrawingStyle {
  /** CSS colour; the theme's line colour when absent. */
  color?: string;
  width: 1 | 2 | 3;
  dash: 'solid' | 'dashed';
}

export interface Drawing {
  id: string;
  tool: ToolId;
  points: Anchor[];
  style: DrawingStyle;
  /** Text of a text note; a short label at the right end of a horizontal line. */
  text?: string;
  /** Pane the drawing lives in (0 = top). */
  pane: number;
  /** A locked drawing cannot be moved or edited by pointer (it can still be selected and deleted). */
  locked?: boolean;
}

export interface ToolInfo {
  id: ToolId;
  label: string;
  /** Points placed when creating; 0 = freehand (press, move, release). */
  points: number;
}

export const TOOLS: readonly ToolInfo[] = [
  { id: 'trend', label: 'Trend line', points: 2 },
  { id: 'ray', label: 'Ray', points: 2 },
  { id: 'extended', label: 'Extended line', points: 2 },
  { id: 'horizontal', label: 'Horizontal line', points: 1 },
  { id: 'horizontalRay', label: 'Horizontal ray', points: 1 },
  { id: 'vertical', label: 'Vertical line', points: 1 },
  { id: 'rectangle', label: 'Rectangle', points: 2 },
  { id: 'channel', label: 'Parallel channel', points: 3 },
  { id: 'fib', label: 'Fibonacci retracement', points: 2 },
  { id: 'measure', label: 'Measure', points: 2 },
  { id: 'long', label: 'Long position', points: 2 },
  { id: 'short', label: 'Short position', points: 2 },
  { id: 'arrow', label: 'Arrow', points: 2 },
  { id: 'text', label: 'Text note', points: 1 },
  { id: 'brush', label: 'Brush', points: 0 },
];

export const toolInfo = (id: ToolId): ToolInfo | undefined => TOOLS.find(t => t.id === id);

/** A projected anchor: pixel position and its fractional logical index. */
export interface Proj extends Pt { l: number }

export interface RenderCtx {
  ctx: CanvasRenderingContext2D;
  rect: Rect;
  colors: Readonly<ThemeColors>;
  ratio: number;
  fontFamily: string;
  fontSize: number;
  fmt: (price: number) => string;
  text: (t: string, x: number, y: number, color: string, weight?: number, align?: 'left' | 'center' | 'right') => void;
  measure: (t: string, weight?: number) => number;
}

/** Body hit (as opposed to a handle index). */
export const BODY = 100;

export const colorOf = (d: Drawing, c: Readonly<ThemeColors>): string => d.style.color ?? c.line;

function alpha(color: string, a: number): string {
  const h = color.trim();
  if (h[0] === '#' && h.length === 7) return `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${a})`;
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(h);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})` : h;
}

function stroke(rc: RenderCtx, d: Drawing, color: string, extra = 0, dash: 'solid' | 'dashed' = d.style.dash): void {
  const { ctx } = rc;
  const w = deviceWidth(d.style.width + extra, rc.ratio) / rc.ratio;
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash === 'dashed' ? [w * 4, w * 3] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** y on whole device pixels for a horizontal stroke of this drawing's width. */
function crispY(rc: RenderCtx, d: Drawing, y: number): number {
  const w = deviceWidth(d.style.width, rc.ratio);
  return crispCoord(y, w, rc.ratio) / rc.ratio;
}

function crispX(rc: RenderCtx, d: Drawing, x: number): number {
  const w = deviceWidth(d.style.width, rc.ratio);
  return crispCoord(x, w, rc.ratio) / rc.ratio;
}

/** A small label: text on a rounded backing in the background colour, kept inside the pane. */
function label(rc: RenderCtx, text: string, x: number, y: number, color: string, align: 'left' | 'center' | 'right' = 'center'): void {
  const w = rc.measure(text, 500) + 12;
  const h = rc.fontSize + 8;
  let left = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w;
  left = Math.max(rc.rect.x + 2, Math.min(rc.rect.x + rc.rect.width - w - 2, left));
  const top = Math.max(rc.rect.y + 2, Math.min(rc.rect.y + rc.rect.height - h - 2, y - h / 2));
  const { ctx } = rc;
  ctx.fillStyle = alpha(rc.colors.background, 0.92);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(left, top, w, h, 4); else ctx.rect(left, top, w, h);
  ctx.fill();
  rc.text(text, left + w / 2, top + h / 2, color, 500, 'center');
}

const sign = (v: number, body: string): string => (/[1-9]/.test(body) ? (v > 0 ? '+' : v < 0 ? MINUS_SIGN : '') : '') + body;

/** Paint one drawing. `pts` are its projected anchors in chart coordinates; `timeOf` reads an anchor's time. */
export function renderDrawing(rc: RenderCtx, d: Drawing, pts: readonly Proj[], extra = 0): void {
  const { ctx, rect, colors } = rc;
  const color = colorOf(d, colors);
  const [a, b, c] = pts;
  ctx.beginPath();
  switch (d.tool) {
    case 'trend': case 'ray': case 'extended': case 'arrow': {
      if (!a || !b) return;
      const seg = clipLine(a, b, rect, d.tool === 'ray' ? 'ray' : d.tool === 'extended' ? 'extended' : 'segment');
      if (!seg) return;
      ctx.moveTo(seg[0].x, seg[0].y);
      ctx.lineTo(seg[1].x, seg[1].y);
      stroke(rc, d, color, extra);
      if (d.tool === 'arrow') {
        const h = arrowHead(a, b, 9 + 2 * d.style.width);
        if (h) {
          ctx.beginPath();
          ctx.moveTo(h[0].x, h[0].y); ctx.lineTo(h[1].x, h[1].y); ctx.lineTo(h[2].x, h[2].y); ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
      return;
    }
    case 'horizontal': case 'horizontalRay': {
      if (!a) return;
      const y = crispY(rc, d, a.y);
      const x0 = d.tool === 'horizontal' ? rect.x : Math.max(rect.x, a.x);
      ctx.moveTo(x0, y);
      ctx.lineTo(rect.x + rect.width, y);
      stroke(rc, d, color, extra);
      if (d.text) label(rc, d.text, rect.x + rect.width - 4, y - rc.fontSize, color, 'right');
      return;
    }
    case 'vertical': {
      if (!a) return;
      const x = crispX(rc, d, a.x);
      ctx.moveTo(x, rect.y);
      ctx.lineTo(x, rect.y + rect.height);
      stroke(rc, d, color, extra);
      return;
    }
    case 'rectangle': {
      if (!a || !b) return;
      const x0 = crispX(rc, d, Math.min(a.x, b.x));
      const x1 = crispX(rc, d, Math.max(a.x, b.x));
      const y0 = crispY(rc, d, Math.min(a.y, b.y));
      const y1 = crispY(rc, d, Math.max(a.y, b.y));
      ctx.fillStyle = alpha(color, 0.1);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      stroke(rc, d, color, extra);
      return;
    }
    case 'channel': {
      if (!a || !b) return;
      const off = c ? c.y - lineYAt(a, b, c.x) : 0;
      const a2 = { x: a.x, y: a.y + off };
      const b2 = { x: b.x, y: b.y + off };
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(a2.x, a2.y); ctx.closePath();
      ctx.fillStyle = alpha(color, 0.08);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      if (c) { ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); }
      stroke(rc, d, color, extra);
      if (c) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y + off / 2); ctx.lineTo(b.x, b.y + off / 2);
        ctx.globalAlpha = 0.6;
        stroke(rc, d, color, 0, 'dashed');
        ctx.globalAlpha = 1;
      }
      return;
    }
    case 'fib': {
      if (!a || !b) return;
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const span = b.y - a.y;
      for (let i = 0; i < FIB_LEVELS.length; i++) {
        const lv = FIB_LEVELS[i];
        const y = crispY(rc, d, b.y - span * lv);
        if (i > 0) {
          const yPrev = b.y - span * FIB_LEVELS[i - 1];
          ctx.fillStyle = alpha(color, i % 2 ? 0.06 : 0.03);
          ctx.fillRect(x0, Math.min(y, yPrev), x1 - x0, Math.abs(y - yPrev));
        }
        ctx.beginPath();
        ctx.moveTo(x0, y); ctx.lineTo(x1, y);
        stroke(rc, d, color, extra);
      }
      return;
    }
    case 'measure': {
      if (!a || !b) return;
      ctx.fillStyle = alpha(b.y <= a.y ? colors.up : colors.down, 0.1);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      stroke(rc, d, color, extra);
      return;
    }
    case 'long': case 'short': {
      if (!a || !b || !c) return;
      const x0 = crispX(rc, d, Math.min(a.x, b.x));
      const x1 = crispX(rc, d, Math.max(a.x, b.x));
      ctx.fillStyle = alpha(colors.up, 0.14);
      ctx.fillRect(x0, Math.min(a.y, b.y), x1 - x0, Math.abs(b.y - a.y));
      ctx.fillStyle = alpha(colors.down, 0.14);
      ctx.fillRect(x0, Math.min(a.y, c.y), x1 - x0, Math.abs(c.y - a.y));
      const ye = crispY(rc, d, a.y);
      ctx.moveTo(x0, ye); ctx.lineTo(x1, ye);
      stroke(rc, d, colors.text, extra);
      return;
    }
    case 'text': {
      if (!a) return;
      const t = d.text || 'Text';
      ctx.font = `500 ${rc.fontSize + 1}px ${rc.fontFamily}`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.direction = 'ltr';
      ctx.fillText(t, a.x, a.y);
      return;
    }
    case 'brush': {
      if (pts.length < 2) return;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      stroke(rc, d, color, extra);
      return;
    }
    default:
      return;
  }
}

/** Labels of a drawing (price figures, measure and position figures), painted after every drawing body. */
export function renderLabels(rc: RenderCtx, d: Drawing, pts: readonly Proj[]): void {
  const [a, b, c] = pts;
  const colors = rc.colors;
  if (d.tool === 'fib' && a && b) {
    const prices = fibPrices(d.points[0].price, d.points[1].price);
    const x0 = Math.min(a.x, b.x);
    for (let i = 0; i < FIB_LEVELS.length; i++) {
      const y = b.y - (b.y - a.y) * FIB_LEVELS[i];
      label(rc, `${FIB_LEVELS[i]} (${rc.fmt(prices[i])})`, x0 + 2, y - rc.fontSize / 2 - 4, colorOf(d, colors), 'left');
    }
  } else if (d.tool === 'measure' && a && b) {
    const st = measureStats({ logical: a.l, price: d.points[0].price, time: d.points[0].time }, { logical: b.l, price: d.points[1].price, time: d.points[1].time });
    const body = rc.fmt(Math.abs(st.change)).replace(MINUS_SIGN, '');
    const arrow = st.dir > 0 ? '▲ ' : st.dir < 0 ? '▼ ' : '';
    const color = st.dir > 0 ? colors.upText : st.dir < 0 ? colors.downText : colors.text;
    const below = b.y >= a.y;
    const y = below ? Math.max(a.y, b.y) + rc.fontSize + 6 : Math.min(a.y, b.y) - rc.fontSize - 6;
    label(rc, `${arrow}${sign(st.change, body)} (${formatPercent(st.percent, 2)})  ${st.bars} bars, ${formatSpan(st.seconds)}`, (a.x + b.x) / 2, y, color);
  } else if ((d.tool === 'long' || d.tool === 'short') && a && b && c) {
    const st = positionStats(d.points[0].price, d.points[1].price, d.points[2].price);
    const x = Math.max(a.x, b.x) - 6;
    label(rc, `Target ${rc.fmt(d.points[1].price)} (${formatPercent(st.targetPct, 2)})`, x, b.y + (b.y < a.y ? rc.fontSize : -rc.fontSize), colors.upText, 'right');
    label(rc, `Stop ${rc.fmt(d.points[2].price)} (${formatPercent(st.stopPct, 2)})`, x, c.y + (c.y < a.y ? rc.fontSize : -rc.fontSize), colors.downText, 'right');
    label(rc, `R:R ${st.ratio.toFixed(2)}`, x, a.y, colors.text, 'right');
  }
}

/** Where a drawing's handles are (one per editable point). */
export function handlePoints(d: Drawing, pts: readonly Proj[], rect: Rect): Pt[] {
  if (d.tool === 'vertical' && pts[0]) return [{ x: pts[0].x, y: rect.y + rect.height / 2 }];
  if (d.tool === 'horizontal' && pts[0]) return [{ x: Math.min(Math.max(pts[0].x, rect.x + 12), rect.x + rect.width - 12), y: pts[0].y }];
  if (d.tool === 'brush') return [];
  if (d.tool === 'text') return [];
  return pts.slice();
}

function lineYAt(a: Pt, b: Pt, x: number): number {
  return b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/**
 * What the point `p` hits on a drawing: a handle index, `BODY`, or -1. `tol` is the tolerance in px (larger on touch).
 * `rect` is the pane, used by lines that run to its edge.
 */
export function hitDrawing(d: Drawing, pts: readonly Proj[], p: Pt, tol: number, rect: Rect, measure?: (t: string) => number): number {
  const hs = handlePoints(d, pts, rect);
  for (let i = 0; i < hs.length; i++) if (Math.hypot(p.x - hs[i].x, p.y - hs[i].y) <= tol + 2) return i;
  const [a, b, c] = pts;
  switch (d.tool) {
    case 'trend': case 'ray': case 'extended': case 'arrow': {
      if (!a || !b) return -1;
      const seg = clipLine(a, b, rect, d.tool === 'ray' ? 'ray' : d.tool === 'extended' ? 'extended' : 'segment');
      return seg && distToSegment(p, seg[0], seg[1]) <= tol ? BODY : -1;
    }
    case 'horizontal': return a && Math.abs(p.y - a.y) <= tol ? BODY : -1;
    case 'horizontalRay': return a && Math.abs(p.y - a.y) <= tol && p.x >= a.x - tol ? BODY : -1;
    case 'vertical': return a && Math.abs(p.x - a.x) <= tol ? BODY : -1;
    case 'rectangle': case 'measure': case 'fib':
      return a && b && inBox(p, a, b, tol) ? BODY : -1;
    case 'channel': {
      if (!a || !b) return -1;
      const off = c ? c.y - lineYAt(a, b, c.x) : 0;
      const yl = lineYAt(a, b, p.x);
      const inX = p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol;
      return inX && p.y >= Math.min(yl, yl + off) - tol && p.y <= Math.max(yl, yl + off) + tol ? BODY : -1;
    }
    case 'long': case 'short': {
      if (!a || !b || !c) return -1;
      const top = Math.min(a.y, b.y, c.y);
      const bottom = Math.max(a.y, b.y, c.y);
      return inBox(p, { x: a.x, y: top }, { x: b.x, y: bottom }, tol) ? BODY : -1;
    }
    case 'text': {
      if (!a) return -1;
      const w = measure ? measure(d.text || 'Text') : 40;
      return inBox(p, { x: a.x, y: a.y - 10 }, { x: a.x + w, y: a.y + 10 }, tol) ? BODY : -1;
    }
    case 'brush': return distToPolyline(p, pts) <= tol ? BODY : -1;
    default: return -1;
  }
}

/** The pixel box a drawing can paint in, or null for one that runs to the pane edges (always considered visible). */
export function paintBox(d: Drawing, pts: readonly Proj[]): Rect | null {
  if (d.tool === 'ray' || d.tool === 'extended' || d.tool === 'horizontal' || d.tool === 'horizontalRay' || d.tool === 'vertical') return null;
  if (pts.length === 0) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  if (d.tool === 'channel' && pts.length === 3) {
    const off = pts[2].y - lineYAt(pts[0], pts[1], pts[2].x);
    y0 = Math.min(y0, y0 + off); y1 = Math.max(y1, y1 + off);
  }
  const pad = 200; // labels and text reach past the anchors
  return { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad };
}

/** Two rectangles overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
