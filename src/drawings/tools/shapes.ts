// Shapes beyond the rectangle: ellipse, triangle, rotated rectangle, polyline, arc, curve. The rotated rectangle and the
// curve sampling are ported from the host engine (`curveSampling.ts`; PROVENANCE.md).

import { arcThrough, distToPolygon, distToPolyline, inPolygon, rotatedRectCorners, sampleBezier, type Pt } from '../geometry';
import type { Proj, ToolDefinition } from '../contract';
import { alpha, colorOf, fillPoly, path, stroke } from '../paint';
import { hitPath } from './basic';
import { ok, ring } from './common';

/** Inside or on the ellipse inscribed in the box a-b, with tolerance in px. */
export function hitEllipse(a: Pt, b: Pt, p: Pt, tol: number): boolean {
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2 + tol, ry = Math.abs(b.y - a.y) / 2 + tol;
  if (rx <= 0 || ry <= 0) return false;
  return ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1;
}

export const ellipse: ToolDefinition = {
  id: 'ellipse', label: 'Ellipse', group: 'shapes', points: 2,
  hint: 'Ellipse: two opposite corners of its box',
  icon: 'M20.5 12c0 3.6-3.8 6.5-8.5 6.5S3.5 15.6 3.5 12 7.3 5.5 12 5.5s8.5 2.9 8.5 6.5z',
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    rc.ctx.beginPath();
    rc.ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    rc.ctx.fillStyle = alpha(color, 0.1);
    rc.ctx.fill();
    stroke(rc, d, color, extra);
  },
  hit: (_d, [a, b], p, tol) => ok([a, b], 2) && hitEllipse(a, b, p, tol),
};

export const triangle: ToolDefinition = {
  id: 'triangle', label: 'Triangle', group: 'shapes', points: 3,
  hint: 'Triangle: three corners',
  icon: 'M12 4.5l8.5 15h-17z',
  render(rc, d, [a, b, c], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const pts = c && ok([c], 1) ? [a, b, c] : [a, b];
    if (pts.length === 3) fillPoly(rc, pts, color, 0.1);
    rc.ctx.beginPath();
    path(rc.ctx, pts, pts.length === 3);
    stroke(rc, d, color, extra);
  },
  hit: (_d, [a, b, c], p, tol) => ok([a, b, c], 3) && (inPolygon(p, [a, b, c]) || distToPolygon(p, [a, b, c]) <= tol),
};

export const rotatedRectangle: ToolDefinition = {
  id: 'rotatedRectangle', label: 'Rotated rectangle', group: 'shapes', points: 3,
  hint: 'Rotated rectangle: two points for one side, a third for the height',
  icon: 'M3.5 14.5L13 5l7.5 7.5-9.5 9.5z',
  render(rc, d, [a, b, c], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const k = c && ok([c], 1) ? rotatedRectCorners(a, b, c) : null;
    if (k) fillPoly(rc, k, color, 0.1);
    rc.ctx.beginPath();
    if (k) path(rc.ctx, k, true); else { rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x, b.y); }
    stroke(rc, d, color, extra);
  },
  hit(_d, [a, b, c], p, tol) {
    if (!ok([a, b, c], 3)) return false;
    const k = rotatedRectCorners(a, b, c);
    return !!k && (inPolygon(p, k) || distToPolygon(p, k) <= tol);
  },
  // The third handle sits in the middle of the far side (where the height is read).
  handles(_d, [a, b, c]) {
    if (!c) return [a, b].filter(Boolean);
    const k = rotatedRectCorners(a, b, c);
    return k ? [a, b, { x: (k[2].x + k[3].x) / 2, y: (k[2].y + k[3].y) / 2 }] : [a, b, c];
  },
};

export const polyline: ToolDefinition = {
  id: 'polyline', label: 'Path', group: 'shapes', points: 50, minPoints: 2, maxPoints: 50, open: true,
  hint: 'Path: click each point; double click or press Enter to finish',
  icon: `${ring(4, 18)}${ring(20, 6)}M5.6 16.8L10 10l4 5 4.6-7.4`,
  render(rc, d, pts, extra) {
    if (pts.length < 2) return;
    rc.ctx.beginPath();
    path(rc.ctx, pts);
    stroke(rc, d, colorOf(d, rc.colors), extra);
  },
  hit: (_d, pts, p, tol) => pts.length >= 2 && hitPath(pts, p, tol),
};

/** Samples of an arc drawing: from the first point to the second, through the third (a straight line until it is placed). */
export function arcSamples(pts: readonly Proj[]): Pt[] {
  const [a, b, c] = pts;
  return c && ok([c], 1) ? arcThrough(a, c, b) : [a, b];
}

export const arc: ToolDefinition = {
  id: 'arc', label: 'Arc', group: 'shapes', points: 3,
  hint: 'Arc: start, end, then a point it passes through',
  icon: `${ring(4, 18)}${ring(20, 18)}M4.6 16.1a8 8 0 0 1 14.8 0`,
  render(rc, d, pts, extra) {
    if (!ok(pts, 2)) return;
    rc.ctx.beginPath();
    path(rc.ctx, arcSamples(pts));
    stroke(rc, d, colorOf(d, rc.colors), extra);
  },
  hit: (_d, pts, p, tol) => ok(pts, 3) && distToPolyline(p, arcSamples(pts)) <= tol,
};

/** Samples of a curve drawing: start, end, bent towards the third point (the control point). */
export function curveSamples(pts: readonly Proj[]): Pt[] {
  const [a, b, c] = pts;
  return c && ok([c], 1) ? sampleBezier(a, b, c) : [a, b];
}

export const curve: ToolDefinition = {
  id: 'curve', label: 'Curve', group: 'shapes', points: 3,
  hint: 'Curve: start, end, then the point it bends towards',
  icon: `${ring(4, 18)}${ring(20, 18)}M5.5 16.5C8 8 16 8 18.5 16.5`,
  render(rc, d, pts, extra) {
    if (!ok(pts, 2)) return;
    const color = colorOf(d, rc.colors);
    rc.ctx.beginPath();
    path(rc.ctx, curveSamples(pts));
    stroke(rc, d, color, extra);
  },
  hit: (_d, pts, p, tol) => ok(pts, 3) && distToPolyline(p, curveSamples(pts)) <= tol,
};

export const SHAPE_TOOLS: readonly ToolDefinition[] = [rotatedRectangle, ellipse, triangle, polyline, arc, curve];
