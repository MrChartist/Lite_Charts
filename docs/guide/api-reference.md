---
title: API reference
description: Every public export of Chartist Lite with its signature: createChart, the chart, series, scale and pane interfaces, options, plugins, indicators, element and React.
order: 10
related: getting-started, series-types, plugins
---

# API reference

Every public export, with its signature as written in the source (`src/index.ts`, `src/api.ts`, `src/core/options.ts` and the entries below). Where a statement could not be confirmed from the source it says "Needs verification". The package ships TypeScript declarations for every entry.

## Entries

| Import | Contents | Script tag file and global |
|---|---|---|
| `@mrchartist/chartist-lite` | `createChart`, the six series, price lines, markers, themes, formatting helpers, types | `chartist-lite.iife.min.js`, `ChartistLite` |
| `@mrchartist/chartist-lite/indicators` | Indicator functions | `chartist-lite-indicators.iife.min.js`, `ChartistLiteIndicators` |
| `@mrchartist/chartist-lite/element` | `defineChartistElement` and the element's parsing helpers | `chartist-lite.element.iife.min.js`, `ChartistLiteElement` (registers `<chartist-chart>` on load) |
| `@mrchartist/chartist-lite/react` | `createChartistReact` and the controller | none |

The package is `sideEffects: false`, and importing any entry touches no DOM.

## Main entry

### createChart

```ts
function createChart(
  container: HTMLElement | string,
  options?: DeepPartial<ChartOptions> & { attribution?: boolean | DeepPartial<ChartOptions['attribution']> },
): ChartApi;
```

Creates a chart inside `container` (an element or its id). The chart fills the container and follows its size unless `autoSize: false` and a `width` and `height` are given. Throws `Error` for an id with no element and `TypeError` for something that is not an element.

### version

```ts
const version: '0.1.0';
```

### Series definitions

```ts
const CandlestickSeries: SeriesDefinition<CandlestickData, CandlestickOptions>;
const BarSeries:         SeriesDefinition<BarData, BarOptions>;
const LineSeries:        SeriesDefinition<LineData, LineOptions>;
const AreaSeries:        SeriesDefinition<AreaData, AreaOptions>;
const HistogramSeries:   SeriesDefinition<HistogramData, HistogramOptions>;
const BaselineSeries:    SeriesDefinition<BaselineData, BaselineOptions>;
```

Rows and options of each type are in [Series types](series-types.md). Their exported types are `CandlestickData`, `CandlestickOptions`, `LineData`, `LineOptions`, `LineStyle` (`'solid' | 'dashed' | 'dotted'`), `AreaData`, `AreaOptions`, `BarData`, `BarOptions`, `HistogramData`, `HistogramOptions`, `BaselineData` and `BaselineOptions`.

### Plugins

```ts
function createPriceLine(series: PrimitiveOwner, options: Partial<PriceLineOptions> & { price: number }): PriceLineHandle;
function createSeriesMarkers(series: MarkerSeries, markers?: readonly SeriesMarker[]): SeriesMarkersHandle;

interface PriceLineOptions { price: number; color?: string; lineWidth: number; lineStyle: PriceLineStyle; title: string; axisLabelVisible: boolean }
type PriceLineStyle = 'solid' | 'dashed' | 'dotted';
interface PriceLineHandle { applyOptions(options: Partial<PriceLineOptions>): void; options(): Readonly<PriceLineOptions>; remove(): void }

interface SeriesMarker { time: Time; position: MarkerPosition; shape: MarkerShape; color?: string; text?: string; size?: number }
type MarkerPosition = 'aboveBar' | 'belowBar' | 'inBar';
type MarkerShape = 'arrowUp' | 'arrowDown' | 'circle' | 'square';
interface SeriesMarkersHandle { setMarkers(markers: readonly SeriesMarker[]): void; markers(): readonly SeriesMarker[]; remove(): void }
```

`PrimitiveOwner` is anything with `attachPrimitive` and `detachPrimitive` (a series or a pane). `MarkerSeries` is a `PrimitiveOwner` that also has `data()`. Neither is exported by name from the entry (Needs verification); pass a series handle. Details and defaults: [Plugins and primitives](plugins.md).

### Themes and formatting

```ts
const lightTheme: Readonly<ThemeColors>;
const darkTheme: Readonly<ThemeColors>;
const MINUS_SIGN: '−';                                  // U+2212
function formatPrice(value: number, precision: number): string;    // toFixed, no grouping, true minus; '' for a non-finite value
function formatPercent(value: number, precision: number): string;  // '+1.50%', '−2.00%', '0.00%'
```

