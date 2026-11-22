// Channels and pitchforks: regression trend, flat top / bottom channel, disjoint channel, and the four pitchforks.
// Regression and the pitchfork constructions are ported from the host engine (`channelsAndPitchforks.ts`,
// `pitchforkConstruction.ts`; PROVENANCE.md), simplified to what is painted here.

import { distToSegment, inPolygon, type Pt } from '../geometry';
import type { BarAccess, Drawing, Proj, RenderCtx, ToolDefinition, View } from '../contract';
import { colorOf, fillPoly, guide, lineTo, lineYAt, path, stroke } from '../paint';
import { nearLine, ok, ring } from './common';

// ── regression trend ──

export interface Regression { slope: number; intercept: number; sd: number; n: number }

/**
 * Least-squares line through (x, y) pairs with the population standard deviation of the vertical residuals (the
 * classic linear-regression channel). Null with fewer than two points.
 */
export function leastSquares(xs: ArrayLike<number>, ys: ArrayLike<number>): Regression | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  let ss = 0;
  for (let i = 0; i < n; i++) { const r = ys[i] - (slope * xs[i] + intercept); ss += r * r; }
  return { slope, intercept, sd: Math.sqrt(ss / n), n };
}

const regCache = new Map<string, Regression | null>();

/** Regression of closes against logical index over the bars from time t0 to t1 (inclusive), cached by bar version. */
export function regressionOver(bars: BarAccess, view: Pick<View, 'logical'>, t0: number, t1: number): Regression | null {
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  const key = `${bars.version}:${lo}:${hi}`;
  if (regCache.has(key)) return regCache.get(key) ?? null;
  const xs: number[] = [], ys: number[] = [];
  for (let i = bars.indexAtOrAfter(lo); i < bars.count && bars.times[i] <= hi; i++) {
    const r = bars.row(i);
    const l = view.logical(r.time);
    if (Number.isFinite(l) && Number.isFinite(r.close)) { xs.push(l); ys.push(r.close); }
  }
  const out = leastSquares(xs, ys);
  if (regCache.size > 64) regCache.clear();
  regCache.set(key, out);
  return out;
}

const DEVIATIONS = 2;

/** Centre, upper and lower lines of a regression drawing in pixels (from a.x to b.x), or null without bars. */
function regressionLines(d: Drawing, pts: readonly Proj[], view: View): { c: [Pt, Pt]; u: [Pt, Pt]; w: [Pt, Pt] } | null {
  const [a, b] = pts;
  if (!view.bars || !ok([a, b], 2)) return null;
  const r = regressionOver(view.bars, view, d.points[0].time, d.points[1].time);
  if (!r) return null;
  const k = typeof d.options?.deviations === 'number' ? d.options.deviations as number : DEVIATIONS;
  const at = (x: Proj, off: number): Pt => ({ x: x.x, y: view.y(r.slope * x.l + r.intercept + off) });
  const c: [Pt, Pt] = [at(a, 0), at(b, 0)];
  const u: [Pt, Pt] = [at(a, k * r.sd), at(b, k * r.sd)];
  const w: [Pt, Pt] = [at(a, -k * r.sd), at(b, -k * r.sd)];
  return [...c, ...u, ...w].every(p => Number.isFinite(p.y)) ? { c, u, w } : null;
}

export const regression: ToolDefinition = {
  id: 'regression', label: 'Regression trend', group: 'channels', points: 2, usesBars: true,
  hint: 'Regression trend: the least-squares line of the closes between two times, with bands at 2 deviations',
  icon: 'M3.5 15l17-7M3.5 20l17-7M3.5 10l17-7M7 13.6v.1M12 12v.1M16.5 9v.1',
  defaults: { deviations: DEVIATIONS },
  readOptions(raw) {
    const k = (raw as { deviations?: unknown } | null)?.deviations;
    return { deviations: typeof k === 'number' && Number.isFinite(k) && k >= 0 && k <= 5 ? k : DEVIATIONS };
  },
  render(rc, d, pts, extra) {
    const g = regressionLines(d, pts, rc);
    const color = colorOf(d, rc.colors);
    if (!g) {
      const [a, b] = pts;
      if (!ok([a, b], 2)) return;
      rc.ctx.beginPath(); rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x, b.y);
      guide(rc, d, color, extra, 0.7, 'dashed');
      return;
    }
    fillPoly(rc, [g.u[0], g.u[1], g.w[1], g.w[0]], color, 0.07);
    rc.ctx.beginPath();
    path(rc.ctx, g.u); path(rc.ctx, g.w);
    stroke(rc, d, color, extra, d.style.dash, 1);
    rc.ctx.beginPath();
    path(rc.ctx, g.c);
    stroke(rc, d, color, extra);
  },
  hit(d, pts, p, tol, view) {
    const g = regressionLines(d, pts, view);
    if (!g) return ok(pts, 2) && nearLine(p, pts[0], pts[1], tol, view);
    if (p.x < Math.min(g.c[0].x, g.c[1].x) - tol || p.x > Math.max(g.c[0].x, g.c[1].x) + tol) return false;
    const yu = lineYAt(g.u[0], g.u[1], p.x), yw = lineYAt(g.w[0], g.w[1], p.x);
    return p.y >= Math.min(yu, yw) - tol && p.y <= Math.max(yu, yw) + tol;
  },
  handles(d, pts, view) {
    const g = regressionLines(d, pts, view);
    return g ? g.c.slice() : pts.slice(0, 2);
  },
};

