// The basic set (BASIC_TOOLS): the fifteen tools the drawings entry started with, as definitions of the tool contract.

import { formatPercent, MINUS_SIGN } from '../../core/format';
import { distToPolylineChunked, chunkBoxes, FIB_LEVELS, formatSpan, inBox, measureStats, positionStats, type Pt } from '../geometry';
import type { Anchor, Proj, ToolDefinition } from '../contract';
import { alpha, arrowFor, colorOf, crispX, crispY, dirText, font, head, label, labelPx, lineTo, lineYAt, sign, stroke } from '../paint';
import { inside, levelsOf, levelsReader, nearLine, ok, ratioText, ring } from './common';

const line = (id: 'trend' | 'ray' | 'extended' | 'arrow', label: string, icon: string, key?: string): ToolDefinition => {
  const mode = id === 'ray' ? 'ray' : id === 'extended' ? 'extended' : 'segment';
  return {
    id, label, icon, key, group: id === 'arrow' ? 'annotate' : 'lines', points: 2,
    bounds: mode === 'segment' ? 'anchors' : 'pane',
    render(rc, d, [a, b], extra) {
      if (!ok([a, b], 2)) return;
      const color = colorOf(d, rc.colors);
      rc.ctx.beginPath();
      if (!lineTo(rc, a, b, mode)) return;
      stroke(rc, d, color, extra);
      if (id === 'arrow') head(rc, a, b, 9 + 2 * d.style.width, color);
    },
    hit: (d, [a, b], p, tol, view) => ok([a, b], 2) && nearLine(p, a, b, tol, view, mode),
  };
};

/** Shared by long and short: a stop at half the target distance on the other side (a 2.00 reward to risk). */
function positionComplete(pts: Anchor[]): Anchor[] {
  const out = pts.map(p => ({ ...p }));
  if (out.length === 2) out.push({ time: out[1].time, price: out[0].price - (out[1].price - out[0].price) / 2 });
  if (out.length >= 3) out[2].time = out[1].time;
  return out.slice(0, 3);
}

function positionHandle(pts: readonly Anchor[], i: number, a: Anchor): Anchor[] {
  const out = pts.map(p => ({ ...p }));
  out[i] = a;
  if (i === 1 && out[2]) out[2] = { time: a.time, price: out[2].price };
  if (i === 2) out[2] = { time: out[1].time, price: a.price };
  return out;
}

const position = (id: 'long' | 'short', label: string, icon: string, key: string): ToolDefinition => ({
  id, label, icon, key, group: 'positions', points: 2, minPoints: 2, maxPoints: 3,
  hint: `${label}: entry, then target (the stop starts at half the distance)`,
  complete: positionComplete, moveHandle: positionHandle,
  render(rc, d, [a, b, c], extra) {
    if (!ok([a, b, c], 3)) return;
    const { ctx, colors } = rc;
    const x0 = crispX(rc, d, Math.min(a.x, b.x));
    const x1 = crispX(rc, d, Math.max(a.x, b.x));
    ctx.fillStyle = alpha(colors.up, 0.14);
    ctx.fillRect(x0, Math.min(a.y, b.y), x1 - x0, Math.abs(b.y - a.y));
    ctx.fillStyle = alpha(colors.down, 0.14);
    ctx.fillRect(x0, Math.min(a.y, c.y), x1 - x0, Math.abs(c.y - a.y));
    const ye = crispY(rc, d, a.y);
    ctx.beginPath();
    ctx.moveTo(x0, ye); ctx.lineTo(x1, ye);
    stroke(rc, d, colors.text, extra);
  },
  labels(rc, d, [a, b, c]) {
    if (!ok([a, b, c], 3)) return;
    const st = positionStats(d.points[0].price, d.points[1].price, d.points[2].price);
    const x = Math.max(a.x, b.x) - 6;
    const fs = labelPx(rc);
    label(rc, `Target ${rc.fmt(d.points[1].price)} (${formatPercent(st.targetPct, 2)})`, x, b.y + (b.y < a.y ? fs : -fs), rc.colors.upText, 'right');
    label(rc, `Stop ${rc.fmt(d.points[2].price)} (${formatPercent(st.stopPct, 2)})`, x, c.y + (c.y < a.y ? fs : -fs), rc.colors.downText, 'right');
    label(rc, `R:R ${st.ratio.toFixed(2)}`, x, a.y, rc.colors.text, 'right');
  },
  hit(_d, [a, b, c], p, tol) {
    if (!ok([a, b, c], 3)) return false;
    return inBox(p, { x: a.x, y: Math.min(a.y, b.y, c.y) }, { x: b.x, y: Math.max(a.y, b.y, c.y) }, tol);
  },
});

