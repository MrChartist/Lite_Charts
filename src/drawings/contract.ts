// THE TOOL CONTRACT. A drawing tool is one plain object (`ToolDefinition`): how many points it takes, how they are
// completed and constrained, how it paints, what its labels say, how it is hit, where its handles are, its icon, name
// and group. The controller, the toolbar, JSON, undo / redo, the magnet and touch work the same for every tool, so a
// new tool is one definition and nothing else. Types only (plus two tiny pure helpers); no DOM, no chart import.

import type { ThemeColors } from '../core/theme';
import type { Pt, Rect } from './geometry';

/** Built-in tool ids. `ToolId` also accepts the id of a tool of your own. */
export type BuiltinToolId =
  // the basic set (BASIC_TOOLS)
  | 'trend' | 'ray' | 'extended' | 'horizontal' | 'horizontalRay' | 'vertical' | 'rectangle' | 'channel' | 'fib'
  | 'measure' | 'long' | 'short' | 'arrow' | 'text' | 'brush'
  // lines and channels
  | 'infoLine' | 'trendAngle' | 'crossLine' | 'horizontalSegment' | 'regression' | 'flatChannel' | 'disjointChannel'
  // Fibonacci and Gann
  | 'fibExtension' | 'fibChannel' | 'fibFan' | 'fibSpeedFan' | 'fibArcs' | 'fibTimeZones' | 'gannFan' | 'gannBox'
  // pitchforks
  | 'pitchfork' | 'schiffPitchfork' | 'modifiedSchiffPitchfork' | 'insidePitchfork'
  // shapes
  | 'ellipse' | 'triangle' | 'rotatedRectangle' | 'polyline' | 'arc' | 'curve'
  // ranges and analysis
  | 'priceRange' | 'dateRange' | 'datePriceRange' | 'anchoredVwap' | 'volumeProfile'
  // annotations
  | 'anchoredText' | 'callout' | 'priceLabel' | 'priceNote' | 'arrowUp' | 'arrowDown' | 'flag' | 'highlighter';

// eslint-disable-next-line @typescript-eslint/ban-types
export type ToolId = BuiltinToolId | (string & {});

/** A point of a drawing: a time (UNIX seconds; past the data it is extrapolated) and a price. */
export interface Anchor { time: number; price: number }

export interface DrawingStyle {
  /** CSS colour; the theme's line colour when absent. */
  color?: string;
  width: 1 | 2 | 3;
  dash: 'solid' | 'dashed';
}

/** Tool options kept with a drawing (JSON-safe): Fibonacci levels, VWAP bands, ... */
export type DrawingOptions = Record<string, unknown>;

export interface Drawing {
  id: string;
  tool: ToolId;
  points: Anchor[];
  style: DrawingStyle;
  /** Text of a note or callout; a short label at the right end of a horizontal line. */
  text?: string;
  /** Pane the drawing lives in (0 = top). */
  pane: number;
  /** A locked drawing cannot be moved or edited by pointer (it can still be selected and deleted). */
  locked?: boolean;
  /** Tool options (see each tool's `defaults`). */
  options?: DrawingOptions;
}

/** A projected anchor: pixel position and its fractional logical index. */
export interface Proj extends Pt { l: number }

/** One bar as tools that read the series see it (regression, anchored VWAP, volume profile). */
export interface BarRow { time: number; open: number; high: number; low: number; close: number; volume: number | null }

/** Read access to the series' bars, by row index. */
export interface BarAccess {
  count: number;
  /** Row times in UNIX seconds, ascending. */
  times: ArrayLike<number>;
  row(i: number): BarRow;
  /** First row at or after `time` (count when none). */
  indexAtOrAfter(time: number): number;
  /** An identity that changes whenever the rows change (for caches). */
  version: number;
}