// ── flat and disjoint channels ──

export const flatChannel: ToolDefinition = {
  id: 'flatChannel', label: 'Flat top or bottom', group: 'channels', points: 3,
  hint: 'Flat channel: two points for the sloped side, a third for the flat side',
  icon: `${ring(4, 18)}${ring(20, 10)}M5.8 17.1l12.4-6.2M3.5 5.5h17`,
  render(rc, d, [a, b, c], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const y = c && Number.isFinite(c.y) ? c.y : a.y;
    fillPoly(rc, [a, b, { x: b.x, y }, { x: a.x, y }], color, 0.08);
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x, b.y);
    if (c) { rc.ctx.moveTo(a.x, y); rc.ctx.lineTo(b.x, y); }
    stroke(rc, d, color, extra);
  },
  hit(_d, [a, b, c], p, tol) {
    if (!ok([a, b, c], 3)) return false;
    const poly = [a, b, { x: b.x, y: c.y }, { x: a.x, y: c.y }];
    return inPolygon(p, poly) || distToSegment(p, a, b) <= tol || distToSegment(p, poly[2], poly[3]) <= tol;
  },
  handles: (_d, [a, b, c]) => (c ? [a, b, { x: Math.min(Math.max(c.x, Math.min(a.x, b.x)), Math.max(a.x, b.x)), y: c.y }] : [a, b]),
};

export const disjointChannel: ToolDefinition = {
  id: 'disjointChannel', label: 'Disjoint channel', group: 'channels', points: 4,
  hint: 'Disjoint channel: two lines of two points each, free to converge or diverge',
  icon: `${ring(4, 8)}${ring(4, 16)}M5.8 7.2L20 3.5M5.8 16.8L20 20.5`,
  render(rc, d, [a, b, c, e], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    if (c && e && ok([c, e], 2)) fillPoly(rc, [a, b, e, c], color, 0.08);
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x, b.y);
    if (c && e && ok([c, e], 2)) { rc.ctx.moveTo(c.x, c.y); rc.ctx.lineTo(e.x, e.y); }
    stroke(rc, d, color, extra);
  },
  hit(_d, [a, b, c, e], p, tol) {
    if (!ok([a, b, c, e], 4)) return false;
    return inPolygon(p, [a, b, e, c]) || distToSegment(p, a, b) <= tol || distToSegment(p, c, e) <= tol;
  },
};

// ── pitchforks ──

export type PitchforkKind = 'andrews' | 'schiff' | 'modifiedSchiff' | 'inside';

export interface PitchforkLines { origin: Pt; target: Pt; dir: Pt; tines: [Pt, Pt] }

/**
 * - Andrews: median from P0 through the midpoint of P1 / P2; tines through P1 and P2.
 * - Schiff: as Andrews, but the median starts at P0's x and the P0 / P1 mid-price.
 * - Modified Schiff: the median starts at the midpoint of P0 and P1 (time and price).
 * - Inside: the median runs from the P0 / P1 midpoint through P2; tines through P0 and P1.
 */
export function pitchforkLines(kind: PitchforkKind, p0: Pt, p1: Pt, p2: Pt): PitchforkLines {
  const mid = (p: Pt, q: Pt): Pt => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const origin = kind === 'andrews' ? p0 : kind === 'schiff' ? { x: p0.x, y: (p0.y + p1.y) / 2 } : mid(p0, p1);
  const target = kind === 'inside' ? p2 : mid(p1, p2);
  return { origin, target, dir: { x: target.x - origin.x, y: target.y - origin.y }, tines: kind === 'inside' ? [p0, p1] : [p1, p2] };
}

