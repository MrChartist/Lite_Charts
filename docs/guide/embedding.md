---
title: Embedding the chart
description: Four ways to embed Chartist Lite: the chartist-chart web component, an ES module, React or an iframe, with attributes, data formats, events and lifecycle.
order: 2
related: getting-started, accessibility, api-reference
group: start
task: Put it on any page
summary: The element, an ES module, React or an iframe: attributes, data formats and events.
---

# Embedding the chart

Four ways to put the chart on a page, from least to most code.

| You have | Use |
|---|---|
| Plain HTML, or a CMS block that accepts a script tag | 1. Script tag and `<chartist-chart>` |
| A bundler or `<script type="module">` | 2. ES module |
| A React app | 3. React |
| A site that does not allow scripts in its pages | 4. An iframe to a page you host |

> [!NOTE]
> The package is not yet published, so there is no CDN address: copy the `dist/` file you need next to your page, or serve it from your own site (see [Getting started](getting-started.md)).

## 1. Script tag and the web component

```html
<script src="chartist-lite.element.iife.min.js"></script>

<chartist-chart type="candlestick" theme="auto" src="/data/prices.json" height="360"
  time-zone="Asia/Kolkata" aria-label="Daily price"></chartist-chart>
```

Loading the script registers the tag `chartist-chart`. Script tag options: `data-tag="price-chart"` registers `<price-chart>` instead; `data-manual` registers nothing, and you call `ChartistLiteElement.defineChartistElement()` yourself.

### Where the data comes from

The first of these that exists is used:

1. the `.data` property: `el.data = [{ time: '2024-01-02', open: 10, high: 12, low: 9, close: 11 }, ...]`
2. the `src` attribute: a URL returning JSON or CSV, fetched with `fetch` (another site needs CORS headers; a page opened from `file://` may be blocked from fetching local files, so use inline data there)
3. a child script holding the data:

```html live
<chartist-chart type="area" height="300" aria-label="Weekly values, sample data">
  <script type="application/json">
    [{"time":"2024-01-01","value":100},
    {"time":"2024-01-08","value":103.5},
    {"time":"2024-01-15","value":102.1},
    {"time":"2024-01-22","value":105.8},
    {"time":"2024-01-29","value":104.2},
    {"time":"2024-02-05","value":108.9},
    {"time":"2024-02-12","value":107.4},
    {"time":"2024-02-19","value":111.2},
    {"time":"2024-02-26","value":109.6},
    {"time":"2024-03-04","value":113.4},
    {"time":"2024-03-11","value":116.0},
    {"time":"2024-03-18","value":114.1},
    {"time":"2024-03-25","value":118.7},
    {"time":"2024-04-01","value":117.2},
    {"time":"2024-04-08","value":120.7}]
  </script>
</chartist-chart>
```

The block above is not a picture: it is the markup itself, running on this page.

(`<script type="text/csv">` works the same way.)

**JSON**: an array of rows, or an object with the array under `data` or `rows`.

**CSV**: a header row, then one row per bar. Columns `time,open,high,low,close,volume` or `time,value`. Header names are not case sensitive; `date`, `o`, `h`, `l`, `c`, `vol` are accepted as short forms. Comma, semicolon or tab separators, quoted fields, a byte order mark and CRLF line ends are fine. An empty value makes a gap row.

**Times**: `2024-01-02` (a date), UNIX seconds, or an ISO date and time such as `2024-01-02T09:15:00` (read as UTC; add an offset such as `+05:30` to say otherwise). Numbers above 1e11 are taken as milliseconds. Rows out of order are sorted. A candlestick or bar needs open, high, low and close; the other types read `value` (or `close`).

### Attributes

