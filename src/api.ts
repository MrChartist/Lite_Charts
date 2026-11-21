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
  /** Pointer position in CSS px relative to the chart; undefined when the crosshair left. */
  point?: Point;
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
  /** CSS px of the drawn axis (0 for an overlay scale). */
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
}

export interface ChartApi {
  /** Add a series of the given type, e.g. `chart.addSeries(CandlestickSeries, { upColor: '#1A7F37' })`. */
  addSeries<D extends AnySeriesDefinition>(definition: D, options?: DeepPartial<OptionsOf<D>>): SeriesApi<D>;
  removeSeries(series: SeriesApi<AnySeriesDefinition>): void;
  timeScale(): TimeScaleApi;
  /** 'right' (default) or an overlay scale id used by a series. */
  priceScale(id?: string): PriceScaleApi;
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
  /** Primitive drawn on the pane (not tied to a series). */
  attachPrimitive(primitive: ChartPrimitive): void;
  detachPrimitive(primitive: ChartPrimitive): void;
  /** The chart's root element (focusable). */
  element(): HTMLElement;
  /** Paint now instead of on the next animation frame. */
  paint(): void;
  remove(): void;
}
