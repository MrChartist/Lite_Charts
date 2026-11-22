// Dispatch through tool definitions: handles, hit testing, culling boxes. Pure; the controller passes the definitions
// it was given, so a host that ships a subset of tools bundles only those.

import type { Pt, Rect } from './geometry';
import type { Drawing, Proj, ToolDefinition, ToolId, View } from './contract';
import { GROUP_ORDER } from './contract';

/** Body hit (as opposed to a handle index). */
export const BODY = 100;

export type Registry = ReadonlyMap<string, ToolDefinition>;

export function registry(defs: readonly ToolDefinition[]): Registry {
  const m = new Map<string, ToolDefinition>();
  for (const d of defs) {
    if (!d || typeof d.id !== 'string' || typeof d.render !== 'function' || typeof d.hit !== 'function') throw new TypeError('Chartist Lite: a tool definition needs an id, render and hit');
    if (!m.has(d.id)) m.set(d.id, d);
  }
  return m;
}

/** Where a drawing's handles are (one per editable point, unless the tool says otherwise). */
export function handlePoints(def: ToolDefinition, d: Drawing, pts: readonly Proj[], view: View): Pt[] {
  return def.handles ? def.handles(d, pts, view) : pts.slice();
}

/** What `p` hits on a drawing: a handle index, `BODY`, or -1. `tol` is larger on touch. */
export function hitWith(def: ToolDefinition, d: Drawing, pts: readonly Proj[], p: Pt, tol: number, view: View): number {
  const hs = handlePoints(def, d, pts, view);
  for (let i = 0; i < hs.length; i++) if (Math.hypot(p.x - hs[i].x, p.y - hs[i].y) <= tol + 2) return i;
  return def.hit(d, pts, p, tol, view) ? BODY : -1;
}

/** The box a drawing can paint in, or null for one that may paint anywhere in the pane (always considered visible). */
export function paintBox(def: ToolDefinition | undefined, pts: readonly Pt[], pad = 200): Rect | null {
  if (!def || def.bounds === 'pane' || pts.length === 0) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  if (x0 === Infinity) return null;
  // A channel's third point sets an offset, not an edge.
  if (def.id === 'channel' && pts.length === 3) {
    const [a, b, c] = pts;
    const off = c.y - (b.x === a.x ? a.y : a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x));
    y0 = Math.min(y0, y0 + off); y1 = Math.max(y1, y1 + off);
  }
  return { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad };
}

/** Two rectangles overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** A view with no mappings (pure hit tests on given points). */
export function plainView(rect: Rect, measure?: (t: string) => number): View {
  return {
    rect, x: () => Number.NaN, y: () => Number.NaN, logical: () => Number.NaN, bars: null,
    measure: measure ?? (t => t.length * 7), fontSize: 12,
  };
}

export interface ToolGroup { id: string; label: string; tools: readonly ToolId[] }

/** Rail groups for a set of tools, in rail order, each with its tools in the set's order; empty groups left out. */
export function groupsFor(defs: readonly ToolDefinition[]): ToolGroup[] {
  const out: ToolGroup[] = [];
  const known = new Set(GROUP_ORDER.map(g => g.id));
  for (const g of GROUP_ORDER) {
    const tools = defs.filter(t => t.group === g.id).map(t => t.id);
    if (tools.length) out.push({ id: g.id, label: g.label, tools });
  }
  // Tools of your own in a group of your own: one group per new id, after the built-in ones.
  for (const t of defs) {
    if (known.has(t.group)) continue;
    const g = out.find(x => x.id === t.group);
    if (g) (g.tools as ToolId[]).push(t.id); else out.push({ id: t.group, label: t.group, tools: [t.id] });
  }
  return out;
}

/** Shortcut keys of a set of tools (the first tool to claim a key keeps it). */
export function keysFor(defs: readonly ToolDefinition[]): Partial<Record<ToolId, string>> {
  const out: Partial<Record<string, string>> = {};
  const taken = new Set<string>();
  for (const t of defs) if (t.key && !taken.has(t.key)) { out[t.id] = t.key; taken.add(t.key); }
  return out;
}
