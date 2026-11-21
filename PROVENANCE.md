# Provenance

Where every piece of Chartist Lite came from. Rule: nothing enters `src/` without a line here. No code or
documentation text is taken from Lightweight Charts or any other charting library; the API shape (createChart,
addSeries, setData/update) is familiar on purpose, the code is written from scratch.

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
