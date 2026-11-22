---
title: API reference
description: Every public export of Chartist Lite with its signature: createChart, the chart, series, scale and pane interfaces, options, plugins, indicators, element and React.
order: 10
related: getting-started, series-types, plugins
group: reference
task: Look up an export
summary: Every export with its signature, a sentence and a small example.
layout: api
---

# API reference

Every public export, with its signature as written in the source (`src/index.ts`, `src/api.ts`, `src/core/options.ts` and the entries below). Type a name in the filter to narrow the list. The package ships TypeScript declarations for every entry.

## Entries

| Import | Contents | Script tag file and global |
|---|---|---|
| `@mrchartist/chartist-lite` | `createChart`, the six series, price lines, markers, themes, formatting helpers, types | `chartist-lite.iife.min.js`, `ChartistLite` |
| `@mrchartist/chartist-lite/indicators` | Indicator functions | `chartist-lite-indicators.iife.min.js`, `ChartistLiteIndicators` |
| `@mrchartist/chartist-lite/element` | `defineChartistElement` and the element's parsing helpers | `chartist-lite.element.iife.min.js`, `ChartistLiteElement` (registers `<chartist-chart>` on load) |
| `@mrchartist/chartist-lite/drawings` | `createDrawingTools`, `TOOLS`, the JSON helpers | `chartist-lite-drawings.iife.min.js`, `ChartistLiteDrawings` |
| `@mrchartist/chartist-lite/react` | `createChartistReact` and the controller | none |
| `@mrchartist/chartist-lite/live` | `connectLive`, the built-in providers and their parsers | `chartist-lite-live.iife.min.js`, `ChartistLiteLive` |
| `<chartist-chart live>` (element plus live) | the element with the live entry inside | `chartist-lite.element-live.iife.min.js`, `ChartistLiteElement` (registers `<chartist-chart>` on load) |

The package is `sideEffects: false`, and importing any entry touches no DOM.

## Creating a chart

### `createChart`

```sig
createChart(container: HTMLElement | string, options?: DeepPartial<ChartOptions>): ChartApi
```

Creates a chart inside `container` (an element or its id). The chart fills the container and follows its size unless `autoSize: false` and a `width` and `height` are given. `attribution` also accepts a boolean. Throws `Error` for an id with no element and `TypeError` for something that is not an element.

```js
const chart = createChart('chart', { theme: 'dark', ariaLabel: 'DEMO daily price' });
```

### `version`

```sig
const version: '0.1.0'
```

The package version as a string.

### Series definitions

```sig
CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries, BaselineSeries
```

The six built-in series types, passed to `addSeries`. Rows and options of each are in [Series types](series-types.md). Their exported types are `CandlestickData`, `CandlestickOptions`, `LineData`, `LineOptions`, `LineStyle` (`'solid' | 'dashed' | 'dotted'`), `AreaData`, `AreaOptions`, `BarData`, `BarOptions`, `HistogramData`, `HistogramOptions`, `BaselineData` and `BaselineOptions`.

```js
const line = chart.addSeries(LineSeries, { title: 'Close', lineWidth: 2 });
```

## Chart

The object `createChart` returns (`ChartApi`).

### `chart.addSeries`

```sig
addSeries(definition, options?, paneIndex?: number): SeriesApi
```

Adds a series of the given type. `paneIndex` defaults to 0 (the top pane); an index past the last pane adds a pane.

```js
const rsiLine = chart.addSeries(LineSeries, { title: 'RSI 14' }, 1);
```

### `chart.removeSeries`

```sig
removeSeries(series: SeriesApi): void
```

Removes a series. A lower pane goes away with its last series; the top pane always stays.

```js
chart.removeSeries(rsiLine);
```

### `chart.timeScale`

```sig
timeScale(): TimeScaleApi
```

