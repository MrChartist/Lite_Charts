# Provenance

Where every piece of Chartist Lite came from. Rule: nothing enters `src/` without a line here. No code or
documentation text is taken from Lightweight Charts or any other charting library; the public names follow Lightweight
Charts on purpose (see the last section), the code is written from scratch.

"Host" below is the Scanner Pro repository this package was started in. Ported files were written by the same owner
for the host's own chart engine; they were copied, made independent of the host (no active-market globals, no app
settings, no imports outside the package) and simplified.

| File in this package | Source in the host | What changed |
|---|---|---|
| `src/core/zone.ts` | `packages/chartist-core/src/kernel/exchangeTime.ts` (per-zone UTC offset change table built from `Intl`, `istCalendarKey` civil-from-days, `istMinuteOfDay`) and `src/domains/charting/services/timeAxisScan.ts` (`daysFromCivil`, `weekKeyOfDay`) | The zone is a parameter instead of the host's active market; fixed-offset fast path only for UTC (other zones go through the table, one `Intl` read per DST change); session, bucket and IST helpers dropped; the last-run cache is per zone. |
| `src/core/time-index.ts` | Idea from `timeAxisScan.ts` (`BarFields`: calendar fields read once per bar into typed arrays) | New code: the union of series times, O(1) append, binary search, calendar arrays kept for the whole union rather than per visible window. |
| `src/scales/time-ticks.ts` | `src/domains/charting/services/timeAxisTicks.ts` (`planTimeAxis`: cadence, hierarchy, layout passes; "owns more bars" tie break) and the rung ladders of `timeAxisScan.ts` | Reads the shared calendar arrays directly; no series cache, no irregular (brick) axis, no session-break output; a 6-hour time rung added; weekly bars may use the 15th and 10th/20th rungs; level 1 weight 400 instead of 500. |
| `src/core/format.ts` | `src/lib/format-number.ts` (`MINUS_SIGN`, `withMinus`, no-grouping rule, signed percent) and `src/domains/charting/services/timeAxisFormat.ts` (`formatTickTime`, `formatTickDate`, `formatCrosshairStamp`) | No market or currency, no Intl number formatter (`toFixed` never groups); date order is 'day-month' / 'month-day' instead of the host's three date formats. |
| `src/scales/price-ticks.ts` | `src/domains/charting/services/priceTicks.ts` (linear 1-2-5, log ladders per decade, percent from an anchor) and `chartAxes.ts` (`niceStep`, `nextNiceStep`, `stepDecimals`) | `minStep` added (never tick finer than the minimum move); returns prices only (no `t` fraction); log ceiling 12 ticks; percent ticks reuse the linear planner. |
| `src/render/pixel.ts` | `src/domains/charting/services/render/candleGeometry.ts` (`candleLayout`, `hairlineDev`, column mode below 3 device px, wick parity) and `drawingCrispLines.ts` (`deviceLineWidth`, `snapToDeviceGrid`) | Outline mode dropped; one function per rule; names shortened. |
| `src/render/canvas.ts` | Rule described in `docs/features/chart-engine/README.md` "Canvas and DPR" (host `prepare-canvas.ts`: use `devicePixelContentBoxSize` when it is for the same CSS box and within one pixel of css x dpr) | Re-implemented as a small class owning one canvas; horizontal and vertical ratios kept separately. |
| `src/series/candlestick.ts` (`normalize`, the validity rule) | `packages/chartist-core/src/kernel/candle.ts` (`isValidCandle`: the range must contain open and close) | A row whose high/low do not contain open/close is repaired (high = max, low = min) instead of rejected; non-finite values throw. |
| `src/render/decimate.ts` | Idea from `src/domains/charting/services/render/candleGeometry.ts` (`aggregateColumns`: min low to max high per device pixel column when zoomed out) | Generalised to any row type through an accessor (high, low, first, last), with a row count per column; new code. |
| `src/drawings/geometry.ts` (`simplifyPath`, `arrowHead`) | `src/domains/charting/services/drawingGeometry/freehand.ts` (Douglas-Peucker `simplifyPath`, 1.5 px tolerance) and `drawingGeometry/arrowHead.ts` (`arrowHeadPoints`: head `size` long, wings half as wide, capped at half the line) | Simplification made iterative (no recursion, no array copies); otherwise the same rules. |
| `src/drawings/tools.ts`, `src/drawings/controller.ts` | Ideas from `drawingToolCatalog.ts` (one catalogue entry per tool), `drawingCrispLines.ts` (axis-aligned strokes on whole device pixels, via `render/pixel.ts`), `drawingCull.ts` (skip drawings outside the plot; lines that run to the edge are always drawn), `drawingPersistence.ts` (persist only what the caller opts into) and `docs/features/chart-drawings/README.md` (direction colours on measure and position labels) | New code: catalogue, painting, hit testing, controller, history and JSON written for this package. |
| `src/drawings/toolbar.ts` | Host house style only (inverted-ink selected state, capsule icon buttons, 24-grid line icons) | New code; the icons are new path data drawn for this toolbar. |
| `src/live/*` | New code. Response shapes taken from the exchanges' live public endpoints on 2026-11-21 (samples in `src/live/__fixtures__/`), not from other libraries | |
| Everything else in `src/` | New code for this package | Written for Chartist Lite (chart, series contract, primitives, input, theme, text painter, scales models). |