| Attribute | Values | Default |
|---|---|---|
| `type` | `candlestick`, `line`, `area`, `bar`, `histogram`, `baseline` | `candlestick` |
| `theme` | `light`, `dark`, `auto` (follows the visitor's system setting) | `auto` |
| `height` | a number (px) or a CSS length such as `50vh` | `360` |
| `time-zone` | an IANA zone such as `America/New_York`, or `local` | `UTC` |
| `volume` | present: add a volume histogram from the `volume` column | off |
| `attribution` | `false` hides the small attribution link | shown |
| `src` | URL of JSON or CSV | none |
| `loading` | `eager` creates the chart at once; otherwise it is created when it scrolls near the viewport | lazy |
| `aria-label` | the chart's accessible name | "Price chart" |

Changing an attribute on a live element updates the chart in place; changing `src` loads again. The element is `display: block` with the width of its container; a CSS rule on the page (`chartist-chart { height: 480px }`) wins over the `height` attribute.

### Events and the JavaScript handle

```js
const el = document.querySelector('chartist-chart');
el.addEventListener('chartist-ready', e => { e.detail.chart; });      // the chart API, once drawn
el.addEventListener('chartist-error', e => { e.detail.message; });    // load or data problem
el.chart;     // the chart API, or null before creation and while removed from the page
el.series;    // the main series API
```

On an error the element shows one quiet line at the bottom and fires `chartist-error`; it does not throw.

### Lifecycle

The chart is created when the element first comes within 200 px of the viewport (`IntersectionObserver`; without it the chart is created at once). When the element is removed from the page, the chart, its observers and any request in flight are released; adding the element back creates a new chart from the same data.

### Text for search engines and screen readers

A canvas has no text for a crawler. Put the facts inside the element as ordinary content; it shows until the chart draws, then hides (the chart has its own accessible name and keyboard control). See [Accessibility](accessibility.md).

```html
<chartist-chart type="line" src="/data/weekly.csv" aria-label="Weekly values">
  <table>
    <caption>Weekly values, sample data</caption>
    <tr><th>Week of</th><th>Value</th></tr>
    <tr><td>2024-01-01</td><td>100.00</td></tr>
    <tr><td>2024-03-18</td><td>120.70</td></tr>
  </table>
</chartist-chart>
```

This content stays in the page source and shows for visitors without JavaScript (the element is then an unknown tag). A `<noscript>` block is not needed. The data script is hidden by the browser and is not a substitute for visible text.

### Strict Content-Security-Policy, hostile page CSS, right-to-left pages

- **CSP.** Nothing needs `'unsafe-inline'`: the chart writes its styles through the CSSOM (`style.setProperty`), and `<chartist-chart>` adopts a constructable stylesheet into its shadow root and sets `height` on itself through the CSSOM. A page with `style-src 'self'; script-src 'self'` works (checked in Chromium, `examples/hostile/`). Browsers without constructable stylesheets (Safari before 16.4) fall back to a `<style>` element, which such a policy blocks. Scripts: load the library from a file, not an inline script.
- **Page CSS.** Every element the chart creates resets margin, padding, border, sizing, max-width and the like with important inline values, so rules such as `div { padding: 1em }` or `canvas { width: 100% !important }` do not reach it; the attribution link lives in a closed shadow root, so `a {}` and `a::after {}` rules cannot touch it.
- **Right-to-left.** The chart root is `dir="ltr"` and the canvases draw left to right, so axis labels keep their spacing on an RTL page.
- **`.data` wins.** Setting `.data` while a `src` request is still loading aborts the request; the rows you set stay.

## 2. ES module

```html
<script type="module">
  import { defineChartistElement } from '@mrchartist/chartist-lite/element';
  defineChartistElement();
</script>

<chartist-chart type="line" src="data/weekly.csv" height="300"></chartist-chart>
```

`defineChartistElement(tagName = 'chartist-chart')` registers the element and returns its class, or `null` where there is no DOM (for example while rendering on a server). Importing the module registers nothing, so calling it is yours to do, once; calling it again for the same tag is harmless. Without the element, `createChart(container, options)` from the main entry is the plain API.

## 3. React

React is an optional peer dependency (18 or later). The wrapper does not import React; you give it yours once, at module level:

```jsx
import * as React from 'react';
import { createChartistReact } from '@mrchartist/chartist-lite/react';

export const { ChartistChart, useChartist } = createChartistReact(React);
```

Props: `options` (chart options), `series` (a list of `{ id?, type, data, options? }`, where `type` is a name or a series definition such as `CandlestickSeries`), `onReady`, `onCrosshairMove`, `className`, `style`, `height` (number or CSS length, default 360) and `ariaLabel`.

How updates behave:

- The chart is created once per mount and removed on unmount. A new `data` array with the same rows does nothing.
- If the rows are the same except for the last bar (and up to 64 newer bars), only those rows go to `update`. Any other change, such as an earlier bar or a shorter array, calls `setData`. Treat the arrays as immutable: changing an array in place is not seen.
- Changed `options` are applied with `applyOptions`, which is a merge: removing a key does not reset it; set the value.
- Series are matched by `id`, else by position. A changed `type` removes and adds the series.
- `onReady` is called once per live chart, after the first commit. Under `StrictMode` the throwaway first mount is removed before it would be announced.
- On the server the component renders an empty `div` of the given size; the chart starts in an effect.

`useChartist(props)` is the same thing as a hook: it returns `{ containerRef, chart }`; attach `containerRef` to your own sized element.

## 4. An iframe, for sites that forbid scripts

If the host site only allows an `<iframe>`, host a small page yourself that loads the script of way 1 and builds a `<chartist-chart>`, and embed that:

```html
<iframe title="Weekly values" loading="lazy"
  src="https://charts.example.com/frame.html?src=data/weekly.csv&type=line&theme=auto"
  style="width:100%;height:340px;border:0"></iframe>
```

The repository's `examples/frame.html` is such a page; it reads `src`, `type`, `theme`, `time-zone`, `volume` and `aria-label` from the query string and accepts a `src` only from its own origin. Give the iframe a `title` so screen readers can name it, and put a text summary in the host page for search engines, since an iframe's content is not part of that page. If the host sets a `Content-Security-Policy`, it must allow your frame page in `frame-src`.

## What was tested

In Chromium: the four ways as example pages in light and dark; lazy creation; removing and re-adding an element twelve times; attribute changes; a missing `src`; React updates without re-creation; React under `StrictMode` including unmount; React server rendering with `react-dom/server`; a page with `style-src 'self'`, right-to-left text and hostile global CSS (`scripts/screenshots-review.cjs`); the focus ring inside the element; `.data` over a slow `src`; no console errors. Not tested: Firefox, Safari, real touch devices, a page with JavaScript off (the fallback content rule follows from how browsers treat unknown tags), any specific CMS, styling through `::part(frame)`, and React 18 (only React 19 was run).

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