The shared time axis. See [Time scale](#time-scale).

```js
chart.timeScale().fitContent();
```

### `chart.priceScale`

```sig
priceScale(id = 'right', paneIndex = 0): PriceScaleApi
```

A price scale of a pane: `'right'`, `'left'`, or an overlay scale id used by a series in that pane. Throws a `RangeError` for a pane that does not exist.

```js
chart.priceScale('right').applyOptions({ mode: 'log' });
```

### `chart.panes`

```sig
panes(): PaneApi[]
```

The stacked panes, top to bottom. The top pane always exists; a lower pane goes when its last series goes.

```js
const [price, lower] = chart.panes();
```

### `chart.applyOptions`

```sig
applyOptions(options: DeepPartial<ChartOptions>): void
```

A deep merge into the current options: removing a key does not reset it, so set the value. `attribution` also accepts a boolean. Numbers that are `NaN` or infinite are ignored.

```js
chart.applyOptions({ theme: 'light', grid: { vertLines: true } });
```

### `chart.options`

```sig
options(): Readonly<ChartOptions>
```

The current options, with every default filled in.

```js
const zone = chart.options().timeScale.timeZone;
```

### `chart.resize`

```sig
resize(width: number, height: number): void
```

Sets the size in CSS px and turns `autoSize` off.

```js
chart.resize(800, 420);
```

### `chart.subscribeCrosshairMove`

```sig
subscribeCrosshairMove(handler: MouseEventHandler): void
unsubscribeCrosshairMove(handler: MouseEventHandler): void
```

Calls `handler` as the crosshair moves, with the bar, the point and each series' row. See [MouseEventParams](#mouseeventparams).

```js
chart.subscribeCrosshairMove(p => { if (p.time) console.log(p.time, p.seriesData.get(candles)); });
```

### `chart.subscribeClick`

```sig
subscribeClick(handler: MouseEventHandler): void
unsubscribeClick(handler: MouseEventHandler): void
```

Calls `handler` on a click on the chart, with the same parameters as a crosshair move.

```js
chart.subscribeClick(p => select(p.time));
```

### `chart.takeScreenshot`

```sig
takeScreenshot(): HTMLCanvasElement
```

A canvas holding the chart as drawn now, crosshair included.

```js
const url = chart.takeScreenshot().toDataURL('image/png');
```

### `chart.attachPrimitive`

```sig
attachPrimitive(primitive: ChartPrimitive): void
detachPrimitive(primitive: ChartPrimitive): void
```

A primitive drawn on the top pane, not tied to a series. For another pane, use `chart.panes()[i].attachPrimitive`. See [Plugins and primitives](plugins.md).

```js
chart.attachPrimitive(myBand);
```

### `chart.addPointerHandler`

```sig
addPointerHandler(handler: ChartPointerHandler): () => void
```

Lets a plugin take pointer gestures and keys before the chart does; returns a function that removes the handler. Handlers are asked in the order they were added. A `ChartPointerHandler` may implement `pointerDown(e)` (return `true` to own the gesture), `pointerMove(e)`, `pointerUp(e, cancelled)`, `hover(e)`, `keyDown(e)` (return `true` when handled) and `blocksTouch()`. A `ChartPointerEvent` has `point`, `paneIndex`, `logical`, `area` (`'pane' | 'price' | 'time' | 'none'`), `pointerType` and the modifier keys. Both interfaces are exported as types from the main entry. See [Drawing tools](drawing-tools.md#write-a-tool-of-your-own).

```js
const off = chart.addPointerHandler({ pointerDown: e => e.shiftKey && e.area === 'pane' });
```

### `chart.setCursor`

```sig
setCursor(cursor: string | null): void
```

Forces the pointer cursor over the chart, for a plugin's tool; `null` gives it back to the chart.

```js
chart.setCursor('crosshair');
```

### `chart.element`

```sig
element(): HTMLElement
```

The chart's root element. It is focusable, so this is how you move keyboard focus to the chart.

```js
chart.element().focus();
```

### `chart.paint`

```sig
paint(): void
```

Paints now instead of on the next animation frame.

```js
series.setData(rows); chart.paint();
```

### `chart.remove`

```sig
remove(): void
```

Removes the chart and releases its observers.

```js
chart.remove();
```

## Series

The object `addSeries` returns (`SeriesApi`).

### `series.setData`

```sig
setData(data: readonly Row[]): void
```

Replaces every row. Rows must be in ascending time order; a time-only row `{ time }` takes a slot and draws nothing. Throws a `TypeError` whose message starts "Chartist Lite:" and names the bad field.

```js
candles.setData([{ time: '2024-01-02', open: 100, high: 104, low: 99, close: 103 }]);
```

### `series.update`

```sig
update(row: Row): void
```

Replaces the last bar when the time is the same and appends a newer one, repainting only what is visible.

```js
candles.update({ time: '2024-06-14', open: 101.2, high: 102.9, low: 100.8, close: 102.4 });
```

### `series.data`

```sig
data(): readonly Row[]
```

The stored rows, not copied: do not mutate them. Whitespace rows are left out.

```js
const last = candles.data().at(-1);
```

### `series.applyOptions`

```sig
applyOptions(options: DeepPartial<Options>): void
options(): Readonly<Options>
```

Changes the series options (a deep merge), or reads them.

```js
line.applyOptions({ lineStyle: 'dashed', visible: true });
```

### `series.priceScale`

```sig
priceScale(): PriceScaleApi
```

The scale this series is read on, in its own pane. Take a new handle after `moveToPane`.

```js
volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
```

### `series.priceToCoordinate`

```sig
priceToCoordinate(price: number): number | null
coordinateToPrice(y: number): number | null
```

Converts between a price and a y coordinate in CSS px from the top of the series' pane.

```js
const y = candles.priceToCoordinate(100);
```

### `series.attachPrimitive`

```sig
attachPrimitive(primitive: ChartPrimitive): void
detachPrimitive(primitive: ChartPrimitive): void
```

A primitive whose prices map through this series' scale.

```js
candles.attachPrimitive(band);
```

### `series.moveToPane`

```sig
moveToPane(paneIndex: number): void
paneIndex(): number
```

Moves the series to another pane; an index past the last pane adds one, and an emptied pane below the top is removed.

```js
rsiLine.moveToPane(2);
```

### `series.seriesType`

```sig
seriesType(): string
```

The type name of the series definition, such as `'candlestick'`.

```js
if (s.seriesType() === 'line') s.applyOptions({ lineWidth: 1 });
```

## Time scale

The shared time axis (`TimeScaleApi`). A logical index is the slot number on that axis: the first distinct time is 0.

### `timeScale.fitContent`

```sig
fitContent(): void
```

Shows every bar. A request made before the chart has a width or data is kept and applied when it has both.

```js
chart.timeScale().fitContent();
```

### `timeScale.scrollToRealTime`

```sig
scrollToRealTime(): void
resetTimeScale(): void
```

`scrollToRealTime` jumps back to the newest bar with the default right offset; `resetTimeScale` also restores the default bar spacing.

```js
chart.timeScale().scrollToRealTime();
```

### `timeScale.setVisibleRange`

```sig
getVisibleRange(): TimeRange | null
setVisibleRange(range: { from: Time; to: Time }): void
```

Reads or sets the visible range by time.

```js
chart.timeScale().setVisibleRange({ from: '2024-03-01', to: '2024-06-28' });
```

### `timeScale.setVisibleLogicalRange`

```sig
getVisibleLogicalRange(): LogicalRange | null
setVisibleLogicalRange(range: { from: number; to: number }): void
```

Reads or sets the visible range by logical index.

```js
chart.timeScale().setVisibleLogicalRange({ from: 100, to: 220 });
```

### `timeScale.scrollPosition`

```sig
scrollPosition(): number
```

The number of bars of space between the last bar and the right edge; negative when scrolled back.

```js
const atEnd = chart.timeScale().scrollPosition() >= 0;
```

### `timeScale.timeToCoordinate`

```sig
timeToCoordinate(time: Time): number | null
coordinateToTime(x: number): Time | null
logicalToCoordinate(logical: number): number | null
coordinateToLogical(x: number): number | null
```

Converts between a time or logical index and x in CSS px from the plot's left edge.

```js
const x = chart.timeScale().timeToCoordinate('2024-03-04');
```

### `timeScale.timeToLogical`

```sig
timeToLogical(time: Time | number): number | null
logicalToTime(logical: number): number | null
```

A time's logical index, and the time (UNIX seconds) at a logical index: exact for a bar's time, interpolated between bars, extrapolated past either end at the median bar interval. `null` before any data. Drawings anchor to times through these, so they survive zoom, resize and new data.

```js
const t = chart.timeScale().logicalToTime(chart.timeScale().coordinateToLogical(x));
```

### `timeScale.width`

```sig
width(): number
```

The plot width in CSS px.

```js
const barsInView = chart.timeScale().width() / 8;
```

### `timeScale.applyOptions`

```sig
applyOptions(options: DeepPartial<ChartTimeScaleOptions>): void
options(): Readonly<ChartTimeScaleOptions>
```

Changes the time scale options: `barSpacing`, `minBarSpacing`, `maxBarSpacing`, `rightOffset`, `visible`, `timeZone`.

```js
chart.timeScale().applyOptions({ barSpacing: 12, timeZone: 'America/New_York' });
```

### `timeScale.subscribeVisibleLogicalRangeChange`

```sig
subscribeVisibleLogicalRangeChange(handler: LogicalRangeChangeHandler): void
unsubscribeVisibleLogicalRangeChange(handler: LogicalRangeChangeHandler): void
```

Calls `handler` with the new logical range when the view moves. Use it to keep separate charts in step.

```js
a.timeScale().subscribeVisibleLogicalRangeChange(r => r && b.timeScale().setVisibleLogicalRange(r));
```

## Price scale and panes

### `priceScale.applyOptions`

```sig
applyOptions(options: DeepPartial<PriceScaleOptions>): void
options(): Readonly<PriceScaleOptions>
width(): number
```

Changes a scale: `mode` (`'linear'`, `'log'` or `'percent'`), `autoScale`, `scaleMargins` (`{ top, bottom }`, shares of the pane height, 0 to 1) and `visible`. `width` is the CSS px of the drawn axis, 0 for an overlay or hidden axis. A handle stays bound to the scale it was taken from.

```js
chart.priceScale('right').applyOptions({ mode: 'percent', scaleMargins: { top: 0.2, bottom: 0.1 } });
```

### `pane.setHeight`

```sig
getHeight(): number
setHeight(height: number): void
getStretchFactor(): number
setStretchFactor(factor: number): void
```

Pane heights in CSS px. Panes share the height in proportion to their stretch factors; `setHeight` gives one pane that height and keeps the others' proportions. It has no effect while there is one pane.

```js
chart.panes()[1].setHeight(160);
```

### `pane.getSeries`

```sig
paneIndex(): number
getSeries(): SeriesApi[]
priceScale(id?: string): PriceScaleApi
attachPrimitive(primitive: ChartPrimitive): void
detachPrimitive(primitive: ChartPrimitive): void
```

The series in a pane, its scales and primitives drawn on it.

```js
const lower = chart.panes()[1].getSeries();
```

## Events

### `MouseEventParams`

```sig
{ time?: Time; logical?: number; point?: { x, y }; paneIndex?: number; seriesData: Map<SeriesApi, Row> }
```

What crosshair and click handlers receive. `time` is the bar's time as given in the data, `undefined` off the data. `point` is in CSS px relative to the pane under the pointer (x from the plot's left edge, y from the pane's top), `undefined` when the crosshair left. `paneIndex` is that pane (0 is the top). `seriesData` holds the row each series has at that bar.

```js
chart.subscribeCrosshairMove(({ time, paneIndex }) => show(time, paneIndex));
```

## Options

Every chart option with its default (`ChartOptions`). Pass them to `createChart` or `applyOptions`.

| Option | Type | Default |
|---|---|---|
| `width`, `height` | number (CSS px) | 0 (ignored while `autoSize` is on) |
| `autoSize` | boolean | `true` |
| `theme` | `'light'`, `'dark'` or `'auto'` | `'light'` |
| `colors` | `Partial<ThemeColors>` | `{}` |
| `fontFamily` | string | the system font stack |
| `fontSize` | number (CSS px, never below 12) | 12 |
| `grid` | `{ vertLines, horzLines }` | `{ vertLines: false, horzLines: true }` |
| `crosshair` | `{ mode, labels }` | `{ mode: 'normal', labels: true }` |
| `timeScale` | `ChartTimeScaleOptions` | see below |
| `rightPriceScale` | `PriceScaleOptions` | `{ mode: 'linear', autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 }, visible: true }` |
| `leftPriceScale` | `PriceScaleOptions` | same as the right |
| `localization` | `{ priceFormatter?, timeFormatter?, hours12, dateOrder, noDataText }` | `{ hours12: false, dateOrder: 'day-month', noDataText: 'No data' }` |
| `interaction` | `{ wheelZoom, dragPan, pinchZoom, kinetic, keyboard, doubleClickReset }` | `wheelZoom: 'auto'`, the rest `true` |
| `attribution` | `{ visible, position }` | `{ visible: true, position: 'axis-corner' }` |
| `legend` | `{ visible }` | `{ visible: true }` |
| `ariaLabel` | string | `'Price chart'` |
| `ariaDescription` | string | the keyboard help quoted in [Accessibility](accessibility.md) |

### `timeScale` options

```sig
{ barSpacing: 8, minBarSpacing: 0.5, maxBarSpacing: 64, rightOffset: 2, visible: true, timeZone: 'UTC' }
```

`barSpacing` is the CSS px between bar centres at first show and after a reset. `minBarSpacing` never stops a zoom-out before the whole series fits. `rightOffset` is the empty bars right of the last bar. `timeZone` is an IANA zone, `'local'` or `'UTC'`; an unknown zone reads as UTC.

```js
createChart('chart', { timeScale: { timeZone: 'Asia/Kolkata', rightOffset: 6 } });
```

### `localization` options

```sig
{ priceFormatter?: (price: number) => string; timeFormatter?: (time: Time) => string; hours12: boolean; dateOrder: 'day-month' | 'month-day'; noDataText: string }
```

`priceFormatter` replaces the price text everywhere (axis, last value, crosshair, legend). `timeFormatter` replaces the crosshair's time stamp. `noDataText` is shown in the centre of a chart with no data; an empty string shows nothing.

```js
createChart('chart', { localization: { priceFormatter: p => `₹${p.toFixed(2)}`, noDataText: 'Loading' } });
```

### `interaction` options

```sig
{ wheelZoom: boolean | 'auto' | 'modifier'; dragPan: boolean; pinchZoom: boolean; kinetic: boolean; keyboard: boolean; doubleClickReset: boolean }
```

`wheelZoom: 'auto'` (default): a plain vertical wheel zooms only when the chart has focus or the page cannot scroll that way; ctrl or cmd with the wheel (a trackpad pinch) always zooms; a horizontal wheel pans. `true` always zooms, `'modifier'` zooms only with ctrl or cmd, `false` ignores the wheel. `kinetic` glide is off under `prefers-reduced-motion`.

```js
createChart('chart', { interaction: { wheelZoom: 'modifier', kinetic: false } });
```

### `crosshair` options

```sig
{ mode: 'normal' | 'magnet' | 'hidden'; labels: boolean }
```

`'normal'` follows the pointer, `'magnet'` snaps the horizontal line to the first series' value, `'hidden'` draws no crosshair. `labels` shows the axis tags under the lines.

```js
chart.applyOptions({ crosshair: { mode: 'magnet' } });
```

### `legend` option

```sig
{ visible: boolean }
```

The built-in legend at the top left of each pane: each titled series' name and the values of the hovered bar (the last bar when nothing is hovered). Shown for panes that have a series with a `title`. See [Theming](theming.md#the-legend).

```js
createChart('chart', { legend: { visible: false } });
```

### `attribution` option

```sig
boolean | { visible: boolean; position: 'axis-corner' | 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' }
```

The small "Chartist" link. `'axis-corner'` (default) is the empty cell under the price axis; the others are corners of the top pane. `false` hides it.

```js
createChart('chart', { attribution: { position: 'bottom-left' } });
```

### `ThemeColors`

```sig
{ background, text, mutedText, grid, paneSeparator, crosshair, tagBackground, tagText, up, down, upText, downText, volume, line, focusRing }
```

The palette keys, all CSS colour strings. `colors` takes any subset; `lightTheme` and `darkTheme` are the built-in values. See [Theming](theming.md).

```js
createChart('chart', { colors: { up: '#0A84FF', down: '#FF9F0A' } });
```

### `SeriesCommonOptions`

```sig
{ priceScaleId: string; visible: boolean; lastValueVisible: boolean; priceLineVisible: boolean; priceFormat: { precision, minMove }; title: string }
```

Options every series has. `priceFormat.minMove` alone sets the decimals (0.25 gives 2, 5 gives 0) and is the smallest axis step. `title` names the series in the legend and the spoken description.

```js
chart.addSeries(LineSeries, { title: 'Yield', priceFormat: { precision: 3, minMove: 0.001 } });
```

## Plugins

### `createPriceLine`

```sig
createPriceLine(series, options: { price: number; color?; lineWidth?; lineStyle?; title?; axisLabelVisible? }): PriceLineHandle
```

A horizontal line at a price, with an axis tag. Returns `{ applyOptions, options, remove }`. A bad value throws a `TypeError` that names the field. Defaults and details: [Plugins and primitives](plugins.md).

```js
const level = createPriceLine(candles, { price: 152.4, title: 'Resistance', lineStyle: 'dashed' });
```

### `createSeriesMarkers`

```sig
createSeriesMarkers(series, markers?: SeriesMarker[]): SeriesMarkersHandle
```

Shapes with short text above, below or inside bars. A marker is `{ time, position, shape, color?, text?, size? }`; positions `'aboveBar' | 'belowBar' | 'inBar'`, shapes `'arrowUp' | 'arrowDown' | 'circle' | 'square'`. Returns `{ setMarkers, markers, remove }`.

```js
createSeriesMarkers(candles, [{ time: '2024-03-04', position: 'belowBar', shape: 'arrowUp', text: 'Buy' }]);
```

### `ChartPrimitive`

```sig
{ attached?(host); detached?(); zOrder?: 'bottom' | 'normal' | 'top'; draw?(scope); drawOverlay?(scope); priceAxisLabels?(colors); autoscale?(range); priceScaleId? }
```

The contract price lines, markers and drawings are made from. Every hook is optional. `draw` gets a scope with `ctx`, `pixelRatio`, `pane`, `colors`, `fontFamily`, `fontSize`, `visibleLogicalRange`, `timeToX`, `logicalToX`, `priceToY`, `text`, `measureText`, `formatPrice` and, where available, `seriesRowAt(time)`. Related types: `PrimitiveDrawScope`, `PrimitiveHost` (`{ requestUpdate(), series }`, and `requestOverlay()` to repaint only the overlay layer), `PriceAxisLabel` (`{ price, text?, keepInView?, color, textColor? }`), `CssRect`.

```js
candles.attachPrimitive({ draw: s => { const y = s.priceToY(100); if (y !== null) s.ctx.fillRect(s.pane.x, y, s.pane.width, 1); } });
```

## Themes and formatting

### `lightTheme`, `darkTheme`

```sig
const lightTheme: Readonly<ThemeColors>
const darkTheme: Readonly<ThemeColors>
```

The built-in palettes as plain data.

```js
const upColour = darkTheme.up;
```

### `formatPrice`

```sig
formatPrice(value: number, precision: number): string
```

Fixed decimals, no grouping separators, the true minus sign U+2212; an empty string for a non-finite value. `precision` is clamped to 0 through 10.

```js
formatPrice(-2.345, 2);   // '−2.35'
```

### `formatPercent`

```sig
formatPercent(value: number, precision: number): string
```

A signed percentage: `+1.50%`, `−2.00%`, `0.00%`. A value that rounds to zero carries no sign.

```js
formatPercent(1.5, 2);   // '+1.50%'
```

### `MINUS_SIGN`

```sig
const MINUS_SIGN: '−'
```

The true minus sign, U+2212, as the formatters write it.

```js
const text = value < 0 ? `${MINUS_SIGN}${Math.abs(value)}` : String(value);
```

## Custom series and rendering

### `SeriesDefinition`

```sig
{ type; defaults; normalize(input); value(row); low(row, options?); high(row, options?); lastValueColor(row, options, colors); draw(scope); crosshairMarker?(row, options, colors) }
```

The contract of a series type. `draw` receives a `SeriesDrawScope` with `ctx`, `pixelRatio`, `rows` (with `null` for whitespace), `from`, `to`, `x(rowIndex)`, `y(price)` in device px, `barSpacing`, `options`, `colors`, `pane` (a `DeviceRect`), and the optional `decimate` and `paneIndex`. Related types: `SeriesCommonOptions`, `PriceFormat`, `RowBase`, `WhitespaceData`, `RowOf`, `OptionsOf`, `InputOf`. The contract is in `src/series/definition.ts`.

```js
const DotSeries = { ...LineSeries, type: 'dots', draw(scope) { /* your marks */ } };
```

> [!VERIFY]
> Whether the custom series contract is a stable public API in 0.1.0 is not settled.

### Rendering helpers

```sig
crispCoord(cssValue, width, ratio): number
deviceWidth(cssWidth, ratio): number
hairline(ratio): number
createColumns(capacity?): Columns
decimateColumns(rows, from, to, x, access, out?): Columns
```

For authors of custom series types: a centre for a crisp stroke of `width` device px, a whole device-pixel width of at least 1, one CSS px as device px, and column folding for dense data (`ColumnAccess` reads `high`, `low` and optional `first` and `last`; `Columns` holds typed arrays and a `count`).

```js
const x = crispCoord(cssX, 1, scope.pixelRatio);
```

## Indicators

From `@mrchartist/chartist-lite/indicators`. Each returns rows aligned one to one with the input; warm-up bars are `{ time }`. Defaults and warm-up lengths: [Indicators](indicators.md).

### `sma`, `ema`, `wma`

```sig
sma(rows, period = 20, { source }?): IndicatorPoint[]
ema(rows, period = 20, { source }?): IndicatorPoint[]
wma(rows, period = 20, { source }?): IndicatorPoint[]
```

Simple, exponential (seeded with an SMA) and weighted moving averages. `source` is `'close'` by default; also `'open'`, `'high'`, `'low'`, `'hl2'`, `'hlc3'`, `'ohlc4'`.

```js
chart.addSeries(LineSeries, { title: 'EMA 50' }).setData(ema(bars, 50));
```

### `rsi`

```sig
rsi(rows, period = 14, { source }?): IndicatorPoint[]
```

Wilder's relative strength index.

```js
chart.addSeries(LineSeries, { title: 'RSI 14' }, 1).setData(rsi(bars, 14));
```

### `macd`

```sig
macd(rows, { fast = 12, slow = 26, signal = 9, source }?): { macd, signal, histogram }
```

Three aligned arrays; `histogram` is ready for a `HistogramSeries`.

```js
const m = macd(bars);
```

### `bollinger`, `donchian`

```sig
bollinger(rows, { period = 20, mult = 2, source }?): { basis, upper, lower }
donchian(rows, period = 20): { upper, lower, middle }
```

Bands as three aligned arrays.

```js
const bb = bollinger(bars, { period: 20, mult: 2 });
```

### `atr`, `obv`, `vwap`

```sig
atr(rows, period = 14): IndicatorPoint[]
obv(rows): IndicatorPoint[]
vwap(rows, { zone, source, reset }?): IndicatorPoint[]
```

Wilder's average true range, on-balance volume, and the volume-weighted average price restarting each calendar day in `zone` (`reset: 'none'` for daily bars). `obv` and `vwap` need `volume`.

```js
chart.addSeries(LineSeries, { title: 'VWAP' }).setData(vwap(fiveMinuteBars, { zone: 'Asia/Kolkata' }));
```

### `stochastic`, `supertrend`

```sig
stochastic(rows, { kPeriod = 14, dPeriod = 3 }?): { k, d }
supertrend(rows, { period = 10, multiplier = 3 }?): { line, up, down, direction }
```

`supertrend.up` and `.down` are `line` split by trend so each can be coloured; `direction` is 1 or −1 per bar.

```js
const st = supertrend(bars);
```

### `heikinAshi`, `aggregate`

```sig
heikinAshi(rows): { time, open, high, low, close }[]
aggregate(rows, by: { every: number } | 'day' | 'week' | 'month', zone = 'UTC'): { time, open, high, low, close, volume }[]
```

Heikin-Ashi candles, and bars folded into a higher timeframe by count or by calendar in `zone`.

```js
const fifteen = aggregate(fiveMinuteBars, { every: 3 });
```

### `createIndicator`

```sig
createIndicator(kind: 'sma' | 'ema' | 'rsi' | 'macd', options?): { next(row), seed(rows), reset() }
```

Incremental forms for live data: `next` costs the same per tick; a row with the last bar's time replaces it. An unknown kind throws.

```js
const rsi14 = createIndicator('rsi', { period: 14 });
rsiSeries.update(rsi14.next(liveRow));
```

### Indicator types

```sig
PriceSource, IndicatorRow, IndicatorPoint, SourceOptions, PeriodOptions, VwapOptions, BollingerOptions, BollingerResult, DonchianResult, MacdOptions, MacdResult, MacdPoint, StochasticOptions, StochasticResult, SupertrendOptions, SupertrendResult, HeikinAshiBar, AggregateBy, AggregatedBar, Indicator
```

An `IndicatorRow` is `{ time, value?, open?, high?, low?, close?, volume? }`; an `IndicatorPoint` is `{ time, value? }`.

```js
/** @type {import('@mrchartist/chartist-lite/indicators').IndicatorPoint[]} */
const points = sma(bars, 20);
```

## Drawings

From `@mrchartist/chartist-lite/drawings`. Behaviour, tools and keys: [Drawing tools](drawing-tools.md).

### `createDrawingTools`

```sig
createDrawingTools(chart, series, { toolbar?, magnet?, keepDrawing?, defaultStyle?, persist? }?): DrawingToolsController
```

Adds drawing tools to a chart, anchored to `series`. `toolbar` is `true` or `{ position: 'left' | 'top' }` (default off); `magnet` snaps to open, high, low or close (default on); `keepDrawing` stays on the tool (default off); `defaultStyle` is `{ color?, width: 1 | 2 | 3, dash: 'solid' | 'dashed' }`; `persist` is `{ key, storage? }`.

```js
const tools = createDrawingTools(chart, candles, { toolbar: true });
```

### `tools.setTool`

```sig
setTool(id: ToolId | null): void
tool(): ToolId | null
tools(): readonly ToolInfo[]
```

Arms a tool (the next press on the chart starts it) or returns to the cursor with `null`. An unknown id throws a `TypeError`.

```js
tools.setTool('fib');
```

### `tools.add`

```sig
add(spec: DrawingSpec): Drawing
update(id: string, patch): Drawing | null
remove(id: string): boolean
clear(): void
drawings(): Drawing[]
```

Creates, changes and removes drawings from code. A spec is `{ tool, points: [{ time, price }], style?, text?, pane?, locked?, id? }`; times may be UNIX seconds, `'YYYY-MM-DD'` or business-day objects and are stored as UNIX seconds. `drawings()` returns copies.

```js
tools.add({ tool: 'horizontal', points: [{ time: '2024-06-03', price: 104.9 }], text: 'Resistance' });
```

### `tools.select`

```sig
select(id: string | null): void
selected(): Drawing | null
```

Selects a drawing (or clears the selection) as a click would.

```js
tools.select(tools.drawings()[0].id);
```

### `tools.exportJSON`

```sig
exportJSON(): string
importJSON(json: string, mode?: 'replace' | 'append'): number
```

Versioned JSON (`{ format: 'chartist-lite-drawings', version: 1, drawings }`) and its reader, which returns how many drawings it loaded and skips unknown tools and bad entries. `drawingsToJSON(list)`, `drawingsFromJSON(json, style)`, `normalizeSpec(spec, style)`, `FORMAT` and `VERSION` are exported for your own storage.

```js
localStorage.setItem('chart-1', tools.exportJSON());
```

### `tools.on`

```sig
on(event: 'created' | 'changed' | 'removed' | 'selected', handler: (drawing: Drawing | null) => void): () => void
```

Calls `handler` with a copy of the drawing (`null` when a selection is cleared); returns a remover.

```js
tools.on('created', d => save(d));
```

### `tools.undo`

```sig
undo(): boolean
redo(): boolean
canUndo(): boolean
canRedo(): boolean
```

Steps through the last 100 changes. Returns `false` when there is nothing to undo or redo.

```js
if (tools.canUndo()) tools.undo();
```

### `tools.setMagnet`

```sig
setMagnet(on: boolean): void
setKeepDrawing(on: boolean): void
setHidden(on: boolean): void
magnet(), keepDrawing(), hidden(), colors(), destroy()
```

Switches the magnet, keep drawing and hiding every drawing; `colors()` gives the theme colours in use, and `destroy()` removes the tools, their toolbar and their hooks.

```js
tools.setHidden(true);
```

### `TOOLS`

```sig
const TOOLS: readonly { id: ToolId; label: string; points: number }[]
```

The fifteen tools: `trend`, `ray`, `extended`, `horizontal`, `horizontalRay`, `vertical`, `rectangle`, `channel`, `fib`, `measure`, `long`, `short`, `arrow`, `text`, `brush` (0 points: freehand). Also exported: `ICONS` (the toolbar's icons), `geometry` (pure helpers) and the types `DrawingSpec`, `DrawingToolsController`, `DrawingToolsOptions`, `DrawingEvent`, `Anchor`, `Drawing`, `DrawingStyle`, `ToolId`, `ToolInfo`.

```js
const twoPointTools = TOOLS.filter(t => t.points === 2).map(t => t.id);
```

## Live data

From `@mrchartist/chartist-lite/live`. Behaviour, statuses, privacy and the exchanges' limits: [Live data](live-data.md). The core never imports this entry; importing it opens nothing.

### `connectLive`

```sig
connectLive(series, { symbol?, interval?, provider?, volumeSeries?, chart?, history?, onStatus?, onError?, onBars?, fetch?, WebSocket?, env? }?): LiveHandle
```

Loads history into `series`, then streams from the exchange and hands the changed bars to `series.update()` once per frame. `symbol` defaults to `'BTC-USD'`, `interval` to `'1m'` (`'1m' | '5m' | '15m' | '1h' | '6h' | '1d'`), `provider` to `'coinbase'` (a name is tried first with the other built-ins after it when its history fails; a provider object is used alone), `history` to 500 (10 to 5000). `volumeSeries` gets each bar's volume; with `chart`, older history loads at the left edge. Never throws into the page.

```js
const live = connectLive(candles, { symbol: 'BTC-USD', interval: '1m', volumeSeries: volume, chart });
```

### `live.setInterval`

```sig
status(): 'connecting' | 'live' | 'reconnecting' | 'offline' | 'error'
provider(): string | null
symbol(): string
interval(): LiveInterval
setInterval(interval: LiveInterval): void
setSymbol(symbol: string): void
loadOlder(): Promise<number>
disconnect(): void
```

The handle. `setInterval` and `setSymbol` reload and resubscribe (an unknown interval, the current value or an empty symbol is ignored); `loadOlder` resolves to the bars added (0 at the start of the data or without paging); `disconnect` closes the stream, aborts requests and removes every timer and listener.

```js
live.setInterval('5m');
```

### `LiveProvider`

```sig
interface LiveProvider {
  id: string; intervals: readonly LiveInterval[]; canPageBack: boolean;
  history(symbol, interval, { limit, before? }, { fetch, WebSocket, signal }): Promise<LiveBar[]>;
  subscribe(symbol, interval, { tick, open, closed }, { fetch, WebSocket }): () => void;
}
```

A source of bars, for any market. `history` returns bars in ascending time (`LiveBar` is `{ time, open, high, low, close, volume }`, `time` the bucket start in UNIX seconds); `subscribe` returns a function that closes the stream and must not call `closed` after it. `tick` takes `{ kind: 'trade', time, price, size, id? }` or `{ kind: 'bar', bar, closed }`.

```js
connectLive(candles, { provider: myExchange });
```

### `coinbase`, `binance`, `kraken`

```sig
const coinbase: LiveProvider; const binance: LiveProvider; const kraken: LiveProvider
const PROVIDERS: { coinbase, binance, kraken }
const INTERVAL_SECONDS: { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1d': 86400 }
binanceSymbol(symbol): string          // 'BTC-USD' -> 'BTCUSDT'
krakenSymbols(symbol): { rest, ws }    // 'BTC-USD' -> { rest: 'XBTUSD', ws: 'BTC/USD' }
```

The built-in providers, keyless and public. Kraken has no `'6h'` and cannot page back. Pure parsers of each exchange's messages are exported too: `parseCoinbaseCandles`, `parseCoinbaseMessage`, `parseBinanceKlines`, `parseBinanceMessage`, `parseKrakenOHLC`, `parseKrakenMessage`.

```js
connectLive(candles, { provider: coinbase });   // Coinbase alone, no fallback
```

### `BarBuilder`, `backoffMs`

```sig
new BarBuilder(intervalSeconds, last?)   // apply(tick): LiveBar | null, bucket(time), last
backoffMs(attempt, rand): number
```

The pure parts of the stream: folding trades into bars (late trades dropped, a repeated id counted once, whole bars replacing their time) and the reconnect wait (1 s doubling to 30 s, varied by up to 30%). Types: `LiveHandle`, `LiveOptions`, `LiveStatus`, `LiveEnv`, `ProviderName`, `HistoryRange`, `LiveBar`, `LiveInterval`, `LiveProvider`, `LiveTick`, `ProviderDeps`, `StreamHandlers`.

```js
const b = new BarBuilder(60); b.apply({ kind: 'trade', time: 1700000000, price: 100, size: 1 });
```

## Element

From `@mrchartist/chartist-lite/element`. Attributes, events and data formats: [Embedding the chart](embedding.md).

### `defineChartistElement`

```sig
defineChartistElement(tagName = 'chartist-chart'): CustomElementConstructor | null
```

Registers the element and returns its class, or `null` where there is no DOM. Importing the module registers nothing; calling it again for the same tag is harmless. The script-tag file calls it on load.

```js
defineChartistElement('price-chart');
```

### Element parsing helpers

```sig
parseElementConfig(get), parseRows(text), canonicalRows(input), shapeRowsForType(rows, type), volumeRows(rows), splitCsv(text), parseTime(value, where?), DEFAULT_HEIGHT
```

Pure helpers the element uses to read its attributes and JSON or CSV data, exported mainly for tests. Types: `ElementConfig`, `Row`, `SeriesTypeName`, `ChartistReadyDetail` (`{ chart }`), `ChartistErrorDetail` (`{ message, error }`). Exact edge cases are in `src/element/parse.ts`.

```js
const rows = parseRows('time,value\n2024-01-01,100');
```

### Live attributes

```sig
<chartist-chart live symbol="BTC-USD" interval="1m" provider="coinbase" volume>
```

With the element-live build, `live` streams from a public exchange feed instead of reading `src` or inline data. `symbol` (default `BTC-USD`), `interval` (`1m` default, `5m`, `15m`, `1h`, `6h`, `1d`) and `provider` (`coinbase` default, `binance`, `kraken`) are passed to `connectLive`; `volume` adds a volume histogram. A dot and a word show the status on the plot. Changing `symbol` or `interval` switches the stream; `provider`, `type` or `volume` start again. In the plain element build, `live` shows a line saying the element-live build is needed. `setElementLive(connect)` is how that build plugs the connector in.

```html
<script src="chartist-lite.element-live.iife.min.js"></script>
<chartist-chart live symbol="ETH-USD" interval="5m" volume></chartist-chart>
```

## React

From `@mrchartist/chartist-lite/react`. Behaviour of updates: [Embedding the chart](embedding.md#3-react).

### `createChartistReact`

```sig
createChartistReact(React): { ChartistChart, useChartist }
```

Takes your React once, at module level, and returns the component and the hook. Component props: `options`, `series` (a list of `{ id?, type, data, options? }`), `onReady`, `onCrosshairMove`, `className`, `style`, `height` (default 360) and `ariaLabel`.

```js
export const { ChartistChart, useChartist } = createChartistReact(React);
```

### `useChartist`

```sig
useChartist(props): { containerRef, chart }
```

The same as a hook: attach `containerRef` to your own sized element.

```js
const { containerRef, chart } = useChartist({ series });
```

### `ChartController`

```sig
new ChartController(container, props, deps?)   // apply(props), destroy(), chart
```

The framework-free lifecycle behind the wrapper. Also exported: `deepEqual`, `diffData`, `planSeries`, `seriesKey`, `MAX_TAIL_UPDATES` (64), `DEFAULT_REACT_HEIGHT` (360), and the types `ChartProps`, `SeriesSpec` (also as `ChartistSeries`), `SeriesRow`, `ChartOptionsInput`, `ControllerDeps`, `DataChange`, `SeriesPlan`, `KeyedSeries`, `ReactLike`, `MouseEventParams`, `SeriesTypeName`.

```js
const controller = new ChartController(el, { series });
```

## Types

### Exported types

```sig
ChartApi, SeriesApi, TimeScaleApi, PriceScaleApi, PaneApi, MouseEventParams, MouseEventHandler, LogicalRangeChangeHandler, TimeRange, Point, AnySeriesDefinition, ChartOptions, DeepPartial, LocalizationOptions, CrosshairOptions, InteractionOptions, ChartTimeScaleOptions, AttributionOptions, ThemeName, ThemeColors, Time, BusinessDay, PriceScaleOptions, PriceScaleMode, ScaleMargins, LogicalRange
```

The interfaces and option types of the main entry. `Time` is `number | string | BusinessDay` (UNIX seconds, `'YYYY-MM-DD'`, or `{ year, month, day }` with month 1 to 12). `DeepPartial<T>` is a recursive `Partial` that leaves functions and arrays whole.

```ts
import type { ChartApi, Time } from '@mrchartist/chartist-lite';
```

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
