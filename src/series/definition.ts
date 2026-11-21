// THE SERIES CONTRACT. A series type is one object implementing `SeriesDefinition`, in one file under
// `src/series/`. The chart owns data storage, the time index, scales, autoscale and repaint; the definition only
// validates rows and draws the visible ones. See ARCHITECTURE.md "Adding a series type".

import type { Time } from '../core/time';
import type { ThemeColors } from '../core/theme';

/** Every stored row keeps the time exactly as the caller gave it. */
export interface RowBase {
  time: Time;
}

/** A time with no value: it takes a slot on the time axis and draws nothing. */
export interface WhitespaceData {
  time: Time;
}

export interface PriceFormat {
  /** Decimals shown on the axis, last-value tag and crosshair. Default 2. */
  precision: number;
  /** Smallest price step; the axis never ticks finer. Default 10^-precision. */
  minMove: number;
}

/** Options every series has, whatever its type. */
export interface SeriesCommonOptions {
  /** 'right' (the drawn axis) or any other id: an overlay scale with its own range and margins, not drawn. */
  priceScaleId: string;
  visible: boolean;
  /** Tag with the last value on the price axis. */
  lastValueVisible: boolean;
  /** Dotted horizontal line at the last value. */
  priceLineVisible: boolean;
  priceFormat: PriceFormat;
  /** Short name, used by legends and the accessible description. */
  title: string;
}

/** A device-pixel rectangle. */
export interface DeviceRect { x: number; y: number; width: number; height: number }

/**
 * What a definition's `draw` receives. Coordinates are DEVICE pixels; the context has the identity transform and
 * is clipped to the pane. Draw only rows `from..to`, which already include one row beyond each plot edge.
 */
export interface SeriesDrawScope<R extends RowBase, O> {
  ctx: CanvasRenderingContext2D;
  /** Device pixels per CSS pixel. */
  pixelRatio: number;
  /** All rows; `null` marks whitespace. */
  rows: readonly (R | null)[];
  from: number;
  to: number;
  /** Bar-centre x of row `i`, device px (not rounded). */
  x: (rowIndex: number) => number;
  /** y of a price on this series' scale, device px (not rounded); NaN when the price cannot be shown. */
  y: (price: number) => number;
  /** Distance between bar centres, device px. */
  barSpacing: number;
  options: Readonly<O & SeriesCommonOptions>;
  colors: Readonly<ThemeColors>;
  pane: DeviceRect;
}

export interface SeriesDefinition<R extends RowBase = RowBase, O extends object = object> {
  /** Unique name, e.g. 'candlestick'. */
  readonly type: string;
  /** Type-specific option defaults (common options are added by the chart). */
  readonly defaults: Readonly<O>;
  /**
   * Validate and copy one input row (its `time` is already checked). Return null for a whitespace row (time only).
   * Throw a TypeError with a plain-words message for a row that cannot be used. Never keep a reference to `input`.
   */
  normalize(input: Record<string, unknown> & { time: Time }): R | null;
  /** The row's single value: last-value tag, percent base, magnet crosshair. */
  value(row: R): number;
  /** Lowest and highest price the row draws, for autoscale. */
  low(row: R): number;
  high(row: R): number;
  /** Colour of the last-value tag and price line for this row. */
  lastValueColor(row: R, options: Readonly<O & SeriesCommonOptions>, colors: Readonly<ThemeColors>): string;
  draw(scope: SeriesDrawScope<R, O>): void;
  /** Optional: a dot the crosshair draws on the hovered row (price and colour), or null for none. */
  crosshairMarker?(row: R, options: Readonly<O & SeriesCommonOptions>, colors: Readonly<ThemeColors>): { price: number; color: string } | null;
}

/** Row type of a definition. */
export type RowOf<D> = D extends SeriesDefinition<infer R, object> ? R : never;
/** Options type of a definition (type-specific and common). */
export type OptionsOf<D> = D extends SeriesDefinition<RowBase, infer O> ? O & SeriesCommonOptions : never;
/** What `setData`/`update` accept for a definition: its rows, or whitespace. */
export type InputOf<D> = RowOf<D> | WhitespaceData;