/** The visible part of a horizontal line from x0 to the pane's right edge. */
const horizontal = (id: 'horizontal' | 'horizontalRay', label0: string, icon: string, key?: string): ToolDefinition => ({
  id, label: label0, icon, key, group: 'lines', points: 1, bounds: 'pane',
  moveHandle: (pts, _i, a) => [id === 'horizontal' ? { time: pts[0].time, price: a.price } : a],
  render(rc, d, [a], extra) {
    if (!ok([a], 1)) return;
    const color = colorOf(d, rc.colors);
    const y = crispY(rc, d, a.y);
    const x0 = id === 'horizontal' ? rc.rect.x : Math.max(rc.rect.x, a.x);
    rc.ctx.beginPath();
    rc.ctx.moveTo(x0, y);
    rc.ctx.lineTo(rc.rect.x + rc.rect.width, y);
    stroke(rc, d, color, extra);
    if (d.text) label(rc, d.text, rc.rect.x + rc.rect.width - 4, y - labelPx(rc), color, 'right');
  },
  hit: (_d, [a], p, tol) => !!a && Math.abs(p.y - a.y) <= tol && (id === 'horizontal' || p.x >= a.x - tol),
  handles: (_d, [a], view) => (id === 'horizontal' && a ? [{ x: Math.min(Math.max(a.x, view.rect.x + 12), view.rect.x + view.rect.width - 12), y: a.y }] : a ? [a] : []),
  axisTags: (d, c) => [{ price: d.points[0].price, color: d.style.color ?? c.line }],
});

export const trend = line('trend', 'Trend line', `${ring(5, 19)}${ring(19, 5)}M6.4 17.6L17.6 6.4`, 'T');
export const ray = line('ray', 'Ray', `${ring(5, 19)}M6.4 17.6L20 4M20 4h-5.5M20 4v5.5`);
export const extended = line('extended', 'Extended line', `${ring(8, 16)}${ring(16, 8)}M2.5 21.5l4.1-4.1M9.4 14.6l5.2-5.2M17.4 6.6l4.1-4.1`);
export const arrow = line('arrow', 'Arrow', 'M5 19L18.5 5.5M11 5.5h7.5V13', 'A');
export const horizontalLine = horizontal('horizontal', 'Horizontal line', `${ring(12, 12)}M2.5 12H10M14 12h7.5`, 'H');
export const horizontalRay = horizontal('horizontalRay', 'Horizontal ray', `${ring(5, 12)}M7 12h14.5M18.5 9l3 3-3 3`);

export const vertical: ToolDefinition = {
  id: 'vertical', label: 'Vertical line', key: 'V', group: 'lines', points: 1, bounds: 'pane',
  icon: `${ring(12, 12)}M12 2.5V10M12 14v7.5`,
  moveHandle: (pts, _i, a) => [{ time: a.time, price: pts[0].price }],
  render(rc, d, [a], extra) {
    if (!a || !Number.isFinite(a.x)) return;
    const x = crispX(rc, d, a.x);
    rc.ctx.beginPath();
    rc.ctx.moveTo(x, rc.rect.y);
    rc.ctx.lineTo(x, rc.rect.y + rc.rect.height);
    stroke(rc, d, colorOf(d, rc.colors), extra);
  },
  hit: (_d, [a], p, tol) => !!a && Math.abs(p.x - a.x) <= tol,
  handles: (_d, [a], view) => (a ? [{ x: a.x, y: view.rect.y + view.rect.height / 2 }] : []),
};

