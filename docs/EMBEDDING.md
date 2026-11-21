# Embedding Chartist Lite

Four ways to put the chart on a page, from least to most code. Every snippet below is the same code as a page in
`examples/`, and `node scripts/screenshots-element.cjs` loads those pages in Chromium and checks that they draw.

| You have | Use | Example page |
|---|---|---|
| Plain HTML, a CMS block that accepts a script tag | 1. Script tag and `<chartist-chart>` | `examples/embed.html`, `examples/element.html` |
| A bundler or `<script type="module">` | 2. ES module | `examples/module.html` |
| A React app | 3. React | `examples/react/` |
| A site that does not allow scripts in its pages | 4. An iframe to a page you host | `examples/frame.html` |

All of them need the built files from this package to be hosted by you (the package is not published yet, so there
is no CDN address). Copy the `dist/` file you need next to your page, or serve it from your own site.

## 1. Script tag and element

```html
<script src="chartist-lite.element.iife.min.js"></script>

<chartist-chart type="candlestick" theme="auto" src="/data/prices.json" height="360"
  time-zone="Asia/Kolkata" aria-label="Daily price"></chartist-chart>
```

Loading the script registers the tag `chartist-chart`. The file is `dist/chartist-lite.element.iife.min.js`
(global `ChartistLiteElement`, about 31 KB gzip including the chart). Today it is built by
`node scripts/build-element-iife.mjs`, which has to run after `npm run build` because that command clears `dist/`.

Script tag options: `data-tag="price-chart"` registers `<price-chart>` instead; `data-manual` registers nothing, and
you call `ChartistLiteElement.defineChartistElement()` yourself.

### Where the data comes from

The first of these that exists is used:

1. the `.data` property: `el.data = [{ time: '2024-01-02', open: 10, high: 12, low: 9, close: 11 }, ...]`
2. the `src` attribute: a URL returning JSON or CSV (fetched with `fetch`, same rules as any `fetch`: another site
   needs CORS headers)
3. a child script holding the data:

```html
<chartist-chart type="line" height="320">
  <script type="application/json">
    [{"time":"2024-01-01","value":100},{"time":"2024-01-08","value":103.5}]
  </script>
</chartist-chart>
```

(`<script type="text/csv">` works the same way.) Setting `src` later replaces data set earlier through `.data`.

**JSON**: an array of rows, or an object with the array under `data` or `rows`.
**CSV**: a header row, then one row per bar. Columns `time,open,high,low,close,volume` or `time,value`. Header names
are not case sensitive; `date`, `o`, `h`, `l`, `c`, `vol` are accepted as short forms. Comma, semicolon or tab
separators, quoted fields, a byte order mark and CRLF line ends are fine. An empty value makes a gap row.

**Times**: `2024-01-02` (a date), UNIX seconds, or an ISO date and time such as `2024-01-02T09:15:00` (read as UTC;
add an offset such as `+05:30` to say otherwise). Numbers above 1e11 are taken as milliseconds. Rows out of order
are sorted. A candlestick or bar needs open, high, low and close; the other types read `value` (or `close`).

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

Changing an attribute on a live element updates the chart in place; changing `src` loads again. A type that the
core does not have yet (the area, bar, histogram and baseline types depend on the core build you have) shows the
error message below instead of drawing. `volume` is ignored while the histogram type is missing.

CSS: the element is `display: block` with the width of its container. Its height comes from the attribute, and a CSS
rule on the page (`chartist-chart { height: 480px }`) wins over it. The frame can be styled with
`chartist-chart::part(frame)`.

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

The chart is created when the element first comes within 200 px of the viewport (`IntersectionObserver`; without it
the chart is created at once). When the element is removed from the page the chart, its observers and any request in
flight are released; adding the element back creates a new chart from the same data.

### Search engines, crawlers and screen readers

A canvas has no text for a crawler. Put the facts in the element as ordinary content. The element shows it until the
chart draws, then hides it (the chart has its own accessible name and keyboard control):

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