/** Where things are: the pane rectangle and the mappings, in the same coordinates as the projected anchors. */
export interface View {
  rect: Rect;
  /** x of a fractional logical index. */
  x(logical: number): number;
  /** y of a price on the drawing's scale (NaN when not drawable). */
  y(price: number): number;
  /** Logical index of a time (NaN when the axis is empty). */
  logical(time: number): number;
  /** The series' bars, when the controller has them. */
  bars: BarAccess | null;
  /** Text width in CSS px (approximate when there is no canvas). */
  measure(text: string, weight?: number): number;
  fontSize: number;
}

export interface RenderCtx extends View {
  ctx: CanvasRenderingContext2D;
  colors: Readonly<ThemeColors>;
  ratio: number;
  fontFamily: string;
  fmt: (price: number) => string;
  text: (t: string, x: number, y: number, color: string, weight?: number, align?: 'left' | 'center' | 'right') => void;
}

export interface AxisTag { price: number; color: string; text?: string }

export interface ToolDefinition {
  id: ToolId;
  label: string;
  /** Tooltip line: what it is and how to place it. */
  hint?: string;
  /** Toolbar group id (see `GROUP_ORDER`); tools of the same group share one rail button. */
  group: string;
  /** 24-grid SVG path, drawn with a 1.8 round-capped stroke. */
  icon: string;
  /** Single-key shortcut (an upper-case letter). */
  key?: string;
  /** Points placed when creating; 0 = freehand (press, move, release). */
  points: number;
  /** Fewest points a spec may have (default: `points`, freehand 2). */
  minPoints?: number;
  /** Points kept (default `points`; 0 = all). */
  maxPoints?: number;
  /** Variable count: each click adds a point until a double click, Enter, or `points` is reached. */
  open?: boolean;
  /** Derive points a drawing needs but the person did not place (a position's stop). Also run on every spec. */
  complete?(pts: Anchor[]): Anchor[];
  /** A handle `i` moved to `a`: the new points (default: point i replaced). */
  moveHandle?(pts: readonly Anchor[], i: number, a: Anchor): Anchor[];
  /** Default options of a new drawing. */
  defaults?: DrawingOptions;
  /** Validate options read from a spec or JSON; return the clean options (undefined: none). */
  readOptions?(raw: unknown): DrawingOptions | undefined;
  /** Style of a new drawing of this tool (before the controller's default style). */
  style?: Partial<DrawingStyle>;
  /** Opens the text editor once placed; the value is the editor's placeholder. */
  text?: string;
  /** The tool reads the series' bars (regression, VWAP, volume profile). */
  usesBars?: boolean;
  /** The tool paints nothing on the axis or beyond its anchors (labels included): a box for culling. Default: anchors' box + 200 px. 'pane' = always painted. */
  bounds?: 'anchors' | 'pane';
  render(rc: RenderCtx, d: Drawing, pts: readonly Proj[], extra: number): void;
  /** Labels, painted after every body. */
  labels?(rc: RenderCtx, d: Drawing, pts: readonly Proj[]): void;
  /** The body is under `p` (handles are tested first, by the controller). */
  hit(d: Drawing, pts: readonly Proj[], p: Pt, tol: number, view: View): boolean;
  /** Handle positions (default: the anchors). */
  handles?(d: Drawing, pts: readonly Proj[], view: View): Pt[];
  /** Tags on the price axis. */
  axisTags?(d: Drawing, colors: Readonly<ThemeColors>): AxisTag[];
}

/** Rail order of the groups and their names. */
export const GROUP_ORDER: readonly { id: string; label: string }[] = [
  { id: 'lines', label: 'Lines' },
  { id: 'channels', label: 'Channels and pitchforks' },
  { id: 'fib', label: 'Fibonacci and Gann' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'measure', label: 'Measure and analysis' },
  { id: 'positions', label: 'Positions' },
  { id: 'annotate', label: 'Annotate' },
];

/** Numbers from an options array: finite, deduplicated, in range, at most `max` of them. */
export function readNumbers(raw: unknown, min: number, max: number, count = 24): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: number[] = [];
  for (const v of raw) if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && !out.includes(v)) out.push(v);
  return out.slice(0, count);
}