const ahead = (p: Pt, dir: Pt, k: number): Pt => ({ x: p.x + dir.x * k, y: p.y + dir.y * k });

/** How far along `dir` a ray must go to leave the pane from anywhere in it. */
function reach(view: View, dir: Pt): number {
  const len = Math.hypot(dir.x, dir.y);
  return len > 1e-9 ? (2 * Math.hypot(view.rect.width, view.rect.height)) / len : 0;
}

function pitchforkTool(kind: PitchforkKind, id: string, name: string, icon: string): ToolDefinition {
  const lines = (pts: readonly Proj[]): PitchforkLines | null => (ok(pts, 3) ? pitchforkLines(kind, pts[0], pts[1], pts[2]) : null);
  return {
    id, label: name, group: 'channels', points: 3, bounds: 'pane', icon,
    hint: `${name}: three points (the pivot, then the two reactions)`,
    render(rc: RenderCtx, d, pts, extra) {
      const color = colorOf(d, rc.colors);
      const f = lines(pts);
      if (!f) {
        if (ok(pts, 2)) { rc.ctx.beginPath(); rc.ctx.moveTo(pts[0].x, pts[0].y); rc.ctx.lineTo(pts[1].x, pts[1].y); guide(rc, d, color, extra, 0.7, 'dashed'); }
        return;
      }
      const k = reach(rc, f.dir);
      const [t0, t1] = f.tines;
      fillPoly(rc, [t0, ahead(t0, f.dir, k), ahead(t1, f.dir, k), t1], color, 0.06);
      rc.ctx.beginPath();
      lineTo(rc, f.origin, f.target, 'ray');
      lineTo(rc, t0, ahead(t0, f.dir, 1), 'ray');
      lineTo(rc, t1, ahead(t1, f.dir, 1), 'ray');
      stroke(rc, d, color, extra);
      // The construction: the P1-P2 base (or the P0-P1 base of an inside fork) and, for Schiff forms, P0 to the origin.
      rc.ctx.beginPath();
      rc.ctx.moveTo(t0.x, t0.y); rc.ctx.lineTo(t1.x, t1.y);
      if (kind === 'schiff' || kind === 'modifiedSchiff') { rc.ctx.moveTo(pts[0].x, pts[0].y); rc.ctx.lineTo(f.origin.x, f.origin.y); }
      if (kind === 'inside') { rc.ctx.moveTo(f.origin.x, f.origin.y); rc.ctx.lineTo(pts[2].x, pts[2].y); }
      guide(rc, d, color, extra, 0.6, 'dashed');
      if (kind === 'inside') {
        rc.ctx.beginPath();
        for (const t of f.tines) { const m = { x: (t.x + f.target.x) / 2, y: (t.y + f.target.y) / 2 }; lineTo(rc, m, ahead(m, f.dir, 1), 'ray'); }
        guide(rc, d, color, extra, 0.5, 'dashed');
      }
    },
    hit(_d, pts, p, tol, view) {
      const f = lines(pts);
      if (!f) return false;
      const k = reach(view, f.dir);
      const [t0, t1] = f.tines;
      if (inPolygon(p, [t0, ahead(t0, f.dir, k), ahead(t1, f.dir, k), t1])) return true;
      return nearLine(p, f.origin, f.target, tol, view, 'ray') || distToSegment(p, t0, t1) <= tol;
    },
  };
}

export const pitchfork = pitchforkTool('andrews', 'pitchfork', 'Pitchfork', `${ring(4, 12)}M6 12h14.5M10 6.5h10.5M10 17.5h10.5M10 6.5v11`);
export const schiffPitchfork = pitchforkTool('schiff', 'schiffPitchfork', 'Schiff pitchfork', `${ring(4, 18)}M4 15.9V12h16.5M10 6.5h10.5M10 17.5h10.5M10 6.5v11`);
export const modifiedSchiffPitchfork = pitchforkTool('modifiedSchiff', 'modifiedSchiffPitchfork', 'Modified Schiff pitchfork', `${ring(4, 18)}M5.4 16.6L7 12h13.5M10 6.5h10.5M10 17.5h10.5M10 6.5v11`);
export const insidePitchfork = pitchforkTool('inside', 'insidePitchfork', 'Inside pitchfork', `${ring(4, 12)}M6 12h14.5M10 6.5h10.5M10 17.5h10.5M10 6.5v11M13 9.25h7.5M13 14.75h7.5`);

export const CHANNEL_TOOLS: readonly ToolDefinition[] = [regression, flatChannel, disjointChannel, pitchfork, schiffPitchfork, modifiedSchiffPitchfork, insidePitchfork];
