# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
- Frame-cost bench (`npm run bench`, `docs/PERFORMANCE.md`): every measured gesture within a 120 Hz and a 144 Hz frame.

### Behaviour worth knowing

- The wheel does not trap page scrolling by default (`interaction.wheelZoom: 'auto'`).
- Works under a strict Content-Security-Policy (`style-src 'self'`), on right-to-left pages and under hostile page CSS.
- A small attribution link sits in the corner under the price axis; `attribution: false` hides it.
- Public names follow TradingView Lightweight Charts on purpose; no code or text was copied, and differences are listed
  in `docs/guide/coming-from-lightweight-charts.md`.