export const rectangle: ToolDefinition = {
  id: 'rectangle', label: 'Rectangle', key: 'R', group: 'shapes', points: 2, icon: 'M4 6.5h16v11H4z',
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const x0 = crispX(rc, d, Math.min(a.x, b.x));
    const x1 = crispX(rc, d, Math.max(a.x, b.x));
    const y0 = crispY(rc, d, Math.min(a.y, b.y));
    const y1 = crispY(rc, d, Math.max(a.y, b.y));
    rc.ctx.fillStyle = alpha(color, 0.1);
    rc.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    rc.ctx.beginPath();
    rc.ctx.rect(x0, y0, x1 - x0, y1 - y0);
    stroke(rc, d, color, extra);
  },
  hit: (_d, [a, b], p, tol) => ok([a, b], 2) && inside(p, a, b, tol),
};

export const channel: ToolDefinition = {
  id: 'channel', label: 'Parallel channel', group: 'channels', points: 3, minPoints: 2, maxPoints: 3,
  hint: 'Parallel channel: two points for the line, a third for the width',
  icon: `${ring(4, 13)}${ring(10, 20)}M5.5 11.7L19.5 4M11.5 18.7L20.5 13.8`,
  render(rc, d, [a, b, c], extra) {
    if (!ok([a, b], 2)) return;
    const { ctx } = rc;
    const color = colorOf(d, rc.colors);
    const off = c && Number.isFinite(c.y) ? c.y - lineYAt(a, b, c.x) : 0;
    const a2 = { x: a.x, y: a.y + off };
    const b2 = { x: b.x, y: b.y + off };
    ctx.beginPath();
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
  },
  hit(_d, [a, b, c], p, tol) {
    if (!ok([a, b], 2)) return false;
    const off = c ? c.y - lineYAt(a, b, c.x) : 0;
    const yl = lineYAt(a, b, p.x);
    const inX = p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol;
    return inX && p.y >= Math.min(yl, yl + off) - tol && p.y <= Math.max(yl, yl + off) + tol;
  },
};

export const fib: ToolDefinition = {
  id: 'fib', label: 'Fibonacci retracement', key: 'F', group: 'fib', points: 2,
  icon: 'M3.5 4.5h17M3.5 9.5h12M3.5 14.5h8M3.5 19.5h17',
  defaults: { levels: FIB_LEVELS.slice() },
  readOptions: levelsReader(FIB_LEVELS),
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const { ctx } = rc;
    const color = colorOf(d, rc.colors);
    const levels = levelsOf(d.options, FIB_LEVELS);
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const span = b.y - a.y;
    for (let i = 0; i < levels.length; i++) {
      const y = crispY(rc, d, b.y - span * levels[i]);
      if (i > 0) {
        const yPrev = b.y - span * levels[i - 1];
        ctx.fillStyle = alpha(color, i % 2 ? 0.06 : 0.03);
        ctx.fillRect(x0, Math.min(y, yPrev), x1 - x0, Math.abs(y - yPrev));
      }
      ctx.beginPath();
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      stroke(rc, d, color, extra);
    }
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    const levels = levelsOf(d.options, FIB_LEVELS);
    const start = d.points[0].price, end = d.points[1].price;
    const x0 = Math.min(a.x, b.x);
    for (const lv of levels) {
      const y = b.y - (b.y - a.y) * lv;
      label(rc, `${ratioText(lv)} (${rc.fmt(end - (end - start) * lv)})`, x0 + 2, y - labelPx(rc) / 2 - 4, colorOf(d, rc.colors), 'left');
    }
  },
  hit(d, [a, b], p, tol) {
    if (!ok([a, b], 2)) return false;
    const levels = levelsOf(d.options, FIB_LEVELS);
    let lo = 0, hi = 1;
    for (const lv of levels) { lo = Math.min(lo, lv); hi = Math.max(hi, lv); }
    const span = b.y - a.y;
    return inBox(p, { x: a.x, y: b.y - span * lo }, { x: b.x, y: b.y - span * hi }, tol);
  },
};