`precision` is clamped to 0 through 10.

### Rendering helpers

For authors of custom series types:

```ts
function crispCoord(cssValue: number, width: number, ratio: number): number;  // centre for a crisp stroke of `width` device px
function deviceWidth(cssWidth: number, ratio: number): number;                // whole device px, at least 1
function hairline(ratio: number): number;                                     // one CSS px, or the whole part of the ratio from 2
function createColumns(capacity?: number): Columns;
function decimateColumns<R>(rows: readonly (R | null)[], from: number, to: number, x: (i: number) => number, acc: ColumnAccess<R>, out?: Columns): Columns;
```

Types `ColumnAccess<R>` (`high`, `low`, optional `first` and `last` readers) and `Columns` (typed arrays `x`, `high`, `low`, `first`, `last`, `rows` and a `count`).

### Exported types

`ChartApi`, `SeriesApi`, `TimeScaleApi`, `PriceScaleApi`, `PaneApi`, `MouseEventParams`, `MouseEventHandler`, `LogicalRangeChangeHandler`, `TimeRange`, `Point`, `AnySeriesDefinition`, `ChartOptions`, `DeepPartial`, `LocalizationOptions`, `CrosshairOptions`, `InteractionOptions`, `ChartTimeScaleOptions`, `AttributionOptions`, `ThemeName`, `ThemeColors`, `Time`, `BusinessDay`, `PriceScaleOptions`, `PriceScaleMode`, `ScaleMargins`, `LogicalRange`, `SeriesDefinition`, `SeriesDrawScope`, `SeriesCommonOptions`, `PriceFormat`, `RowBase`, `WhitespaceData`, `DeviceRect`, `RowOf`, `OptionsOf`, `InputOf`, `ChartPrimitive`, `PrimitiveDrawScope`, `PrimitiveHost`, `PriceAxisLabel`, `CssRect`.

```ts
type Time = number | string | BusinessDay;     // UNIX seconds, 'YYYY-MM-DD', or an object
interface BusinessDay { year: number; month: number; day: number }   // month is 1 to 12
interface Point { x: number; y: number }
interface TimeRange { from: Time; to: Time }
interface LogicalRange { from: number; to: number }
type DeepPartial<T>;                            // recursive Partial; functions and arrays are left whole
```

## ChartApi

```ts
interface ChartApi {
  addSeries<D extends AnySeriesDefinition>(definition: D, options?: DeepPartial<OptionsOf<D>>, paneIndex?: number): SeriesApi<D>;
  removeSeries(series: SeriesApi<AnySeriesDefinition>): void;
  timeScale(): TimeScaleApi;
  priceScale(id?: string, paneIndex?: number): PriceScaleApi;
  panes(): PaneApi[];
  applyOptions(options: DeepPartial<ChartOptions> & { attribution?: boolean | DeepPartial<ChartOptions['attribution']> }): void;
  options(): Readonly<ChartOptions>;
  resize(width: number, height: number): void;
  subscribeCrosshairMove(handler: MouseEventHandler): void;
  unsubscribeCrosshairMove(handler: MouseEventHandler): void;
  subscribeClick(handler: MouseEventHandler): void;
  unsubscribeClick(handler: MouseEventHandler): void;
  takeScreenshot(): HTMLCanvasElement;
  attachPrimitive(primitive: ChartPrimitive): void;
  detachPrimitive(primitive: ChartPrimitive): void;
  element(): HTMLElement;
  paint(): void;
  remove(): void;
}
```

| Method | Notes |
|---|---|
| `addSeries` | `paneIndex` defaults to 0 (the top pane); an index past the last pane adds a pane |
| `priceScale(id = 'right', paneIndex = 0)` | `'right'`, `'left'`, or an overlay scale id used by a series in that pane |
| `panes()` | The stacked panes, top to bottom. The top pane always exists; a lower pane goes when its last series goes |
| `applyOptions` | A deep merge: removing a key does not reset it, set the value. `attribution` also accepts a boolean |
| `resize` | Sets the size in CSS px and turns `autoSize` off |
| `takeScreenshot` | A canvas holding the chart as drawn now, crosshair included |
| `attachPrimitive` | A primitive drawn on the top pane, not tied to a series |
| `element` | The chart's root element (focusable) |
| `paint` | Paint now instead of on the next animation frame |
| `remove` | Remove the chart and release its observers |

