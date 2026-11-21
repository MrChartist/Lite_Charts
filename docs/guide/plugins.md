---
title: Plugins and primitives
description: Price lines, series markers and custom primitives in Chartist Lite: draw your own levels, signals and overlays on the chart canvas.
order: 8
related: series-types, panes-and-scales, api-reference
---

# Plugins: price lines, markers and custom primitives

Chartist Lite has no drawing tools. What it has are three small building blocks for putting your own marks on a chart: price lines, series markers, and the primitive contract that both are built from.

## Price lines

A horizontal line at a fixed price, with a tag on the price axis and an optional title.

```js
import { createPriceLine } from '@mrchartist/chartist-lite';

const resistance = createPriceLine(candles, {
  price: 152.4, title: 'Resistance', lineStyle: 'dashed',
});
resistance.applyOptions({ color: '#B25000' });
resistance.remove();
```

`createPriceLine(series, options)` takes any series (or pane) handle and returns `{ applyOptions, options, remove }`. The price maps through that series' scale.

| Option | Meaning |
|---|---|
| `price` | Required, a finite number |
| `color` | CSS colour; defaults to the theme's line colour |
| `lineWidth` | CSS px, default 1 |
| `lineStyle` | `'solid'`, `'dashed'` (default) or `'dotted'` |
| `title` | Text at the right end of the line on the plot; default none |
| `axisLabelVisible` | Tag with the price on the axis; default true |

A bad value throws a `TypeError` that names the field.

## Series markers

Small shapes with optional short text, placed above, below or inside a bar.

```js
import { createSeriesMarkers } from '@mrchartist/chartist-lite';

const markers = createSeriesMarkers(candles, [
  { time: '2024-03-04', position: 'belowBar', shape: 'arrowUp', text: 'Buy' },
  { time: '2024-03-11', position: 'aboveBar', shape: 'arrowDown', text: 'Sell' },
]);
markers.setMarkers([]);   // replace all markers
markers.remove();
```

`createSeriesMarkers(series, markers?)` returns `{ setMarkers, markers, remove }`.

| Field | Values |
|---|---|
| `time` | The bar's time as given in the data |
| `position` | `'aboveBar'`, `'belowBar'` or `'inBar'` |
| `shape` | `'arrowUp'`, `'arrowDown'`, `'circle'` or `'square'` |
| `color` | CSS colour. Arrows default to the theme's up and down colours; circle and square to its line colour |
| `text` | Short label; at most 16 characters, longer text is cut with an ellipsis |
| `size` | Multiplier on the base size of 10 CSS px: 0.5 to 4, default 1 |

Markers on one bar stack outward and never overlap the bar or each other. Only markers whose bar is on screen are drawn. A marker is a signal you supply: the library draws what you give it and does not detect patterns or generate signals.

## Custom primitives

A primitive is a plain object that draws on a pane. Attach it to a series (`series.attachPrimitive(p)`, prices then map through that series' scale) or to a pane (`chart.attachPrimitive(p)` for the top pane, or `chart.panes()[i].attachPrimitive(p)`; the scale is `p.priceScaleId ?? 'right'`).

```js
const band = {
  zOrder: 'bottom',
  attached(host) { this.host = host; },
  detached() { this.host = null; },
  autoscale: () => ({ min: 95, max: 105 }),
  draw(s) {
    const top = s.priceToY(105), bottom = s.priceToY(95);
    if (top === null || bottom === null) return;
    s.ctx.fillStyle = 'rgba(0, 102, 204, 0.08)';
    s.ctx.fillRect(s.pane.x, top, s.pane.width, bottom - top);
  },
};
candles.attachPrimitive(band);
// later: band.host.requestUpdate() after changing its state; candles.detachPrimitive(band)
```

All hooks are optional:

| Hook | When |
|---|---|
| `attached(host)` | On attach. Keep `host.requestUpdate` and call it when your own state changes |
| `detached()` | On detach |
| `zOrder` | `'bottom'` (under the series), `'normal'` (with them, the default) or `'top'` |
| `draw(scope)` | Main layer, repainted when data, scales or options change. CSS pixels, transform set, clipped to the pane |
| `drawOverlay(scope)` | Overlay layer, repainted on every crosshair move; keep it cheap. The scope adds `crosshair` |
| `priceAxisLabels(colors)` | Tags on the price axis |
| `autoscale(range)` | Extra price range autoscale must include for the visible logical range |
| `priceScaleId` | Pane primitives only: the overlay scale whose prices `priceToY` maps |

The draw scope gives `ctx`, `pixelRatio`, `pane` (a CSS rectangle), `colors`, `fontFamily`, `fontSize`, `visibleLogicalRange`, `timeToX(time)`, `logicalToX(logical)`, `priceToY(price)`, `text(...)`, `measureText(...)` and `formatPrice(price)`. `text` draws with tabular figures. Prefer `s.colors` over hard-coded colours so a theme switch recolours your drawing.

Price lines and markers are made from exactly this contract, so reading `src/plugins/price-line.ts` and `src/plugins/markers.ts` is the best worked example.

## Things this library does not do

No trend lines, Fibonacci tools, text notes or other interactive drawing tools, no saved drawings, and no order placement. A primitive can draw anything you compute, but there is no built-in editing UI. The hover callbacks (`subscribeCrosshairMove`, `subscribeClick`) give you the time, the point and the rows under the pointer if you want to build one.