This content stays in the page source and in the page for visitors without JavaScript (the element is then an
unknown tag, so the content shows as normal). A `<noscript>` block is not needed. The data script of the previous
section is hidden by the browser and is not a substitute for visible text.

## 2. ES module

```html
<script type="module">
  import { defineChartistElement } from '../dist/element.js';   // from a bundler: '@mrchartist/chartist-lite/element'
  defineChartistElement();
</script>

<chartist-chart type="line" src="data/demo-line.csv" height="300"></chartist-chart>
```

`defineChartistElement(tagName = 'chartist-chart')` registers the element and returns its class (or `null` where
there is no DOM, for example while rendering on a server). Importing the module registers nothing, so calling it is
yours to do, once. Calling it again for the same tag is harmless.

For code without the element, `createChart(container, options)` from the main entry is the plain API
(`examples/basic.html`).

## 3. React

React is an optional peer dependency (18 or 19). The wrapper does not import React; it is built from the React you
give it, once, at module level:

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
      onCrosshairMove={p => { /* p.time, p.seriesData */ }}
    />
  );
}
```

(`examples/react/app.jsx` is the tested page. Inside this repository it imports `../../src/react/index`.)

Props: `options` (chart options), `series` (list of `{ id?, type, data, options? }`, where `type` is a name or a
series definition such as `CandlestickSeries`), `onReady`, `onCrosshairMove`, `className`, `style`, `height`
(number or CSS length, default 360), `ariaLabel`.

How updates behave:

- The chart is created once per mount and removed on unmount. A new `data` array with the same rows does nothing.
- If the rows are the same except for the last bar (and up to 64 newer bars), only those rows go to `update`.
  Any other change, such as an earlier bar or a shorter array, calls `setData`. Treat the arrays as immutable:
  changing an array in place is not seen.
- Changed `options` are applied with `applyOptions` (a merge: removing a key does not reset it; set the value).
- Series are matched by `id`, else by position. A changed `type` removes and adds the series.
- `onReady` is called once per live chart, after the first commit. Under `StrictMode` the throwaway first mount is
  removed before it would be announced. `onCrosshairMove` may change every render.
- On the server the component renders an empty `div` of the given size; the chart starts in an effect.

`useChartist(props)` is the same thing as a hook: it returns `{ containerRef, chart }`; attach `containerRef` to
your own sized element.

Why the factory: the package's boundary test allows no import of another package from `src/`, so the React entry
cannot say `import 'react'`. Passing React in keeps one copy of React in the page.

## 4. An iframe, for sites that forbid scripts

If the host site only allows an `<iframe>` (some CMS products and email-like editors), host a small page yourself
and embed that:

```html
<iframe title="Weekly values" loading="lazy"
  src="https://charts.example.com/frame.html?src=data/demo-line.csv&type=line&theme=auto"
  style="width:100%;height:340px;border:0"></iframe>
```

`examples/frame.html` is that page: it loads the script of way 1 and builds a `<chartist-chart>` from the query
string (`src`, `type`, `theme`, `time-zone`, `volume`, `aria-label`). It accepts a `src` only from its own origin.
Put the data files on the same site as the frame page. The host page needs no script and has no access to the chart.
Give the iframe a `title` so screen readers can name it, and put a text summary in the host page for search engines,
since the iframe's content is not part of that page.

If the host sets a `Content-Security-Policy`, it must allow your frame page in `frame-src`; your frame page must
allow its own script and its data URL in `connect-src`.

## What was and was not tested

Tested in Chromium (`scripts/screenshots-element.cjs`): ways 1, 2, 3 and 4 as the example pages, light and dark;
lazy creation; remove and re-add twelve times; attribute changes; a missing `src`; React updates without
re-creation; React under `StrictMode` including unmount; React server rendering with `react-dom/server`; no console
errors. Not tested: other browsers, a page with JavaScript off (the fallback content rule follows from how browsers treat unknown tags), WordPress or any specific CMS, content security policies, `::part(frame)` styling, and React versions
other than 19.
