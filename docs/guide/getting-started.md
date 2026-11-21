---
title: Getting started
description: Put a candlestick chart on a page with Chartist Lite three ways: a script tag with the chartist-chart element, an ES module with createChart, or React.
order: 1
related: series-types, theming, api-reference
---

# Getting started

Chartist Lite draws a financial chart on one canvas. This page gets a chart on screen in three ways: a script tag with a custom element (no build step), an ES module, and React.

## Status and install

Version 0.1.0. The package is **not yet published to npm**, so `npm install @mrchartist/chartist-lite` does not work today. Until it is published, build it from source and host the files yourself:

```bash
cd packages/chartist-lite
npm install
npm run build
```

`dist/` then holds everything you ship: `chartist-lite.iife.min.js` (global `ChartistLite`), `chartist-lite.element.iife.min.js` (registers `<chartist-chart>`), `chartist-lite-indicators.iife.min.js` (global `ChartistLiteIndicators`) and ES modules for each entry. Copy the file you need next to your page or serve it from your own site. Once the package is published, the same entries are available as `@mrchartist/chartist-lite`, `@mrchartist/chartist-lite/indicators`, `@mrchartist/chartist-lite/element` and `@mrchartist/chartist-lite/react`.

The package has no runtime dependencies. React is an optional peer dependency, used only by the `react` entry.

## 1. Script tag and the chartist-chart element

The shortest path. Load one script, then use the tag anywhere in the page:

```html
<script src="chartist-lite.element.iife.min.js"></script>

<chartist-chart type="candlestick" theme="auto" src="/data/prices.json" height="360"
  time-zone="Asia/Kolkata" aria-label="Daily price"></chartist-chart>
```

Loading the script registers the tag `chartist-chart`. The data comes from a `src` URL (JSON or CSV), a `.data` property, or a child `<script type="application/json">`. The chart is created when the element nears the viewport, so a page with many charts stays light. The full list of attributes, events and the data formats is in `docs/EMBEDDING.md` in the repository and summarised in [Accessibility](accessibility.md) (fallback content) and the [API reference](api-reference.md).

## 2. ES module and createChart

If you use a bundler or `<script type="module">`, import what you need and create the chart yourself:

```js
import { createChart, CandlestickSeries, LineSeries } from '@mrchartist/chartist-lite';
import { sma } from '@mrchartist/chartist-lite/indicators';

const chart = createChart('chart', { theme: 'auto', ariaLabel: 'Daily price' });
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
const average = chart.addSeries(LineSeries, { title: 'SMA 20', lineWidth: 2 });

candles.setData(bars);          // [{ time: '2024-01-02', open, high, low, close }, ...]
average.setData(sma(bars, 20));
```

`createChart(container, options)` takes an element or an element id. The chart fills the container and follows its size, so give the container a height in CSS. Importing the module touches no DOM; everything starts at `createChart`.

With a plain script tag instead of a bundler, the core is the global `ChartistLite`:

```html
<div id="chart" style="height: 420px"></div>
<script src="chartist-lite.iife.min.js"></script>
<script>
  const { createChart, CandlestickSeries } = ChartistLite;
  const chart = createChart('chart', { theme: 'light' });
  chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
</script>
```

## 3. React

React is an optional peer dependency (18 or later). The wrapper does not import React; you pass your React to a factory once, at module level:

```jsx
import * as React from 'react';
import { createChartistReact } from '@mrchartist/chartist-lite/react';

export const { ChartistChart, useChartist } = createChartistReact(React);

function Price({ candles, average }) {
  return (
    <ChartistChart
      height={420}
      ariaLabel="Daily price"
      options={{ theme: 'auto' }}
      series={[
        { id: 'price', type: 'candlestick', data: candles },
        { id: 'sma', type: 'line', data: average, options: { lineWidth: 2 } },
      ]}
      onReady={chart => chart.timeScale().fitContent()}
    />
  );
}
```

The chart is created once per mount. When only the last bar of an array changes, only that bar goes to `update`; any other change calls `setData`. Treat the arrays as immutable.

## Your first data

A row is a time plus the fields of its series type. A candlestick needs `open`, `high`, `low` and `close`; a line, area, histogram or baseline needs `value`. A time is UNIX seconds (an instant), a `'YYYY-MM-DD'` string or a `{ year, month, day }` object (a date). Rows must be in ascending time order. See [Series types](series-types.md) and [Time and time zones](time-and-time-zones.md).

## Updating live

```js
candles.update({ time: '2024-06-14', open: 101.2, high: 102.9, low: 100.8, close: 102.4 });
```

`update` replaces the last bar when the time is the same and appends a bar when it is newer. It repaints only what is visible.

## Where to go next

- [Series types](series-types.md): candlestick, line, area, bar, histogram, baseline and their options.
- [Indicators](indicators.md): moving averages, RSI, MACD and others, as plain functions.
- [Panes and scales](panes-and-scales.md): volume, a second axis, a lower pane for RSI.
- [Theming](theming.md) and [Accessibility](accessibility.md).
- [API reference](api-reference.md).
