# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Widget entry (`lite-charts/widget`, `chartist-lite-widget.iife.min.js`): `createWidget(el, options)`, a complete
  chart workspace in one call: symbol search, interval keys and menu, chart-type menu, a searchable indicators dialog
  grouped by category (settings per indicator: inputs, colour, width, visibility, own pane or on price), compare, price
  alert, drawing tools on demand, undo / redo, screenshot with the legend painted in, full screen, appearance,
  settings; range keys 1D to All, go to date, a clock with a zone picker, % / Log / Auto, a "latest" key when scrolled
  back; legend rows with hide / settings / remove and pane move / maximise / close; loading, empty and error states;
  live status. Data from rows, a feed of your own (`getBars`, `subscribeBars`, `searchSymbols`) or live crypto
  (`live: true`, BTC-USD and seven more pairs, demo data if no exchange answers). Opt-in, versioned `persist`;
  `save()` / `load()`; events; `destroy()` leaves no node or listener. Every word through `strings`. Responsive to
  320 px (priority collapse into More, bottom sheets on phones), light and dark, full keyboard access.
- `<chartist-terminal>` and `<chartist-chart widget>`: the whole widget with no JavaScript, from the one-tag terminal
  build (`chartist-lite.terminal.iife.min.js`, live data and drawings bundled).
- Core (additive): `timeScale().setVisibleSpan(span)`, `isAtRealTime()`, `subscribeRealTimeChange()`;
  `chart.onRemove(fn)`; `ChartPointerHandler.longPress`; `series.subscribeDataChanged()`; `lastValueColor` gets the
  previous row. The extras' range switcher, go-to-realtime button, tooltip and price alerts use them.
- Build: entries `./widget`, `./transforms`, `./extras` (exports, IIFE globals `ChartistLiteWidget`,
  `ChartistLiteTransforms`, `ChartistLiteExtras`); a licence banner on every built file; declarations that resolve
  under `moduleResolution: nodenext`; `npm run pack:check`; `scripts/rename-package.mjs`.
- Bench scenario `widget` (10k bars, three indicators): crosshair, pan, zoom, tick (script cost only, rasterisation not
  included).

### Changed

- The package is named `lite-charts` (still private, not published). ESM only: no CommonJS build.
- Core size budget lowered to 34 KB gzip.

## 0.1.0 - 2026-11-21

First version (not yet published).

### Added

- Core chart: `createChart`, canvas rendering on whole device pixels at any device pixel ratio, an overlay canvas so a
  pointer move never redraws the series, light / dark / auto themes, system fonts, text never below 12 px, true minus
  sign and no grouping separators.
- Series: candlestick, line, area, OHLC bar, histogram, baseline; `setData`, `update` (replace or append), whitespace rows.
- Time: UNIX seconds or business days, an exchange-aware time axis in any IANA time zone (daylight saving and half-hour
  changes included), labels on real calendar boundaries, no gaps for non-trading time.
- Price scales: linear, log and percent; overlay scales; a left scale; autoscale with margins.
- Panes: stacked panes with a shared time axis and crosshair, a draggable, keyboard-reachable divider, `chart.panes()`.
- Full zoom-out: `fitContent` always shows the whole series, drawn with min/max decimation when bars are denser than pixels.
- Interaction: wheel, trackpad and pinch zoom, drag pan with kinetic glide, price axis stretch, double-click reset,
  keyboard pan and zoom, a keyboard inspect mode read aloud through a live region.
- Plugins: price lines, series markers, and a primitive contract for custom drawing.
- Indicators entry (`./indicators`), custom element entry (`./element`), React entry (`./react`), and script-tag files
  for the core, the indicators and the element.

- A calm default look: tuned up/down colours with text-safe variants, quiet volume, horizontal grid only, muted axis
  figures with stronger year and month labels, a built-in legend per pane (`legend: false` hides it), a "No data" text
  for empty charts, and a short crosshair fade-in (none under reduced motion).

- Drawing tools entry (`./drawings`, script-tag file `chartist-lite-drawings.iife.min.js`): trend line, ray, extended
  line, horizontal line and ray, vertical line, rectangle, parallel channel, Fibonacci retracement, measure, long and
  short position, arrow, text note, brush; magnet, keep drawing, undo / redo, versioned JSON, optional toolbar (one
  grouped rail with flyouts, single-key shortcuts T, H, V, R, F, M, L, S, A, N, B).
- Plugin input hooks: `chart.addPointerHandler`, `chart.setCursor`, `timeScale().timeToLogical` / `logicalToTime`.
- Frame-cost bench (`npm run bench`, `docs/PERFORMANCE.md`): every measured gesture within a 120 Hz and a 144 Hz frame
  (script cost only, rasterisation not included; headless Chromium, no GPU).

- Live entry (`./live`, `chartist-lite-live.iife.min.js`) and the element-live build
  (`chartist-lite.element-live.iife.min.js`): `connectLive(series, { symbol, interval, provider })` with Coinbase,
  Binance (data-api.binance.vision) and Kraken, fallback, reconnect with backfill, pause when hidden, older history at the
  left edge; `<chartist-chart live symbol="BTC-USD">`.

### Behaviour worth knowing

- The wheel does not trap page scrolling by default (`interaction.wheelZoom: 'auto'`).
- Works under a strict Content-Security-Policy (`style-src 'self'`), on right-to-left pages and under hostile page CSS.
- A small attribution link sits in the corner under the price axis; `attribution: false` hides it.
- Public names follow TradingView Lightweight Charts on purpose; no code or text was copied, and differences are listed
  in `docs/guide/coming-from-lightweight-charts.md`.
