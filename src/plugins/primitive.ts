// THE PRIMITIVE CONTRACT. A primitive draws on a pane: price lines, markers, drawings, bands, watermarks. Attach it
// to a series (`series.attachPrimitive(p)`, prices then map through that series' scale) or to the chart's pane
// (`chart.attachPrimitive(p)`, prices map through the 'right' scale unless a scale id is passed). See
// ARCHITECTURE.md "Primitives".

import type { Time } from '../core/time';
import type { ThemeColors } from '../core/theme';
import type { LogicalRange } from '../scales/time-scale';

/** A CSS-pixel rectangle. */
export interface CssRect { x: number; y: number; width: number; height: number }

export interface PrimitiveDrawScope {
  /** The context carries the CSS-px transform (`setTransform(pixelRatio, ...)`) and is clipped to the pane. */
  ctx: CanvasRenderingContext2D;
  pixelRatio: number;
  /** The pane in CSS px, relative to the chart's top-left. Draw inside it. */
  pane: CssRect;
  colors: Readonly<ThemeColors>;
  fontFamily: string;
  fontSize: number;
  visibleLogicalRange: LogicalRange | null;
  /** Bar-centre x (CSS px, chart coordinates) of a time on the axis; null when the time has no slot. */
  timeToX(time: Time): number | null;
  logicalToX(logical: number): number;
  /** y (CSS px, chart coordinates) of a price on the primitive's scale; null when not drawable. */
  priceToY(price: number): number | null;
  /** Draw text with tabular figures (`y` is the vertical middle). */
  text(text: string, x: number, y: number, color: string, weight?: number, align?: 'left' | 'center' | 'right'): void;
  measureText(text: string, weight?: number): number;
  /** Format a price the way the axis does. */
  formatPrice(price: number): string;
  /**
   * Series primitives only: the owning series' row at `time` (O(log n), no copy), or null. Undefined for a pane
   * primitive. Prefer it to `series.data()` inside `draw`.
   */
  seriesRowAt?(time: Time): object | null;
}

export interface PriceAxisLabel {
  price: number;
  text?: string;
  /**
   * When the price is outside the pane: false (default) shows no tag, true pins the tag to the nearest pane edge.
   * Series last-value tags are always pinned.
   */
  keepInView?: boolean;
  /** Tag fill; the text colour is picked for contrast unless given. */
  color: string;
  textColor?: string;
}

/** What a primitive gets on attach. Keep it; call `requestUpdate` when its own state changes. */
export interface PrimitiveHost {
  requestUpdate(): void;
  /** Repaint only the overlay layer (`drawOverlay`): for hover, selection and drag feedback. */
  requestOverlay?(): void;
  /** The series it is attached to, or null for a pane primitive. Typed loosely to keep this file dependency-free. */
  series: unknown;
}

export interface ChartPrimitive {
  attached?(host: PrimitiveHost): void;
  detached?(): void;
  /** Layer: under the series, with them (after), or on top of everything in the pane. Default 'normal'. */
  zOrder?: 'bottom' | 'normal' | 'top';
  /** Main layer: repainted when data, scales or options change (not on crosshair moves). */
  draw?(scope: PrimitiveDrawScope): void;
  /** Overlay layer: repainted on every crosshair move. Keep it cheap. */
  drawOverlay?(scope: PrimitiveDrawScope & { crosshair: { x: number; y: number; logical: number } | null }): void;
  /** Tags on the price axis (drawn after the series' last-value tags). Receives the theme colours in use. */
  priceAxisLabels?(colors: Readonly<ThemeColors>): readonly PriceAxisLabel[];
  /** Extra range autoscale must include for the visible logical range; null for none. */
  autoscale?(range: LogicalRange): { min: number; max: number } | null;
  /** Pane primitives only: the overlay scale id whose prices `priceToY` maps. Default 'right'. */
  priceScaleId?: string;
}
