---
title: Coming from Lightweight Charts
description: The Chartist Lite API uses names familiar from TradingView Lightweight Charts on purpose; this page lists where things with the same name behave differently.
order: 11
related: api-reference, getting-started, time-and-time-zones
group: reference
task: Move a chart over
summary: Same names on purpose; here is where the behaviour differs.
---

# Coming from Lightweight Charts

Chartist Lite deliberately uses many of the same public names as TradingView's open-source Lightweight Charts
(`createChart`, `addSeries`, `setData`, `update`, `timeScale().fitContent()`, `priceScaleId`, `scaleMargins`,
`barSpacing`, `rightOffset`, `createSeriesMarkers`, `attachPrimitive` and others), so moving a chart over is mostly
mechanical. It is a separate library: no code or documentation was copied (see `PROVENANCE.md`), it is not affiliated
with TradingView, and the same name does not always mean the same behaviour. The differences below are the ones that
can surprise you. Check them against the version of Lightweight Charts you use; this list was written from the
Chartist Lite side.

> [!VERIFY]
> These differences were written from the Chartist Lite side and have not been checked against any particular Lightweight Charts version.

## Creating series

- `chart.addSeries(definition, options, paneIndex)` takes a definition object (`CandlestickSeries`, `LineSeries`,
  `AreaSeries`, `BarSeries`, `HistogramSeries`, `BaselineSeries`) imported from the package. There are no
  `addCandlestickSeries`-style methods.
- A pane past the last one is created on the fly; a lower pane goes away when its last series is removed. The top pane
  always stays. `chart.priceScale(id, paneIndex)` throws a `RangeError` for a pane that does not exist.

## Time

- Times are UNIX seconds or business days (`'YYYY-MM-DD'` or `{ year, month, day }`). A date that does not exist
  (`2024-02-31`) is refused with a `TypeError`. All series of one chart must use the same kind; a wrong call changes
  nothing.
- The axis reads instants in `timeScale.timeZone` (an IANA zone, default `'UTC'`), daylight saving included. There is
  no need to shift timestamps by hand to get local labels.
- Ticks sit on calendar boundaries read from your bars (year, month, session date, clock), never on every Nth bar.

## Time scale

- `minBarSpacing` never stops a zoom-out before the whole series fits: `fitContent()` always shows every bar, drawn in a
  compressed form (one pixel column each) when there are more bars than pixels.
- `fitContent`, `setVisibleRange` and `setVisibleLogicalRange` made before the chart has a width or data are kept and
  applied when it can.
- `setData` with fewer rows while scrolled back returns to the newest bar.

## Price scale

- Modes are strings: `'linear'`, `'log'`, `'percent'` (no indexed-to-100 mode). Percent mode measures from the first
  visible non-zero value and divides by its absolute value.
- `priceFormat.minMove` alone sets the decimals (0.25 shows 2 decimals, 5 shows none) and the smallest axis step.
- Numbers use the true minus sign (U+2212) and no grouping separators. Use `localization.priceFormatter` to change that.
- The left axis appears only while a series uses `priceScaleId: 'left'`.

## Interaction

- The mouse wheel does not trap page scrolling by default (`interaction.wheelZoom: 'auto'`): a plain vertical wheel
  zooms only when the chart has focus (clicked or tabbed into) or the page cannot scroll; ctrl or cmd plus the wheel
  (a trackpad pinch) always zooms. Set `wheelZoom: true` for the always-zoom behaviour.
- Keyboard: arrows pan, plus and minus zoom; Enter starts a bar-by-bar inspect mode read aloud through a live region.

## Plugins

- `priceAxisLabels(colors)` receives the theme colours; a label whose price is off the pane shows no tag unless it sets
  `keepInView: true`.
- Series `low(row, options)` and `high(row, options)` receive the series options (a histogram's `base` is autoscaled).
- Primitives draw in CSS pixels with the transform already set; series renderers draw in device pixels.

## Look

- A small "Chartist" link sits in the empty corner under the price axis by default (`attribution: false` hides it).
- A legend is built in: each pane lists its titled series with the values of the hovered bar (`legend: { visible: false }` hides it).
- Only horizontal grid lines by default (`grid.vertLines` is `false`).
- An empty chart says "No data" (`localization.noDataText`).
- System font stack, text never below 12 px, Apple-like colours with no purple.

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