## SeriesApi

```ts
interface SeriesApi<D extends AnySeriesDefinition> {
  seriesType(): string;
  setData(data: readonly InputOf<D>[]): void;
  update(row: InputOf<D>): void;
  data(): readonly RowOf<D>[];
  applyOptions(options: DeepPartial<OptionsOf<D>>): void;
  options(): Readonly<OptionsOf<D>>;
  priceScale(): PriceScaleApi;
  priceToCoordinate(price: number): number | null;
  coordinateToPrice(y: number): number | null;
  attachPrimitive(primitive: ChartPrimitive): void;
  detachPrimitive(primitive: ChartPrimitive): void;
  paneIndex(): number;
  moveToPane(paneIndex: number): void;
}
```

`update` replaces the last bar when the time is the same and appends a newer one, repainting only what is visible. `data()` returns the stored rows without copying: do not mutate them, whitespace rows are omitted. `moveToPane` moves the series to another pane; an index past the last pane adds one, and an emptied pane below the top is removed. `setData` and `update` throw a `TypeError` whose message starts "Chartist Lite:" and names the bad field.

## TimeScaleApi

```ts
interface TimeScaleApi {
  fitContent(): void;
  scrollToRealTime(): void;
  resetTimeScale(): void;
  getVisibleRange(): TimeRange | null;
  setVisibleRange(range: TimeRange): void;
  getVisibleLogicalRange(): LogicalRange | null;
  setVisibleLogicalRange(range: LogicalRange): void;
  scrollPosition(): number;
  timeToCoordinate(time: Time): number | null;
  coordinateToTime(x: number): Time | null;
  logicalToCoordinate(logical: number): number | null;
  coordinateToLogical(x: number): number | null;
  width(): number;
  applyOptions(options: DeepPartial<ChartTimeScaleOptions>): void;
  options(): Readonly<ChartTimeScaleOptions>;
  subscribeVisibleLogicalRangeChange(handler: LogicalRangeChangeHandler): void;
  unsubscribeVisibleLogicalRangeChange(handler: LogicalRangeChangeHandler): void;
}
```

`fitContent` shows every bar. `scrollToRealTime` jumps back to the newest bar with the default right offset. `resetTimeScale` restores the default bar spacing and right offset. `scrollPosition` is the number of bars of space between the last bar and the right edge (negative when scrolled back). `width` is the plot width in CSS px. A logical index is the slot number on the shared time axis (the first distinct time is 0).

## PriceScaleApi

```ts
interface PriceScaleApi {
  applyOptions(options: DeepPartial<PriceScaleOptions>): void;
  options(): Readonly<PriceScaleOptions>;
  width(): number;     // CSS px of the drawn axis; 0 for an overlay scale or a hidden axis
}
```

## PaneApi

```ts
interface PaneApi {
  paneIndex(): number;
  getHeight(): number;
  setHeight(height: number): void;
  getStretchFactor(): number;
  setStretchFactor(factor: number): void;
  getSeries(): SeriesApi<AnySeriesDefinition>[];
  priceScale(id?: string): PriceScaleApi;
  attachPrimitive(primitive: ChartPrimitive): void;
  detachPrimitive(primitive: ChartPrimitive): void;
}
```

Heights are CSS px; panes share the height in proportion to their stretch factors. See [Panes and scales](panes-and-scales.md).

## MouseEventParams

```ts
interface MouseEventParams {
  time?: Time;                       // the bar under the pointer, as given in the data; undefined off the data
  logical?: number;
  point?: Point;                     // CSS px: x from the plot's left edge, y from the pane's top; undefined when the crosshair left
  paneIndex?: number;                // the pane under the pointer (0 = top)
  seriesData: Map<SeriesApi<AnySeriesDefinition>, RowBase>;   // the row each series has at that bar
}
type MouseEventHandler = (params: MouseEventParams) => void;
type LogicalRangeChangeHandler = (range: LogicalRange | null) => void;
```

## ChartOptions

Every field with its default.