Third-party code: none. Runtime dependencies: none. Development tools (not shipped): TypeScript, Vitest, esbuild.

## Indicators entry (`src/indicators/`)

Every file below was written for this package from the host's own indicator maths; the numeric behaviour is kept
identical (exact equality on a 1000-bar series: `tests/chartist-lite/indicators.parity.test.ts` in the host repository,
which imports both). No third-party code.

| File in this package | Source in the host | What changed |
|---|---|---|
| `src/indicators/sma.ts`, `ema.ts`, `rsi.ts`, `macd.ts` | `packages/chartist-core/src/kernel/indicators/classic.ts` (`calcSMACore`, `calcEMACore`, `calcRSICore`, `calcMACDCore`) and `rolling.ts` (`rollingMean`: running sum, exact re-sum once per window) | Rewritten as small stateful `StepCore` classes with `mark` / `rollback` so the batch function and the incremental `createIndicator` share one code path; same operation order, so the results are bit-identical. |
| `src/indicators/wma.ts`, `atr.ts`, `donchian.ts`, `stochastic.ts`, `supertrend.ts`, `obv.ts` | `classic.ts` (`calcWMACore`, `calcATRCore`, `calcDonchianCore`, `calcStochasticCore`, `calcSuperTrendCore`, `calcOBVCore`) | Output is rows for the series instead of nullable result objects; supertrend also returns the trend-split `up` / `down`; obv leaves a bar with a bad close without a value. |
| `src/indicators/bollinger.ts`, `rolling.ts` | `classic.ts` (`calcBBCore`) and `rolling.ts` (`rollingMeanStd`: sliding Welford with exact re-computation, flat window is exactly 0; `slidingExtremeIndex`: monotonic deque) | Copied; null replaced by NaN internally. |
| `src/indicators/vwap.ts` | `kernel/indicators/sessionVwap.ts` (`vwapWithAnchor`) and `vwapAccumulator.ts` | The anchor is a calendar day in a given IANA zone (the package's `core/zone.ts`) instead of the host's IST helpers; no bands, no "session supported" test, sources limited to close, hl2, hlc3, ohlc4. |
| `src/indicators/heikin-ashi.ts` | `classic.ts` (`calcHA`) | A bad bar is a `{ time }` row instead of a repeated body. |
| `src/indicators/aggregate.ts` | `src/domains/charting/services/candleAggregation.ts` (`groupBy`, `foldGroup`, `aggregateWeekly`, `aggregateMonthly`) | Zone is a parameter instead of the active market; day bucket and "every n bars" added; bad rows are skipped; no session alignment of intraday buckets. |
| `src/indicators/shared.ts` | `kernel/indicators/sanitize.ts` (`sanitizeSeries`: carry the last finite value forward, back-fill a leading gap; `clampPeriod`; the bad-bar mask of `robustIndicator`) | One small helper set instead of a wrapper around every function. |
| `src/indicators/create-indicator.ts`, `time-util.ts`, `index.ts`, `README.md` | New code for this package | |

## API naming similarity with TradingView Lightweight Charts

The public vocabulary of Chartist Lite deliberately follows names used by TradingView's open-source Lightweight
Charts, so that people who know that library can move over easily. No code and no documentation text was copied from
it: every file was written for this package (or ported from the host repository as listed above), and the guides were
written from this package's own behaviour.

Shared or closely matching public names:

- Chart: `createChart`, `addSeries`, `removeSeries`, `applyOptions`, `options`, `resize`, `remove`, `takeScreenshot`,
  `timeScale`, `priceScale`, `panes`, `subscribeCrosshairMove` / `unsubscribeCrosshairMove`, `subscribeClick` /
  `unsubscribeClick`, `attachPrimitive` / `detachPrimitive`, `autoSize`.
- Series: `CandlestickSeries`, `LineSeries`, `AreaSeries`, `BarSeries`, `HistogramSeries`, `BaselineSeries` (passed to
  `addSeries`), `setData`, `update`, `data`, `priceToCoordinate`, `coordinateToPrice`, `priceScaleId`,
  `lastValueVisible`, `priceLineVisible`, `priceFormat` (`precision`, `minMove`), `upColor` / `downColor`,
  `wickUpColor` / `wickDownColor`, `lineWidth`, `lineStyle`, `lineType`, `crosshairMarkerVisible`, `baseValue`,
  whitespace rows (`{ time }` only), business days as `'YYYY-MM-DD'` or `{ year, month, day }`.
- Time scale: `fitContent`, `scrollToRealTime`, `resetTimeScale`, `getVisibleRange` / `setVisibleRange`,
  `getVisibleLogicalRange` / `setVisibleLogicalRange`, `scrollPosition`, `timeToCoordinate`, `coordinateToTime`,
  `logicalToCoordinate`, `coordinateToLogical`, `subscribeVisibleLogicalRangeChange`, `barSpacing`, `minBarSpacing`,
  `rightOffset`.
- Price scale: `scaleMargins` (`top`, `bottom`), `autoScale`, `mode`, `rightPriceScale` / `leftPriceScale`, overlay
  scales by id.
- Plugins: `createPriceLine`, `createSeriesMarkers` (`aboveBar`, `belowBar`, `inBar`, `arrowUp`, `arrowDown`, `circle`,
  `square`), `priceAxisLabels`, `autoscale`, `zOrder`, primitives with `attached` / `detached` / `draw`.
- Options and events: `crosshair.mode` (`normal`, `magnet`, `hidden`), `localization.priceFormatter` /
  `timeFormatter`, `MouseEventParams` (`time`, `logical`, `point`, `seriesData`, `paneIndex`).

Shared model: the time scale is a bar-spacing model. One logical index per distinct time across all series, bars
equally spaced `barSpacing` px apart, the view anchored to the last bar by `rightOffset` bars, and visible ranges
expressed as logical (fractional bar index) ranges. That idea, and the choice of the same option names for it, is
shared with Lightweight Charts; the code here was written independently (`src/scales/time-scale.ts`).

Where same-named things behave differently is listed for users in `docs/guide/coming-from-lightweight-charts.md`.

API naming similarity: owner / counsel decision, Needs verification. Whether reusing these public names (and the
bar-spacing model) is acceptable, and how the docs should refer to Lightweight Charts and TradingView, is for the owner
and counsel to confirm before the package is published. Nothing has been renamed.

## Transforms entry (`src/transforms/`) and chart-type series

Written for this package from the host's own chart-type maths, by the same owner; the numeric behaviour is kept
identical (exact equality on 5 deterministic series: `tests/chartist-lite/transforms.parity.test.ts` in the host
repository, which imports both). No third-party code, nothing taken from another charting library.

| File in this package | Source in the host | What changed |
|---|---|---|
| `src/transforms/renko.ts` | `packages/chartist-core/src/kernel/indicators/classic.ts` (`calcRenko`: grid anchored at the floored first close with the 1e-9 epsilon, the floor-is-zero start brick, two-brick reversal) and `src/domains/charting/services/renkoChart.ts` (`autoRenkoBrickSize`: ATR(14) at the last completed bar to two significant figures, else `autoBoxSize`) | Never throws (the host's 'precision' and 'limit' errors stop the transform at 100000 rows); price source option; `{ atr }` and `{ percent }` brick sizes; volume credited once (to the first brick a bar makes) instead of repeated on every brick; incremental form with mark / rollback. |
| `src/transforms/line-break.ts` | `chartTypeReversalRenderers.ts` (`computeLineBreak`: continuation opens at the last close, reversal at the last open) | Window scan without per-bar allocation; bad rows skipped; volume credited once; incremental form. |
| `src/transforms/range-bars.ts` | `chartTypeReversalRenderers.ts` (`computeRangeBars`) | Row limit instead of unbounded loops; `{ atr }` / `{ percent }` range; incremental form. Volume rule unchanged (first bar of a batch takes it). |
| `src/transforms/kagi.ts` | `chartTypeReversalRenderers.ts` (`computeKagi`, `kagiYangYin`) | The reversal is a percentage, a price amount, `{ atr }`; thickness (`startYang`, `endYang`, `flipAt`) is written on each row so a series can draw any slice; volume credited to the segment the bar belongs to. |
| `src/transforms/point-figure.ts` | `chartTypeReversalRenderers.ts` (`computePointFigure`, `pointFigureBoxCount` rule: marks = round((high - low) / box) + 1) | Box as price, `{ atr }`, `{ percent }`; `up` flag on the row; the bar that reverses a column belongs to the new column. |
| `src/transforms/shared.ts` | `chartTypeReversalRenderers.ts` (`autoBoxSize`: about 60 boxes across the range, 1-2-5) | Reads rows with a price source; ATR from the package's own `indicators/atr.ts`. |
| `src/transforms/index.ts` (`heikinAshi`) | Re-export of `src/indicators/heikin-ashi.ts` (see above) | None. |
| `src/series/column.ts`, `high-low.ts`, `hlc-area.ts`, `step-line.ts`, `hollow-candlestick.ts` | Row shapes and meaning from `chartTypeTransforms.ts` (`toColumnSeries`, `toHighLowSeries`, `toHLCAreaSeries`, `toStepLineSeries`, `toHollowCandleSeries` colour/hollow rule) | New drawing code on the package's series contract; step line holds a value (no duplicated times); hollow colour follows the change from the previous close. |
| `src/series/kagi.ts` | `chartTypeReversalRenderers.ts` (`drawKagi`: yang 3 px / yin 1.25 px, colour with thickness, the horizontal turn carries the thickness at the turn) | New drawing code: two continuous strokes on whole device pixels, dense fold. |
| `src/series/point-figure.ts` | `chartTypeReversalRenderers.ts` (`drawPointFigure`: X for up, O for down, one mark per box level) | New drawing code with three looks (glyphs, bars, fold). |
| `src/transforms/chart-types.ts`, `incremental.ts`, `time-spread.ts` | New code for this package | |
