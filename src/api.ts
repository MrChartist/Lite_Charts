// The public interfaces. Implementations live in src/chart/; these types are the contract users code against.

import type { ChartOptions, DeepPartial } from './core/options';
import type { Time } from './core/time';
import type { ChartPrimitive } from './plugins/primitive';
import type { PriceScaleOptions } from './scales/price-scale';
import type { LogicalRange } from './scales/time-scale';
import type { ChartTimeScaleOptions } from './core/options';
import type { InputOf, OptionsOf, RowBase, RowOf, SeriesDefinition } from './series/definition';

export interface Point { x: number; y: number }

export interface MouseEventParams {
  /** Time of the bar under the pointer, as given in the data; undefined off the data. */
  time?: Time;
  logical?: number;
  /**
   * Pointer position in CSS px relative to the plot area of the pane under it (x from the plot's left edge, y from
   * the pane's top); undefined when the crosshair left. With one pane and no left axis this is chart-relative.
   */
  point?: Point;
  /** The pane under the pointer (0 = top). */
  paneIndex?: number;
  /** The row each series has at that bar. */
  seriesData: Map<SeriesApi<AnySeriesDefinition>, RowBase>;
}

export type MouseEventHandler = (params: MouseEventParams) => void;
export type LogicalRangeChangeHandler = (range: LogicalRange | null) => void;

export interface TimeRange { from: Time; to: Time }

export interface TimeScaleApi {
  /** Show every bar. */
  fitContent(): void;
  /** Jump back to the newest bar with the default right offset. */
  scrollToRealTime(): void;
  /** Default bar spacing and right offset. */
  resetTimeScale(): void;
  getVisibleRange(): TimeRange | null;
  setVisibleRange(range: TimeRange): void;
  getVisibleLogicalRange(): LogicalRange | null;
  setVisibleLogicalRange(range: LogicalRange): void;
  /** Bars of space between the last bar and the right edge (negative when scrolled back). */
  scrollPosition(): number;
  timeToCoordinate(time: Time): number | null;
  coordinateToTime(x: number): Time | null;
  logicalToCoordinate(logical: number): number | null;
  coordinateToLogical(x: number): number | null;
  /** CSS px of the plot area. */
  width(): number;
  applyOptions(options: DeepPartial<ChartTimeScaleOptions>): void;
  options(): Readonly<ChartTimeScaleOptions>;
  subscribeVisibleLogicalRangeChange(handler: LogicalRangeChangeHandler): void;
  unsubscribeVisibleLogicalRangeChange(handler: LogicalRangeChangeHandler): void;
}

export interface PriceScaleApi {
  applyOptions(options: DeepPartial<PriceScaleOptions>): void;
  options(): Readonly<PriceScaleOptions>;
  /** CSS px of the drawn axis (0 for an overlay scale or a hidden axis). */
  width(): number;
}

export type AnySeriesDefinition = SeriesDefinition<any, any>;

export interface SeriesApi<D extends AnySeriesDefinition> {
  seriesType(): string;
  setData(data: readonly InputOf<D>[]): void;
  /** Replace the last bar (same time) or append a newer one. Repaints only what is visible. */
  update(row: InputOf<D>): void;
  /** The stored rows (copies are not made: do not mutate). Whitespace rows are omitted. */
  data(): readonly RowOf<D>[];
  applyOptions(options: DeepPartial<OptionsOf<D>>): void;
  options(): Readonly<OptionsOf<D>>;
  priceScale(): PriceScaleApi;
  priceToCoordinate(price: number): number | null;
  coordinateToPrice(y: number): number | null;
  attachPrimitive(primitive: ChartPrimitive): void;
  detachPrimitive(primitive: ChartPrimitive): void;
  /** The pane the series draws in (0 = top). */
  paneIndex(): number;
  /** Move the series to another pane (an index past the last pane adds one); an emptied pane below the top is removed. */
  moveToPane(paneIndex: number): void;
}

/** One of the stacked panes. Heights are CSS px; panes share the height in proportion to their stretch factors. */
export interface PaneApi {
  paneIndex(): number;
  getHeight(): number;
  /** Give this pane `height` px; the other panes keep their proportions. */
  setHeight(height: number): void;
  getStretchFactor(): number;
  setStretchFactor(factor: number): void;
  getSeries(): SeriesApi<AnySeriesDefinition>[];
  /** 'right', 'left' or an overlay id, in this pane. */
  priceScale(id?: string): PriceScaleApi;
  attachPrimitive(primitive: ChartPrimitive): void;
  detachPrimitive(primitive: ChartPrimitive): void;
}

export interface ChartApi {
  /**
   * Add a series of the given type, e.g. `chart.addSeries(CandlestickSeries, { upColor: '#1A7F37' })`.
   * `paneIndex` (default 0, the top pane) stacks it in another pane; an index past the last pane adds a pane.
   */
  addSeries<D extends AnySeriesDefinition>(definition: D, options?: DeepPartial<OptionsOf<D>>, paneIndex?: number): SeriesApi<D>;
  removeSeries(series: SeriesApi<AnySeriesDefinition>): void;
  timeScale(): TimeScaleApi;
  /** 'right' (default), 'left' or an overlay scale id used by a series, in pane `paneIndex` (default 0). */
  priceScale(id?: string, paneIndex?: number): PriceScaleApi;
  /** The stacked panes, top to bottom. The top pane always exists; a lower pane goes when its last series goes. */
  panes(): PaneApi[];
  applyOptions(options: DeepPartial<ChartOptions> & { attribution?: boolean | DeepPartial<ChartOptions['attribution']> }): void;
  options(): Readonly<ChartOptions>;
  /** Set the size in CSS px (turns autoSize off). */
  resize(width: number, height: number): void;
  subscribeCrosshairMove(handler: MouseEventHandler): void;
  unsubscribeCrosshairMove(handler: MouseEventHandler): void;
  subscribeClick(handler: MouseEventHandler): void;
  unsubscribeClick(handler: MouseEventHandler): void;
  /** A canvas holding the chart as drawn now (crosshair included). */
  takeScreenshot(): HTMLCanvasElement;
  /** Primitive drawn on the top pane (not tied to a series); `panes()[i].attachPrimitive` for another pane. */
  attachPrimitive(primitive: ChartPrimitive): void;
  detachPrimitive(primitive: ChartPrimitive): void;
  /** The chart's root element (focusable). */
  element(): HTMLElement;
  /** Paint now instead of on the next animation frame. */
  paint(): void;
  remove(): void;
}