| Option | Type | Default |
|---|---|---|
| `width`, `height` | number (CSS px) | 0 (ignored while `autoSize` is on) |
| `autoSize` | boolean | `true` |
| `theme` | `'light'`, `'dark'` or `'auto'` | `'light'` |
| `colors` | `Partial<ThemeColors>` | `{}` |
| `fontFamily` | string | the system font stack |
| `fontSize` | number (CSS px, never below 12) | 12 |
| `grid` | `{ vertLines, horzLines }` | both `true` |
| `crosshair` | `{ mode, labels }` | `{ mode: 'normal', labels: true }` |
| `timeScale` | see below | see below |
| `rightPriceScale` | `PriceScaleOptions` | `{ mode: 'linear', autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 }, visible: true }` |
| `leftPriceScale` | `PriceScaleOptions`; the left axis of the top pane, shown only while a series uses `priceScaleId: 'left'` | same as the right |
| `localization` | `{ priceFormatter?, timeFormatter?, hours12, dateOrder }` | `{ hours12: false, dateOrder: 'day-month' }` |
| `interaction` | `{ wheelZoom, dragPan, pinchZoom, kinetic, keyboard, doubleClickReset }` | `wheelZoom: 'auto'`, the rest `true` |
| `attribution` | `{ visible, position }` | `{ visible: true, position: 'axis-corner' }` |
| `ariaLabel` | string | `'Price chart'` |
| `ariaDescription` | string | the keyboard help text quoted in [Accessibility](accessibility.md) |

**timeScale** (`ChartTimeScaleOptions`): `barSpacing` (CSS px between bar centres at first show and after a reset, default 8), `minBarSpacing` (0.5; never stops a zoom-out before the whole series fits), `maxBarSpacing` (64), `rightOffset` (empty bars right of the last bar, default 2), `visible` (default true), `timeZone` (IANA zone, `'local'` or `'UTC'`; default `'UTC'`).

**crosshair.mode**: `'normal'` follows the pointer, `'magnet'` snaps the horizontal line to the first series' value, `'hidden'`.

**localization**: `priceFormatter(price: number): string` replaces the price text everywhere; `timeFormatter(time: Time): string` replaces the crosshair's time stamp; `hours12`; `dateOrder` is `'day-month'` or `'month-day'`.

**attribution.position**: `'axis-corner'` (default: the empty cell under the price axis), `'bottom-left'`, `'bottom-right'`, `'top-left'` or `'top-right'` (corners of the top pane).

**interaction.wheelZoom**: `'auto'` (default): a plain vertical wheel zooms only when the chart has focus or the page cannot scroll that way; ctrl/cmd + wheel (trackpad pinch) always zooms; a horizontal wheel pans; otherwise the page scrolls. `true`: a vertical wheel always zooms. `'modifier'`: only ctrl/cmd + wheel zooms. `false`: the wheel is ignored.

**Numbers in options**: `NaN` and infinite values are ignored and the previous value is kept. **priceFormat**: `minMove` alone sets `precision` (0.25 gives 2, 5 gives 0) and is the smallest axis step.

