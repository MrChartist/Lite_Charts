---
title: Series types
description: The six Chartist Lite series types (candlestick, line, area, bar, histogram, baseline): data rows, options and a short example for each.
order: 3
related: indicators, panes-and-scales, plugins
group: build
task: Choose how prices look
summary: Candlestick, bars, line, area, histogram and baseline, with their rows and options.
---

# Series types

A chart holds any number of series. You add one with `chart.addSeries(definition, options?, paneIndex?)`, which returns a handle with `setData`, `update`, `applyOptions` and more. There are six built-in definitions, all exported from the main entry.

| Definition | Row | Draws |
|---|---|---|
| `CandlestickSeries` | `{ time, open, high, low, close }` | Candles with wicks |
| `BarSeries` | `{ time, open, high, low, close }` | OHLC bars |
| `LineSeries` | `{ time, value }` | A line |
| `AreaSeries` | `{ time, value }` | A line with a fill below it |
| `HistogramSeries` | `{ time, value, color? }` | Columns from a base value |
| `BaselineSeries` | `{ time, value }` | A line split around a base value, filled in two colours |

Every row also accepts a time-only row `{ time }`. That is a whitespace row: it takes a slot on the time axis and draws nothing. Indicator functions return such rows for their warm-up bars so that series stay aligned.

## Options every series has

These are the common options, available on every type:

| Option | Meaning |
|---|---|
| `priceScaleId` | `'right'` (the drawn axis), `'left'`, or any other id for an overlay scale with its own range and margins that is not drawn |
| `visible` | Show or hide the series |
| `lastValueVisible` | Tag with the last value on the price axis |
| `priceLineVisible` | Dotted horizontal line at the last value |
| `priceFormat` | `{ precision, minMove }`: decimals shown (default 2) and the smallest price step (default 10 to the power of minus precision) |
| `title` | Short name, shown in the built-in legend and read in the accessible description. A series without a title stays out of the legend |

## Candlestick

```js live height=280
const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);   // [{ time: '2024-01-02', open: 100, high: 104, low: 99, close: 103 }, ...]
```

Options: `upColor`, `downColor` (default to the theme's up and down colours, so a theme switch recolours the series), `wickVisible` (default true), `wickUpColor`, `wickDownColor`.

A row whose `high` and `low` do not contain its `open` and `close` is repaired (high becomes the largest of the four, low the smallest) instead of rejected. A non-finite value throws a `TypeError` that names the field.

When bars are closer than 3 device pixels they fold into one-pixel columns, so a zoomed-out chart costs one rectangle per pixel column, not one per bar.

## Bar

OHLC bars: a vertical stem from low to high, an open tick on the left and a close tick on the right.

```js live height=280
const chart = createChart('chart');
chart.addSeries(BarSeries, { title: 'DEMO' }).setData(bars);
```

Options: `upColor`, `downColor`, `openVisible` (default true) and `thinBars` (default true: a one-device-pixel stem when bars are narrow, under 8 CSS px apart).

## Line

```js live height=280
const chart = createChart('chart');
const line = chart.addSeries(LineSeries, { title: 'Close', lineWidth: 2, lineType: 'step' });
line.setData(bars.map(b => ({ time: b.time, value: b.close })));
```

Options: `color` (defaults to the theme's line colour), `lineWidth` (CSS px, default 2), `lineStyle` (`'solid'`, `'dashed'` or `'dotted'`), `lineType` (`'simple'` joins points directly, `'step'` holds each value until the next bar), `crosshairMarkerVisible` (a dot on the hovered value, default true).

## Area

A line with a fill under it. Options: `lineColor`, `lineWidth`, `topColor` (fill colour at the top; defaults to the line colour at 24% opacity), `bottomColor` (fill colour at the pane bottom; defaults to the line colour fully transparent), `crosshairMarkerVisible`. When you set neither fill colour, the default fill also passes through 8% opacity just over halfway down, so it fades sooner.

```js live height=280
const chart = createChart('chart');
chart.addSeries(AreaSeries, { title: 'Close' })
  .setData(bars.map(b => ({ time: b.time, value: b.close })));
```

## Histogram

Columns that grow from a base value. Options: `color` (defaults to the theme's quiet `volume` colour, so volume sits behind the price) and `base` (default 0). A row may carry its own `color`, which is how you colour volume by direction:

```js live height=360
const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', title: 'Volume' });
chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
volume.setData(bars.map(b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? '#248A3D' : '#D70015' })));
```

Putting the histogram on an overlay scale (any `priceScaleId` other than `'right'` and `'left'`) lets volume share the pane without squeezing the price range. See [Panes and scales](panes-and-scales.md).

## Baseline

A line split around `baseValue`: one colour above, another below, with a translucent fill between the line and the base. Options: `baseValue` (default 0), `upColor`, `downColor` (default to the theme), `lineWidth`, `fillOpacity` (0 to 1, default 0.18), `crosshairMarkerVisible`.

```js live height=280
const chart = createChart('chart');
chart.addSeries(BaselineSeries, { baseValue: 100, title: 'Close' })
  .setData(bars.map(b => ({ time: b.time, value: b.close })));
```

## Direction and colour

Up and down colours come from the theme (green and red in both themes). Marks use `up` and `down`; text, such as the change in the legend, uses the darker `upText` and `downText`, chosen for at least 4.5:1 on the background. A candle is drawn in the up colour when its close is at or above its open. Candles and bars carry direction in colour only, so if that matters for your readers, add text elsewhere on the page (a table, a legend, a data summary; see [Accessibility](accessibility.md)). Override colours per series with the options above or for the whole chart with the `colors` option; see [Theming](theming.md).

## Writing your own series type

A series type is one object implementing `SeriesDefinition`: `type`, `defaults`, `normalize`, `value`, `low`, `high`, `lastValueColor`, `draw`, and optionally `crosshairMarker`. `draw` receives device-pixel coordinates and only the visible rows. The contract is in `src/series/definition.ts`; the exported types are `SeriesDefinition`, `SeriesDrawScope`, `SeriesCommonOptions`, `RowBase`, `WhitespaceData`, `DeviceRect`, `PriceFormat`, `RowOf`, `OptionsOf` and `InputOf`. See the [API reference](api-reference.md). Writing a custom series is an advanced use that is described in the contributor notes (`ARCHITECTURE.md`) rather than here.

> [!VERIFY]
> Whether the custom series contract is a stable public API in 0.1.0 is not settled. Treat it as subject to change until the package is released.