export const measure: ToolDefinition = {
  id: 'measure', label: 'Measure', key: 'M', group: 'measure', points: 2,
  icon: 'M3.5 16.5l13-13 4 4-13 13zM7.5 12.5l1.5 1.5M10.5 9.5l1.5 1.5M13.5 6.5l1.5 1.5',
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    rc.ctx.fillStyle = alpha(b.y <= a.y ? rc.colors.up : rc.colors.down, 0.1);
    rc.ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x, b.y);
    stroke(rc, d, colorOf(d, rc.colors), extra);
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    const st = measureStats({ logical: a.l, price: d.points[0].price, time: d.points[0].time }, { logical: b.l, price: d.points[1].price, time: d.points[1].time });
    const body = rc.fmt(Math.abs(st.change)).replace(MINUS_SIGN, '');
    const below = b.y >= a.y;
    const fs = labelPx(rc);
    const y = below ? Math.max(a.y, b.y) + fs + 6 : Math.min(a.y, b.y) - fs - 6;
    label(rc, `${arrowFor(st.dir)}${sign(st.change, body)} (${formatPercent(st.percent, 2)})  ${st.bars} bars, ${formatSpan(st.seconds)}`, (a.x + b.x) / 2, y, dirText(rc, st.dir));
  },
  hit: (_d, [a, b], p, tol) => ok([a, b], 2) && inside(p, a, b, tol),
};

export const long = position('long', 'Long position', 'M3.5 4.5h11v8h-11zM3.5 12.5h11v7h-11zM19.5 19.5v-15M16.5 7.5l3-3 3 3', 'L');
export const short = position('short', 'Short position', 'M3.5 4.5h11v7h-11zM3.5 11.5h11v8h-11zM19.5 4.5v15M16.5 16.5l3 3 3-3', 'S');

export const text: ToolDefinition = {
  id: 'text', label: 'Text note', key: 'N', group: 'annotate', points: 1, text: 'Text',
  icon: 'M6 5.5h12M12 5.5v13M9.5 18.5h5',
  render(rc, d, [a]) {
    if (!ok([a], 1)) return;
    font(rc, 500, labelPx(rc) + 1);
    rc.ctx.fillStyle = colorOf(d, rc.colors);
    rc.ctx.textAlign = 'left';
    rc.ctx.fillText(d.text || 'Text', a.x, a.y);
  },
  hit: (d, [a], p, tol, view) => ok([a], 1) && inBox(p, { x: a.x, y: a.y - 10 }, { x: a.x + view.measure(d.text || 'Text'), y: a.y + 10 }, tol),
  handles: () => [],
};

/** Freehand: hit tests walk only the chunks of the path near the pointer (cached per projection). */
const chunks = new WeakMap<readonly Pt[], ReturnType<typeof chunkBoxes>>();
export function hitPath(pts: readonly Proj[], p: Pt, tol: number): boolean {
  let boxes = chunks.get(pts);
  if (!boxes) { boxes = chunkBoxes(pts); chunks.set(pts, boxes); }
  return distToPolylineChunked(p, pts, boxes, tol) <= tol;
}

export const brush: ToolDefinition = {
  id: 'brush', label: 'Brush', key: 'B', group: 'annotate', points: 0, minPoints: 2, maxPoints: 0,
  icon: 'M4 18.5c3 0 3.5-5 6.5-5s3 5 6 5 3-7.5 3.5-10.5',
  render(rc, d, pts, extra) {
    if (pts.length < 2) return;
    rc.ctx.beginPath();
    rc.ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) rc.ctx.lineTo(pts[i].x, pts[i].y);
    stroke(rc, d, colorOf(d, rc.colors), extra);
  },
  hit: (_d, pts, p, tol) => hitPath(pts, p, tol),
  handles: () => [],
};

/** Today's fifteen, in the order the catalogue has always listed them. */
export const BASIC_TOOLS: readonly ToolDefinition[] = [
  trend, ray, extended, horizontalLine, horizontalRay, vertical, rectangle, channel, fib, measure, long, short, arrow, text, brush,
];
