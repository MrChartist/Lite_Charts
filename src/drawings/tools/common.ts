// Small pieces shared by the tool definitions: icon helpers, default hit and box tests, option readers.

import { clipLine, distToSegment, inBox, type Pt } from '../geometry';
import type { Anchor, DrawingOptions, Proj, View } from '../contract';
import { readNumbers } from '../contract';

/** A ring of radius 2 around (x, y) for an icon (the "point" of a line tool); lines stop at its edge. */
export const ring = (x: number, y: number): string => `M${x + 2} ${y}a2 2 0 1 1-4 0a2 2 0 1 1 4 0`;

/** The line a-b (segment, ray or extended) passes within `tol` of p, inside the pane. */
export function nearLine(p: Pt, a: Pt, b: Pt, tol: number, view: View, mode: 'segment' | 'ray' | 'extended' = 'segment'): boolean {
  const s = mode === 'segment' ? [a, b] : clipLine(a, b, view.rect, mode);
  return !!s && distToSegment(p, s[0], s[1]) <= tol;
}

export const inside = (p: Pt, a: Pt, b: Pt, tol: number): boolean => inBox(p, a, b, tol);

/** Keep the second point at the first one's price (horizontal tools). */
export const level = (pts: readonly Anchor[], i: number, a: Anchor): Anchor[] => {
  const out = pts.map(p => ({ ...p }));
  out[i] = a;
  const price = i === 0 ? a.price : out[0].price;
  for (const q of out) q.price = price;
  return out;
};

/** Options reader for a `levels` array (Fibonacci): numbers from -5 to 10, at most 24. */
export function levelsReader(defaults: readonly number[]): (raw: unknown) => DrawingOptions | undefined {
  return raw => {
    const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const lv = readNumbers(o.levels, -5, 10);
    return { levels: lv && lv.length ? lv.sort((a, b) => a - b) : defaults.slice() };
  };
}

export const levelsOf = (o: DrawingOptions | undefined, defaults: readonly number[]): readonly number[] => {
  const lv = o?.levels;
  return Array.isArray(lv) && lv.length ? lv as number[] : defaults;
};

/** Format a ratio for a level label: 0.618, 1, 1.272 (no trailing zeros). */
export const ratioText = (r: number): string => String(Math.round(r * 1000) / 1000);

/** Projected points are all finite. */
export const ok = (pts: readonly Proj[], n: number): boolean => {
  if (pts.length < n) return false;
  for (let i = 0; i < n; i++) if (!Number.isFinite(pts[i].x) || !Number.isFinite(pts[i].y)) return false;
  return true;
};