**Price scale handles**: `chart.priceScale(id, paneIndex)` throws a `RangeError` for a pane that does not exist. A handle stays bound to the scale it was taken from; after `series.moveToPane` take a new one with `series.priceScale()` (an overlay scale's options move with the series).

**View requests**: `fitContent`, `setVisibleRange` and `setVisibleLogicalRange` made while the chart has no width or no data are kept and applied when it has both.

**PriceScaleOptions**: `mode` (`'linear'`, `'log'` or `'percent'`), `autoScale` (fit the visible data on every repaint; dragging the axis turns it off and double-click turns it back on), `scaleMargins` (`{ top, bottom }`, shares of the pane height left empty, 0 to 1), `visible`. Overlay scales (any id other than `'right'` and `'left'`) are never drawn.

**ThemeColors**: `background`, `text`, `mutedText`, `grid`, `paneSeparator`, `crosshair`, `tagBackground`, `tagText`, `up`, `down`, `line`, `focusRing`.

**SeriesCommonOptions**: `priceScaleId`, `visible`, `lastValueVisible`, `priceLineVisible`, `priceFormat` (`{ precision, minMove }`), `title`. See [Series types](series-types.md).

## Primitives

```ts
interface ChartPrimitive {
  attached?(host: PrimitiveHost): void;
  detached?(): void;
  zOrder?: 'bottom' | 'normal' | 'top';
  draw?(scope: PrimitiveDrawScope): void;
  drawOverlay?(scope: PrimitiveDrawScope & { crosshair: { x: number; y: number; logical: number } | null }): void;
  priceAxisLabels?(colors: Readonly<ThemeColors>): readonly PriceAxisLabel[];
  autoscale?(range: LogicalRange): { min: number; max: number } | null;
  priceScaleId?: string;
}
interface PrimitiveHost { requestUpdate(): void; series: unknown }
interface PriceAxisLabel { price: number; text?: string; keepInView?: boolean; color: string; textColor?: string }
interface CssRect { x: number; y: number; width: number; height: number }
interface PrimitiveDrawScope {
  ctx: CanvasRenderingContext2D; pixelRatio: number; pane: CssRect; colors: Readonly<ThemeColors>;
  fontFamily: string; fontSize: number; visibleLogicalRange: LogicalRange | null;
  timeToX(time: Time): number | null; logicalToX(logical: number): number; priceToY(price: number): number | null;
  text(text: string, x: number, y: number, color: string, weight?: number, align?: 'left' | 'center' | 'right'): void;
  measureText(text: string, weight?: number): number; formatPrice(price: number): string;
}
```

## Custom series contract

```ts
interface SeriesDefinition<R extends RowBase = RowBase, O extends object = object> {
  readonly type: string;
  readonly defaults: Readonly<O>;
  normalize(input: Record<string, unknown> & { time: Time }): R | null;
  value(row: R): number;
  low(row: R, options?: Readonly<O & SeriesCommonOptions>): number;
  high(row: R, options?: Readonly<O & SeriesCommonOptions>): number;
  lastValueColor(row: R, options: Readonly<O & SeriesCommonOptions>, colors: Readonly<ThemeColors>): string;
  draw(scope: SeriesDrawScope<R, O>): void;
  crosshairMarker?(row: R, options: Readonly<O & SeriesCommonOptions>, colors: Readonly<ThemeColors>): { price: number; color: string } | null;
}
```

`SeriesDrawScope` has `ctx`, `pixelRatio`, `rows` (with `null` for whitespace), `from`, `to`, `x(rowIndex)`, `y(price)` (device px), `barSpacing`, `options`, `colors`, `pane` (a `DeviceRect`), and the optional `decimate` and `paneIndex`. `RowBase` is `{ time: Time }`; `WhitespaceData` is `{ time: Time }`. The contract is described in `src/series/definition.ts`; whether it is a stable public API in 0.1.0 is Needs verification.

## Indicators entry

```ts
import { sma, ema, wma, rsi, atr, obv, vwap, bollinger, donchian, macd, stochastic, supertrend, heikinAshi, aggregate, createIndicator } from '@mrchartist/chartist-lite/indicators';

function sma(rows: readonly IndicatorRow[], period?: number, options?: SourceOptions): IndicatorPoint[];
function ema(rows: readonly IndicatorRow[], period?: number, options?: SourceOptions): IndicatorPoint[];
function wma(rows: readonly IndicatorRow[], period?: number, options?: SourceOptions): IndicatorPoint[];
function rsi(rows: readonly IndicatorRow[], period?: number, options?: SourceOptions): IndicatorPoint[];
function atr(rows: readonly IndicatorRow[], period?: number): IndicatorPoint[];
function obv(rows: readonly IndicatorRow[]): IndicatorPoint[];
function vwap(rows: readonly IndicatorRow[], options?: VwapOptions): IndicatorPoint[];
function bollinger(rows: readonly IndicatorRow[], options?: BollingerOptions): BollingerResult;
function donchian(rows: readonly IndicatorRow[], period?: number): DonchianResult;
function macd(rows: readonly IndicatorRow[], options?: MacdOptions): MacdResult;
function stochastic(rows: readonly IndicatorRow[], options?: StochasticOptions): StochasticResult;
function supertrend(rows: readonly IndicatorRow[], options?: SupertrendOptions): SupertrendResult;
function heikinAshi(rows: readonly IndicatorRow[]): HeikinAshiBar[];
function aggregate(rows: readonly IndicatorRow[], by: AggregateBy, zone?: string): AggregatedBar[];
function createIndicator(kind: 'sma' | 'ema' | 'rsi', options?: PeriodOptions): Indicator<IndicatorPoint, IndicatorPoint[]>;
function createIndicator(kind: 'macd', options?: MacdOptions): Indicator<MacdPoint, MacdResult>;
```

Types:

```ts
type PriceSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';
interface IndicatorRow { time: Time; value?: number; open?: number; high?: number; low?: number; close?: number; volume?: number }
interface IndicatorPoint { time: Time; value?: number }
interface SourceOptions { source?: PriceSource }
interface PeriodOptions extends SourceOptions { period?: number }
interface VwapOptions { zone?: string; source?: PriceSource; reset?: 'day' | 'none' }
interface BollingerOptions extends SourceOptions { period?: number; mult?: number }
interface BollingerResult { basis: IndicatorPoint[]; upper: IndicatorPoint[]; lower: IndicatorPoint[] }
interface DonchianResult { upper: IndicatorPoint[]; lower: IndicatorPoint[]; middle: IndicatorPoint[] }
interface MacdOptions extends SourceOptions { fast?: number; slow?: number; signal?: number }
interface MacdResult { macd: IndicatorPoint[]; signal: IndicatorPoint[]; histogram: IndicatorPoint[] }
interface MacdPoint { macd: IndicatorPoint; signal: IndicatorPoint; histogram: IndicatorPoint }
interface StochasticOptions { kPeriod?: number; dPeriod?: number }
interface StochasticResult { k: IndicatorPoint[]; d: IndicatorPoint[] }
interface SupertrendOptions { period?: number; multiplier?: number }
interface SupertrendResult { line: IndicatorPoint[]; up: IndicatorPoint[]; down: IndicatorPoint[]; direction: (1 | -1)[] }
interface HeikinAshiBar { time: Time; open?: number; high?: number; low?: number; close?: number }
type AggregateBy = { every: number } | 'day' | 'week' | 'month';
interface AggregatedBar { time: Time; open: number; high: number; low: number; close: number; volume: number }
interface Indicator<Out, Batch> { next(row: IndicatorRow): Out; seed(rows: readonly IndicatorRow[]): Batch; reset(): void }
```

Defaults and warm-up lengths are in [Indicators](indicators.md).

## Element entry

```ts
function defineChartistElement(tagName?: string): CustomElementConstructor | null;   // default 'chartist-chart'; null without a DOM

function parseElementConfig(get: (name: string) => string | null): { config: ElementConfig; issues: string[] };
function parseRows(text: string): Row[];                                   // JSON or CSV text
function canonicalRows(input: unknown): Row[];
function shapeRowsForType(rows: readonly Row[], type: SeriesTypeName): Record<string, unknown>[];
function volumeRows(rows: readonly Row[]): Record<string, unknown>[];
function splitCsv(text: string): string[][];
function parseTime(value: unknown, where?: string): unknown;
const DEFAULT_HEIGHT: '360px';

interface ElementConfig { type: SeriesTypeName; theme: ThemeName; height: string; timeZone: string | null; volume: boolean; attribution: boolean; ariaLabel: string | null }
type SeriesTypeName = 'candlestick' | 'line' | 'area' | 'bar' | 'histogram' | 'baseline';
type Row = Record<string, unknown> & { time: unknown };
interface ChartistReadyDetail { chart: ChartApi }
interface ChartistErrorDetail { message: string; error: unknown }
```

The parsing helpers are pure and exist mainly for the element itself and for tests; their exact edge-case behaviour is in the source (`src/element/parse.ts`). The element's attributes, events and data formats are in [Embedding the chart](embedding.md).

## React entry

```ts
function createChartistReact<E>(React: ReactLike<E>): ChartistReact<E>;

interface ChartistReact<E> {
  ChartistChart: (props: ChartistChartProps) => E;
  useChartist: (props: ChartProps) => UseChartistResult;
}
interface ChartProps { options?: ChartOptionsInput; series?: readonly SeriesSpec[]; onReady?: (chart: ChartApi) => void; onCrosshairMove?: (params: MouseEventParams) => void }
interface ChartistChartProps extends ChartProps {
  className?: string;
  style?: Record<string, string | number | undefined>;
  height?: number | string;        // default 360
  ariaLabel?: string;
}
interface SeriesSpec { id?: string; type: SeriesTypeName | AnySeriesDefinition; data?: readonly SeriesRow[]; options?: Record<string, unknown> }
interface UseChartistResult { containerRef: { current: HTMLElement | null }; chart: ChartApi | null }
const DEFAULT_REACT_HEIGHT: 360;
```

Also exported: `ChartController` (the framework-free lifecycle behind the wrapper; constructor `(container, props, deps?)`, methods `apply(props)` and `destroy()`, property `chart`), the helpers `deepEqual`, `diffData`, `planSeries`, `seriesKey` and the constant `MAX_TAIL_UPDATES` (64), and the types `ChartOptionsInput`, `SeriesRow`, `ControllerDeps`, `DataChange`, `SeriesPlan`, `KeyedSeries`, `ReactLike`, `MouseEventParams`, `SeriesTypeName` and `ChartistSeries` (an alias of `SeriesSpec`). Behaviour of the wrapper: [Embedding the chart](embedding.md).
