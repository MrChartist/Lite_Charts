# Chartist Lite

Chartist Lite is a small JavaScript library that draws financial charts (candlesticks, bars, lines, areas, histograms and baselines) on a single canvas, with built-in indicators, stacked panes and exchange time zones. It has no runtime dependencies and comes as an ES module, a React wrapper and a `<chartist-chart>` web component.

![A daily candlestick chart with a 20-bar moving average, drawn by Chartist Lite from demo data](docs/screenshots/basic-light.png)

**Status: version 0.1.0, not yet published to npm.** Build it from source for now (see Install). Chartist Lite is an independent project, written from scratch. It is not affiliated with TradingView or any other charting product, and it contains no code from other charting libraries. Licence: Apache-2.0.

## Install

Once published:

```bash
npm install @mrchartist/chartist-lite
```

The package is not published yet, so today you build it and host the files yourself:

```bash
cd packages/chartist-lite
npm install
npm run build        # writes dist/
```

Copy the file you need from `dist/` next to your page: `chartist-lite.element.iife.min.js` for the web component, `chartist-lite.iife.min.js` for the global `ChartistLite`, `chartist-lite-indicators.iife.min.js` for the global `ChartistLiteIndicators`, or the ES modules for a bundler.

## Quick start

### 1. Script tag and the web component

```html
<script src="chartist-lite.element.iife.min.js"></script>

<chartist-chart type="candlestick" theme="auto" src="/data/prices.json" height="360"
  time-zone="Asia/Kolkata" aria-label="Daily price"></chartist-chart>
```

The data can be a URL (JSON or CSV), an inline `<script type="application/json">` or a `.data` property. The chart is created when the element nears the viewport.

### 2. ES module

```js
import { createChart, CandlestickSeries, LineSeries } from '@mrchartist/chartist-lite';
import { sma } from '@mrchartist/chartist-lite/indicators';

const chart = createChart('chart', { theme: 'auto', ariaLabel: 'Daily price' });
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
const average = chart.addSeries(LineSeries, { title: 'SMA 20', lineWidth: 2 });

candles.setData(bars);          // [{ time: '2024-01-02', open, high, low, close }, ...]
average.setData(sma(bars, 20));
```

### 3. React

```jsx
import * as React from 'react';
import { createChartistReact } from '@mrchartist/chartist-lite/react';

export const { ChartistChart } = createChartistReact(React);

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
    />
  );
}
```

## Features

| | |
|---|---|
| Series types | Candlestick, OHLC bar, line, area, histogram, baseline |
| Indicators | 12 functions (SMA, EMA, WMA, VWAP, Bollinger bands, Donchian channel, Supertrend, RSI, MACD, stochastic, ATR, OBV), Heikin-Ashi, bar aggregation (every n bars, day, week, month), and incremental forms of SMA, EMA, RSI and MACD for live data |
| Panes | Stacked panes with their own price scales, a shared time axis and crosshair, a draggable and keyboard-reachable divider; overlay scales (for volume) and a left axis |
| Time zones | IANA zones for the time axis and crosshair, `'local'`, daylight saving handled; no slot for nights, weekends or holidays |
| Themes | Light, dark and auto (follows the system setting), colour overrides, system font stack, switch at runtime |
| Plugins | Price lines, series markers, and a primitive contract for your own overlays |
| Accessibility | Focusable chart with a name and spoken help, keyboard pan, zoom and bar-by-bar inspection through a live region, kinetic glide off under reduced motion, minimum text size 12 px. Tested in Chromium only; not tested with screen readers |
| Interaction | Wheel and pinch zoom, drag pan with kinetic glide, price axis stretch, double-click reset, crosshair modes |
| Embedding | `<chartist-chart>` element, ES module, React wrapper, or an iframe page |
| Size (gzip) | Core entry 26.5 KB, indicators entry 5.1 KB, element entry 31.0 KB, React entry 28.1 KB. The core has a 45 KB budget that `npm run size` enforces |
| Speed | One recorded measurement, in Chromium at 1200 by 600 and device pixel ratio 1, with 100000 one-minute bars: setting the data, fitting the view and the first paint took about 35 to 41 ms, and pan frames with 2000 bars in view took a median of 1.4 to 1.5 ms. The machine is not recorded, so treat it as an order of magnitude and measure on your own hardware (`ARCHITECTURE.md`, `scripts/screenshots.cjs`) |

The sizes are bundled, minified and gzipped by `npm run size` (esbuild, gzip level 9), measured on the 0.1.0 working tree. Run `npm run build && npm run size` for the current numbers. Dependencies: none at runtime. React is an optional peer dependency used only by the `react` entry.

## What it is not

- **No drawing tools.** No trend lines, Fibonacci tools or text notes. You can draw your own marks with a primitive, but there is no editing interface.
- **No data feed.** You give it rows. It never fetches prices by itself (the web component can load a JSON or CSV file you point it at).
- **No order placement** and no trading features.
- It does not detect patterns or generate signals. Markers show what you give them.

## Browser support

Tested in Chromium (driven by Playwright): the example pages draw, with no console errors, in light and dark. Firefox, Safari and mobile browsers: Needs verification. The library uses the canvas 2D API and `ResizeObserver`; the web component also uses custom elements and `IntersectionObserver` (it falls back to creating the chart at once without the latter).

## How it differs in approach

- **An exchange-aware time axis.** The axis is one shared list of the times your series have, so there is no gap for a night, weekend or holiday. Ticks sit on real calendar boundaries read from your bars, and labels are read in an IANA time zone, daylight saving included.
- **A true minus sign.** Negative numbers are written with U+2212 (`−2.35`), not a hyphen.
- **No grouping commas by default.** Prices read `12345.60`. Set `localization.priceFormatter` if you want grouping.
- **Indicators are built in,** as a separate, tree-shakeable entry of plain functions from rows to series data, with incremental forms for live ticks.
- **A custom element.** One script tag and one HTML tag give you a chart, with fallback content that crawlers and screen readers can read.
- **Calm defaults.** System fonts, Apple-style system colours with no purple, text never below 12 px, tabular figures on the axes.

The way you create a chart and add series (`createChart`, `addSeries`, `setData` and `update`) will feel familiar on purpose. The code is written from scratch; `PROVENANCE.md` lists where each part came from.

## Attribution

By default a small "Chartist" link to https://mrchartist.com is drawn at the bottom left of the chart. It is an option: `attribution: false` hides it (on the element, `attribution="false"`), and `attribution: { position: 'bottom-right' }` moves it. Keeping it is appreciated.

## Documentation

- [Getting started](docs/guide/getting-started.md)
- [Embedding the chart](docs/guide/embedding.md): element, ES module, React, iframe
- [Series types](docs/guide/series-types.md)
- [Indicators](docs/guide/indicators.md)
- [Panes and scales](docs/guide/panes-and-scales.md)
- [Time and time zones](docs/guide/time-and-time-zones.md)
- [Theming](docs/guide/theming.md)
- [Plugins and primitives](docs/guide/plugins.md)
- [Accessibility](docs/guide/accessibility.md)
- [API reference](docs/guide/api-reference.md)

A static documentation site with live charts is built from these files: `npm run build && npm run site`, then open `site/dist/index.html`. For contributors: `ARCHITECTURE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`. Copyright 2026 Mr. Chartist, https://mrchartist.com.
