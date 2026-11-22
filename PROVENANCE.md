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
| `src/scales/time-ticks.ts` | `src/domains/charting/services/timeAxisTicks.ts` (`planTimeAxis`: cadence, hierarchy, layout passes; "owns more bars" tie break) and the rung ladders of `timeAxisScan.ts` | Reads the shared calendar arrays directly; no series cache, the irregular (brick) rule as a `tickText` hook (see `brick-axis.ts` below), no session-break output; a 6-hour time rung added; weekly bars may use the 15th and 10th/20th rungs; level 1 weight 400 instead of 500. |
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
| `src/indicators/series.ts`, `cols.ts` | `kernel/indicators/seriesMath.ts` (`smaN`, `recursiveN`, `emaN`, `rmaN`, `wmaN`, `stdevN`, `highestN`, `lowestN`, `swmaN`, `changeN`), `maByType.ts` (`hmaN`), `classic.ts` (`emaOfSeries`, `smaOfSeries`, `wmaOfSeries`), `sanitize.ts` (`sanitizeSeries`, the `kinds` of `robustIndicator`) | Array maths on NaN-encoded series (the kernel's null) with the same operation order; two input rules kept apart, as in the kernel: carry-forward columns with a bad-bar mask (functions the kernel wraps in `robustIndicator`) and raw columns where a bad value is a gap (the `seriesMath` functions). |
| `src/indicators/hma.ts`, `dema.ts`, `tema.ts`, `keltner.ts`, `cci.ts`, `williams-r.ts`, `roc.ts`, `cmo.ts`, `dpo.ts`, `trix.ts`, `tsi.ts`, `ppo.ts`, `stoch-rsi.ts`, `awesome-oscillator.ts`, `kst.ts`, `coppock.ts`, `connors-rsi.ts`, `fisher.ts`, `ultimate-oscillator.ts`, `elder-ray.ts`, `aroon.ts`, `vortex.ts`, `adx.ts`, `kdj.ts`, `elliott-wave-oscillator.ts`, `parabolic-sar.ts`, `bollinger-bandwidth.ts`, `standard-deviation.ts`, `choppiness.ts`, `mass-index.ts`, `mfi.ts`, `cmf.ts`, `ad-line.ts`, `chaikin-oscillator.ts`, `force-index.ts`, `ease-of-movement.ts`, `volume-roc.ts` | `kernel/indicators/classic.ts` (`calcHMA`, `calcDEMA`, `calcTEMA`, `calcKeltner`, `calcCCI`, `calcWilliamsR`, `calcROC`, `calcCMO`, `calcDPO`, `calcTRIX`, `calcTSI`, `calcPPOFull`, `calcStochRSI`, `calcAO`, `calcKST`, `calcCoppock`, `calcConnorsRSI`, `calcFisher`, `calcUltimateOsc`, `calcElderRay`, `calcAroon`, `calcVortex`, `calcADX`, `calcKDJ`, `calcEWO`, `calcSAR`, `calcBBW`, `calcStdDev`, `calcCHOP`, `calcMassIndex`, `calcMFI`, `calcCMF`, `calcADLine`, `calcChaikinOsc`, `calcForceIndex`, `calcEOM`, `calcVROC`) | One file per function with a header comment; the raw `calc*Core` maths is kept line for line (same operations in the same order), output is rows for the series instead of nullable objects. The `robustIndicator` wrapper became the `hlc` / `hl` / `closeCol` / `volCol` readers and `points`. |
| `src/indicators/rma.ts`, `vwma.ts`, `lsma.ts`, `alma.ts`, `kama.ts`, `mcginley.ts`, `envelope.ts`, `momentum.ts`, `aroon-oscillator.ts`, `balance-of-power.ts`, `rvi.ts`, `smi.ts`, `percent-b.ts`, `historical-volatility.ts`, `ulcer-index.ts`, `adr.ts`, `adr-percent.ts`, `klinger.ts`, `pvt.ts`, `nvi.ts`, `pvi.ts`, `volume-index.ts`, `net-volume.ts`, `volume-ma.ts`, `lin-reg-channel.ts`, `squeeze.ts`, `ichimoku.ts` | `movingAveragesBasic.ts`, `movingAveragesAdaptive.ts`, `movingAverageEnvelope.ts`, `momentumExtra.ts`, `oscillatorsRviSmi.ts`, `volatilityExtra.ts`, `klingerOscillator.ts`, `volumeExtra.ts`, `volumeWithMa.ts`, `linRegChannel.ts` (`calcLinRegChannel`, `linearRegressionFit`), `squeeze.ts` (`calcSqueeze`), `ichimoku.ts` (`calcIchimoku`, `ichimokuFutureCloud`) | Same maths and operation order; the `Series` (null) results became NaN rows. `envelope` takes the average types of `maByType`. `ichimoku`'s future cloud is returned without times. |
| `src/indicators/pivot-high-low.ts`, `zigzag.ts` | `pivotHighLow.ts` (`calcPivotHL`), `zigZag.ts` (`calcZigZag`, `calcZigZagConfirmed`), and `stdlib/studies/compute.ts` (`zigzagValues`: each leg filled by a straight line) | Streaming zig-zag with the same repaint rule for the last leg; the result is the filled line the script layer builds, not a list of points. |
| `src/indicators/period.ts`, `levels.ts`, `pivot-points.ts`, `cpr.ts`, `previous-high-low.ts`, `weeks-high-low.ts`, `opening-range.ts`, `relative-volume.ts` | `anchorKeys.ts` (`periodKey`, `isIntradaySeries`, `seriesSpacing`), `periodPivots.ts` / `periodLevels.ts` (`steppedPeriodValues`, `pivotLevelsFor`, `cprFor`, `rollingWeeksHighLow`, `openingRange`), `relativeVolume.ts` and `sessionVolumeProfile.ts` | The host's Indian exchange clock (`exchangeTime.ts`) became an IANA `zone` parameter (and `open` for the opening range) using this package's `core/zone.ts`; a single bar is never read as intraday. Otherwise the same stepping, window and session rules. |
| `src/indicators/vwap-acc.ts`, `vwap-bands.ts`, `anchored-vwap.ts` | `vwapAccumulator.ts` (`createVwapAccumulator`, `resolveBandMultipliers`), `sessionVwap.ts` (`vwapWithAnchor`), `anchoredVwap.ts` (`calcAnchoredVwap`) | One accumulator writing into arrays; the anchor is a time (`from`) instead of the kernel's index / period / extreme anchors; no "session supported" test in `vwapBands`. |
| `src/indicators/catalog.ts`, `catalog-kit.ts`, `catalog-trend.ts`, `catalog-momentum.ts`, `catalog-volatility.ts`, `catalog-volume.ts`, `catalog-other.ts` | `packages/chartist-core/src/stdlib/studies/specs.ts` (names, default settings, ranges, outputs) | New code for this package; only the study names, defaults and ranges were read from the host's study list. |

Parity: `tests/chartist-lite/indicators-extra.parity.test.ts` compares every study listed above with its kernel function (exact equality, `Object.is`, on a deterministic 1000-bar series, on clean bars and on bars with bad values, several settings each; the previous-period studies on intraday, daily, weekly and monthly bars). Not ported, with the reason: `chandelier` and `fractals` (the host keeps their calculation in the app, so there is nothing to port), `applySmoothing`, `macdWithSignalType`, `bbWithMaType`, `keltnerWithMaType`, `slowStochastic` (settings variants made from functions that are ported), `calcRenko` (a chart transform, not an indicator), the volume profile (volume at price, which candlestick rows do not carry). Still no code from any third-party library.

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
| `src/transforms/brick-axis.ts` (`brickTickText`, `BRICK_MONTH_OPEN_DAYS`) and the `tickText` hook in `src/scales/time-ticks.ts` | `src/domains/charting/services/timeAxisTicks.ts` (`irregularTickText` and the `irregular` branch of `planTimeAxis`, rule of 2026-10-18 in `docs/features/chart-engine/README.md` "Reversal chart types: labels on bricks"; label spellings from `timeAxisFormat.ts`) | The rule is a label hook (`OrdinalAxis.tickText`) the transforms entry installs through the series definition, so the core carries only the call; dates come from the shared calendar arrays in the chart's zone; date order 'day-month' / 'month-day'. `ordinalSeries`, `applyDelta`, the ordinal mode of `src/core/time-index.ts` (one slot per row, virtual times `T + span * j / (j + 1)`) and of `src/series/series-model.ts` / `src/chart/chart.ts` are new code for this package (the host keeps its brick bars in its own array and never had an ordinal time index). Tests ported from the host's `timeAxisTicks.test.ts` "irregular (brick) axes" cases. |

## Drawing tools added 2026-11-22 (`src/drawings/tools/`)

Ported from the host engine (same owner) and simplified to what this package paints; no code from other libraries.
Constructions run in pixel space on the projected anchors (x is linear in the logical index).

| File in this package | Source in the host | What changed |
|---|---|---|
| `src/drawings/contract.ts`, `engine.ts`, `paint.ts`, `tools/basic.ts` | Idea of `drawingToolCatalog.ts` (one entry per tool) | New code: one declarative `ToolDefinition` per tool (points, completion, handle moves, render, labels, hit, handles, icon, group); the first fifteen rewritten as definitions with unchanged behaviour. |
| `src/drawings/tools/channels.ts` (`leastSquares`, flat and disjoint channels, `pitchforkLines`) | `drawingGeometry/channelsAndPitchforks.ts` (`regressionTrendChannel`: least squares, population deviation of residuals; `flatTopBottomChannel`; `disjointChannel`) and `drawingGeometry/pitchforkConstruction.ts` (Andrews, Schiff, modified Schiff, inside: origin, target, tine anchors) | Pixel vectors instead of slope-intercept; regression over the series' closes between the two anchor times, cached per data version; drawn bands at 2 deviations (option). |
| `src/drawings/tools/fibonacci.ts` | `drawingGeometry/fibonacci.ts` (`fibTrendExtension`, `fibChannel`, `fibTimeZones` with the deduplicated sequence, `fibSpeedResistanceFan`, `fibSpeedResistanceArcs`, ratio sets) and `drawingGeometry/gann.ts` (`GANN_ANGLE_RATIOS` as multiples of the person's own 1x1, `gannBox`) | Arcs are circles in pixels facing the move; time zones stop at the pane edge (16 at most); the Gann box uses 0, 0.25, 0.382, 0.5, 0.618, 0.75, 1; speed resistance fan at thirds in price and time; labels spaced so none overlap. |
| `src/drawings/tools/shapes.ts`, `geometry.ts` (`sampleBezier`, `rotatedRectCorners`, `arcThrough`) | `drawingGeometry/curveSampling.ts` (`sampleBezier` de Casteljau, `rotatedRectCorners`) | Bezier reduced to the quadratic form; arc through three points is new code. |
| `src/drawings/tools/ranges.ts` (`anchoredVwap`, `volumeProfile`, range figures) | `drawingGeometry/anchoredVWAP.ts` (typical price, missing volume adds no weight), `vwapBands.ts` (volume-weighted deviation, clamped variance), `measurement.ts` (price and date range figures), `volumeProfile.ts` (volume spread over each bar's range, point of control, 70% value area) | One pass with cumulative sums cached per data version, projected for the bars on screen only; time-weighted (and labelled so) when the series has no volume; 24 bins. |
| `src/drawings/tools/lines.ts`, `annotations.ts` | Host house rules only (`docs/features/chart-drawings/README.md`: direction figures in the up / down colours with sign and arrow) | New code. |
| Tool icons (`icon` of every definition) | Host house style (24 grid, 1.8 round-capped line, one idea per glyph) | New path data drawn for this package. |

