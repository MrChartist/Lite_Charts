// Line tools beyond the basic set: info line, trend angle, cross line, horizontal segment.

import { formatPercent, MINUS_SIGN } from '../../core/format';
import { formatSpan, measureStats, screenAngle } from '../geometry';
import type { ToolDefinition } from '../contract';
import { arrowFor, colorOf, crispX, crispY, dirText, guide, label, labelPx, sign, stroke } from '../paint';
import { level, nearLine, ok, ring } from './common';

/** Change, percent, bars and screen angle of an info line, as one label. */
export function infoText(d: { points: { time: number; price: number }[] }, a: { x: number; y: number; l: number }, b: { x: number; y: number; l: number }, fmt: (p: number) => string): { text: string; dir: number } {
  const st = measureStats({ logical: a.l, price: d.points[0].price, time: d.points[0].time }, { logical: b.l, price: d.points[1].price, time: d.points[1].time });
  const body = fmt(Math.abs(st.change)).replace(MINUS_SIGN, '');
  const ang = Math.round(screenAngle(a, b));
  return { text: `${arrowFor(st.dir)}${sign(st.change, body)} (${formatPercent(st.percent, 2)})  ${st.bars} bars, ${formatSpan(st.seconds)}  ${ang < 0 ? MINUS_SIGN : ''}${Math.abs(ang)}°`, dir: st.dir };
}

export const infoLine: ToolDefinition = {
  id: 'infoLine', label: 'Info line', group: 'lines', points: 2,
  hint: 'Info line: a segment that reads its change, percent, bars, time and angle',
  icon: `${ring(5, 19)}${ring(19, 9)}M6.8 18.1L17.2 9.9M13 4.5h7`,
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x, b.y);
    stroke(rc, d, colorOf(d, rc.colors), extra);
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    const { text, dir } = infoText(d, a, b, rc.fmt);
    const fs = labelPx(rc);
    label(rc, text, b.x, b.y + (b.y <= a.y ? -fs - 4 : fs + 4), dirText(rc, dir), b.x >= a.x ? 'right' : 'left');
  },
  hit: (_d, [a, b], p, tol, view) => ok([a, b], 2) && nearLine(p, a, b, tol, view),
};

export const trendAngle: ToolDefinition = {
  id: 'trendAngle', label: 'Trend angle', group: 'lines', points: 2,
  hint: 'Trend angle: a segment with its angle to the horizontal, as drawn on screen',
  icon: `${ring(5, 18)}M6.6 16.8L19 6M7 18h13.5M12.5 18a7.5 7.5 0 0 0-1.6-4.6`,
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const { ctx } = rc;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    stroke(rc, d, color, extra);
    // The horizontal reference and the arc between it and the line.
    const len = Math.max(24, Math.min(80, Math.abs(b.x - a.x)));
    const dirX = b.x >= a.x ? 1 : -1;
    const y = crispY(rc, d, a.y, 1);
    ctx.beginPath();
    ctx.moveTo(a.x, y); ctx.lineTo(a.x + dirX * len, y);
    guide(rc, d, color, extra, 0.7, 'dashed');
    const r = Math.min(28, len - 4);
    const t1 = Math.atan2(b.y - a.y, b.x - a.x);
    const t0 = dirX > 0 ? 0 : Math.PI;
    ctx.beginPath();
    // The short way from the reference to the line (canvas angles grow clockwise, y down).
    ctx.arc(a.x, a.y, r, t0, t1, dirX > 0 ? t1 < 0 : t1 > 0);
    guide(rc, d, color, extra, 0.9);
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    const ang = screenAngle(a, b);
    const shown = Math.abs(ang) > 90 ? (ang > 0 ? 180 - ang : -180 - ang) : ang;
    const t = `${shown < 0 ? MINUS_SIGN : ''}${Math.abs(shown).toFixed(1)}°`;
    const dirX = b.x >= a.x ? 1 : -1;
    label(rc, t, a.x + dirX * 34, a.y + (b.y < a.y ? -labelPx(rc) / 2 - 2 : labelPx(rc) / 2 + 2), colorOf(d, rc.colors), dirX > 0 ? 'left' : 'right');
  },
  hit: (_d, [a, b], p, tol, view) => ok([a, b], 2) && nearLine(p, a, b, tol, view),
};

export const crossLine: ToolDefinition = {
  id: 'crossLine', label: 'Cross line', group: 'lines', points: 1, bounds: 'pane',
  hint: 'Cross line: a horizontal and a vertical line through one point',
  icon: `${ring(12, 12)}M2.5 12H10M14 12h7.5M12 2.5V10M12 14v7.5`,
  render(rc, d, [a], extra) {
    if (!ok([a], 1)) return;
    const x = crispX(rc, d, a.x), y = crispY(rc, d, a.y);
    rc.ctx.beginPath();
    rc.ctx.moveTo(rc.rect.x, y); rc.ctx.lineTo(rc.rect.x + rc.rect.width, y);
    rc.ctx.moveTo(x, rc.rect.y); rc.ctx.lineTo(x, rc.rect.y + rc.rect.height);
    stroke(rc, d, colorOf(d, rc.colors), extra);
  },
  hit: (_d, [a], p, tol) => ok([a], 1) && (Math.abs(p.y - a.y) <= tol || Math.abs(p.x - a.x) <= tol),
  axisTags: (d, c) => [{ price: d.points[0].price, color: d.style.color ?? c.line }],
};

export const horizontalSegment: ToolDefinition = {
  id: 'horizontalSegment', label: 'Horizontal segment', group: 'lines', points: 2,
  hint: 'Horizontal segment: a level between two times',
  icon: `${ring(5, 12)}${ring(19, 12)}M7 12h10`,
  complete: pts => pts.map((p, i) => ({ time: p.time, price: i === 0 ? p.price : pts[0].price })),
  moveHandle: level,
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const y = crispY(rc, d, a.y);
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, y); rc.ctx.lineTo(b.x, y);
    stroke(rc, d, colorOf(d, rc.colors), extra);
    if (d.text) label(rc, d.text, Math.max(a.x, b.x), y - labelPx(rc), colorOf(d, rc.colors), 'right');
  },
  hit: (_d, [a, b], p, tol) => ok([a, b], 2) && Math.abs(p.y - a.y) <= tol && p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol,
  axisTags: (d, c) => [{ price: d.points[0].price, color: d.style.color ?? c.line }],
};

export const LINE_TOOLS: readonly ToolDefinition[] = [infoLine, trendAngle, horizontalSegment, crossLine];
