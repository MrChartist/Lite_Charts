---
title: Panes and scales
description: Stack panes under the price chart for RSI or MACD, put volume on an overlay scale, add a left axis, and pick linear, log or percent scales in Chartist Lite.
order: 5
related: indicators, series-types, plugins
group: build
task: Stack RSI under the price
summary: Panes, overlay scales for volume, a left axis, and log or percent modes.
---

# Panes and scales

A chart has one or more **panes** stacked vertically above one shared time axis, and each pane has its own **price scales**. This is how you put RSI under the price, volume at the bottom of the price pane, or a second instrument on its own axis.

## Panes

The third argument of `addSeries` is the pane index. The default, 0, is the top pane. An index past the last pane adds a new pane:

```js live height=420
const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });                 // pane 0
candles.setData(bars);
const rsiLine = chart.addSeries(LineSeries, { title: 'RSI 14' }, 1);                   // pane 1, created now
rsiLine.setData(rsi(bars, 14));
```

Drag the line between the two panes, or tab to it and press Up or Down.

What panes share, and what they do not:

- **Shared:** the time axis (drawn once, at the bottom), the plot's left and right edges (bars line up across panes) and the crosshair's vertical line, which runs through every pane. The horizontal crosshair line is drawn in the pane under the pointer.
- **Separate:** price scales. Each pane owns its `'right'` scale, its `'left'` scale and any overlay scales, and autoscales them over the visible bars of its own series.

The top pane always exists. A lower pane is removed when its last series is removed or moved away, and later panes move up. Move a series with `series.moveToPane(i)`; `series.paneIndex()` tells you where it is.

### Sizes and the divider

Panes share the height left after the time axis in proportion to their **stretch factors**: the top pane starts at 3 and a new pane at 1, so a second pane gets about a quarter of the height. Heights are whole CSS pixels, there is a 1 px separator line between panes, and no pane is shorter than 32 px when they all fit.

```js
const [price, lower] = chart.panes();
lower.setStretchFactor(2);          // a larger share
lower.setHeight(160);               // or ask for 160 CSS px; the other panes keep their proportions
price.getHeight();                  // CSS px as laid out now
lower.getSeries();                  // the series handles in that pane
```

`setHeight` has no effect while there is only one pane.

Between two panes sits a divider. Drag it with the mouse or a finger, or focus it and press Up or Down to move it by 8 CSS px (40 with Shift). The divider is a focusable element with `role="separator"` and the label "Resize panes". The heights you set by dragging become the stretch factors, so the proportions survive a window resize.

### Primitives on a pane

`chart.attachPrimitive(p)` attaches to the top pane; for another pane use `chart.panes()[i].attachPrimitive(p)`. Price lines take any series, so a price line made for the RSI series lands in the RSI pane:

```js
createPriceLine(rsiLine, { price: 70, lineStyle: 'dotted' });
createPriceLine(rsiLine, { price: 30, lineStyle: 'dotted' });
```

## Price scales

Each series uses the scale named by its `priceScaleId` option, in its own pane:

| Id | Meaning |
|---|---|
| `'right'` (default) | The drawn axis on the right |
| `'left'` | The drawn axis on the left. It appears only while a series uses it |
| any other id | An **overlay** scale: its own range and margins, not drawn |

Get a scale with `chart.priceScale(id, paneIndex)` (defaults `'right'` and pane 0), `pane.priceScale(id)` or `series.priceScale()`, and change it with `applyOptions`:

```js
chart.priceScale('right').applyOptions({ mode: 'log' });
chart.applyOptions({ rightPriceScale: { scaleMargins: { top: 0.2, bottom: 0.1 } } });
```

An axis side takes width only while some pane shows that side. The widest label of any pane sets the width, with 8 px of hysteresis so a pan does not make it jitter.

### Modes, margins and autoscale

- **`mode`:** `'linear'` (the default), `'log'` (prices at or below zero cannot be shown) or `'percent'`, which shows the change in percent from the value of the first visible bar of the first series on that scale. Percent labels are signed: `+1.50%`, `−2.00%`.
- **`scaleMargins`:** `{ top, bottom }`, the share of the pane height left empty above the highest and below the lowest visible value. Defaults 0.1 and 0.1.
- **`autoScale`:** fit the visible data on every repaint (the default). Dragging the price axis stretches the scale and turns autoscale off; double-clicking the chart resets the view and turns it back on.
- **`visible`:** draw this scale's axis. Overlay scales are never drawn.

Two lines on one scale, switchable between the three modes. In percent mode both start from the first visible bar, so they compare directly:

```js live height=320 controls=scale
const chart = createChart('chart');
chart.addSeries(LineSeries, { title: 'DEMO', lineWidth: 2 })
  .setData(bars.map(b => ({ time: b.time, value: b.close })));
chart.addSeries(LineSeries, { title: 'Benchmark', lineWidth: 2, color: '#FF9F0A' })
  .setData(benchmark);   // a second instrument, as { time, value } rows
```

### Volume on an overlay scale

Volume shares the price pane without squeezing the price range if it sits on its own overlay scale with a large top margin:

```js
const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', title: 'Volume' });
chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
volume.setData(bars.map(b => ({ time: b.time, value: b.volume })));
```

### A second instrument on the left axis

A series with `priceScaleId: 'left'` is read on the left axis, with its own range. This suits a benchmark whose values are in a different range than the price:

```js
chart.addSeries(LineSeries, { priceScaleId: 'left', title: 'Benchmark' }).setData(benchmark);
```

The left axis belongs to the top pane's `leftPriceScale` options (`chart.applyOptions({ leftPriceScale: { ... } })`).

## Coordinates

The coordinates in the public API are relative to a pane:

- `timeScale().timeToCoordinate(time)` and `logicalToCoordinate` give x from the plot's left edge.
- `series.priceToCoordinate(price)` gives y from the top of that series' pane.
- In a crosshair or click event, `params.point` is relative to the pane under the pointer, and `params.paneIndex` says which pane (0 is the top).

Primitives and custom series renderers receive chart (canvas) coordinates instead; their scopes already include the plot and pane offsets. With one pane and no left axis the two are the same.

## Linking several charts

If you use separate charts instead of panes (for example in different containers), you can keep their views in step with `timeScale().subscribeVisibleLogicalRangeChange` and `setVisibleLogicalRange`. Panes do this for you, and also share the crosshair, so prefer them when the charts belong together.

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
