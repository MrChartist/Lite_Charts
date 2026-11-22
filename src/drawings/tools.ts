// The catalogue: every built-in tool (`TOOLS` = ALL_TOOLS), the toolbar groups and single-key shortcuts derived from
// the definitions, and pure helpers kept for code written against the first version of this module. The controller
// does not import this file (it dispatches through the definitions it is given, `engine.ts`), so a host that passes
// `BASIC_TOOLS` bundles only those.

import type { Pt, Rect } from './geometry';
import type { Drawing, Proj, RenderCtx, ToolDefinition, ToolId, View } from './contract';
import { BODY, groupsFor, handlePoints as handlesWith, hitWith, keysFor, overlaps, paintBox as boxWith, plainView, type ToolGroup } from './engine';
import { ALL_TOOLS } from './tools/all';
import { BASIC_TOOLS } from './tools/basic';

export type { Anchor, Drawing, DrawingStyle, Proj, RenderCtx, ToolDefinition, ToolId, BuiltinToolId, View } from './contract';
export { BODY, overlaps, ALL_TOOLS, BASIC_TOOLS, groupsFor, keysFor };
export type { ToolGroup };
export { colorOf } from './paint';

/** Name and point count of a tool (a `ToolDefinition` is one). */
export interface ToolInfo { id: ToolId; label: string; points: number }

/** Every built-in tool. */
export const TOOLS: readonly ToolDefinition[] = ALL_TOOLS;

const byId = new Map<string, ToolDefinition>(ALL_TOOLS.map(t => [t.id, t]));
export const toolInfo = (id: ToolId): ToolDefinition | undefined => byId.get(id);

/** How the toolbar groups every built-in tool. */
export const TOOL_GROUPS: readonly ToolGroup[] = groupsFor(ALL_TOOLS);

/**
 * Single-key shortcuts while the chart has focus (no modifier). Chosen not to clash with the chart's keys (arrows,
 * + and -, Home, End, Enter, Space, Escape) or the drawing keys (Delete, Backspace, Shift + H, ctrl / cmd + Z / Y).
 */
export const TOOL_KEYS: Readonly<Partial<Record<ToolId, string>>> = keysFor(ALL_TOOLS);

/** What `p` hits on a built-in drawing: a handle index, `BODY`, or -1 (`rect` or a full view). */
export function hitDrawing(d: Drawing, pts: readonly Proj[], p: Pt, tol: number, rect: Rect | View, measure?: (t: string) => number): number {
  const def = byId.get(d.tool);
  if (!def) return -1;
  const view = 'x' in rect && typeof (rect as View).x === 'function' ? rect as View : plainView(rect as Rect, measure);
  return hitWith(def, d, pts, p, tol, view);
}

/** Handles of a built-in drawing. */
export function handlePoints(d: Drawing, pts: readonly Proj[], rect: Rect | View): Pt[] {
  const def = byId.get(d.tool);
  if (!def) return [];
  const view = 'x' in rect && typeof (rect as View).x === 'function' ? rect as View : plainView(rect as Rect);
  return handlesWith(def, d, pts, view);
}

/** Paint a built-in drawing (body, then labels). */
export function renderDrawing(rc: RenderCtx, d: Drawing, pts: readonly Proj[], extra = 0): void {
  const def = byId.get(d.tool);
  if (!def) return;
  rc.ctx.beginPath();
  def.render(rc, d, pts, extra);
}

export function renderLabels(rc: RenderCtx, d: Drawing, pts: readonly Proj[]): void {
  byId.get(d.tool)?.labels?.(rc, d, pts);
}

/** The pixel box a built-in drawing can paint in, or null for one that may paint anywhere in the pane. */
export function paintBox(d: Drawing, pts: readonly Proj[]): Rect | null {
  return boxWith(byId.get(d.tool), pts);
}
