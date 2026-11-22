# Indicators entry

`import { sma, rsi, macd } from 'lite-charts/indicators'`. Pure functions from rows to data for
`LineSeries` / `HistogramSeries` / `CandlestickSeries`. No chart import, no DOM, no dependencies. One file per function,
so a bundler keeps only what you import. The header comment of each file states the exact maths.

## Input

An array of rows: candlesticks `{ time, open, high, low, close, volume? }` or `{ time, value }`. `time` is anything the
chart accepts (UNIX seconds, `'YYYY-MM-DD'`, `{ year, month, day }`) and is returned exactly as given.

- `source` (`'close'` default, `'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4'`) picks the price read from
  candlesticks by `sma`, `ema`, `wma`, `rsi`, `macd`, `bollinger` (and `vwap`, default `'hlc3'`). A `{ time, value }` row
  always reads its `value`, so an indicator's output can be the input of another (`sma(sma(rows, 5), 5)`).
- `atr`, `donchian`, `stochastic`, `supertrend` need `high`, `low`, `close`; `obv` and `vwap` need `volume`.

## Output

Arrays aligned 1:1 with the input, so `series.setData(sma(rows, 20))` works as is. A bar with no value is `{ time }`
(takes a slot, draws nothing). Multi-output functions return an object of arrays.

| Function | Returns | First value on bar |
|---|---|---|
| `sma(rows, period = 20, { source }?)` | `IndicatorPoint[]` | `period - 1` |
| `ema(rows, period = 20, { source }?)` (SMA seed) | `IndicatorPoint[]` | `period - 1` |
| `wma(rows, period = 20, { source }?)` | `IndicatorPoint[]` | `period - 1` |
| `rsi(rows, period = 14, { source }?)` (Wilder) | `IndicatorPoint[]` | `period` |
| `atr(rows, period = 14)` (Wilder) | `IndicatorPoint[]` | `period - 1` |
| `obv(rows)` | `IndicatorPoint[]` | `0` |
| `vwap(rows, { zone = 'UTC', source = 'hlc3', reset = 'day' \| 'none' }?)` | `IndicatorPoint[]` | `0` (needs volume > 0) |
| `bollinger(rows, { period = 20, mult = 2, source }?)` | `{ basis, upper, lower }` | `period - 1` |
| `donchian(rows, period = 20)` | `{ upper, lower, middle }` | `period - 1` |
| `macd(rows, { fast = 12, slow = 26, signal = 9, source }?)` | `{ macd, signal, histogram }` | `slow - 1`, signal and histogram `slow + signal - 2` |
| `stochastic(rows, { kPeriod = 14, dPeriod = 3 }?)` | `{ k, d }` | `kPeriod - 1`, `d` at `kPeriod + dPeriod - 2` |
| `supertrend(rows, { period = 10, multiplier = 3 }?)` | `{ line, up, down, direction }` | `period - 1` |
| `heikinAshi(rows)` | `{ time, open, high, low, close }[]` | `0` |
| `aggregate(rows, by, zone = 'UTC')` | `{ time, open, high, low, close, volume }[]` | n/a |

`macd.histogram` is `{ time, value }`, ready for `HistogramSeries` (add `color` per row for sign colours).
`supertrend.up` / `.down` are `line` split by trend so each can be coloured; `direction` is 1 (up) or -1 per bar.

`aggregate(rows, { every: n })` folds n consecutive bars into one; `aggregate(rows, 'day' | 'week' | 'month', zone)`
folds by calendar day, Monday-based week, or calendar month in the IANA `zone`. Open of the first bar, highest high, lowest
low, close of the last, volume summed; the new bar keeps the first bar's time. Numeric times are instants read in `zone`;
`'YYYY-MM-DD'` and `{ year, month, day }` times are business days read on the UTC calendar. `vwap` follows the same rule
for "a day". Build higher timeframes by aggregating the source bars, then run the indicator on the result.

### More studies (all aligned 1:1 with the input; first value on the bar in the header comment of each file)

Single series are `IndicatorPoint[]`, the rest objects of them. `{ source }` means the optional price source.

| Group | Function (defaults) | Returns |
|---|---|---|
| Averages | `hma(rows, 14, { source }?)`, `dema(rows, 20)`, `tema(rows, 20)`, `rma(rows, 7)` (`smma` is the same), `vwma(rows, 20)` | `IndicatorPoint[]` |
| | `lsma(rows, 25, { offset = 0 }?)`, `alma(rows, { window = 9, offset = 0.85, sigma = 6 }?)`, `kama(rows, { er = 10, fast = 2, slow = 30 }?)`, `mcginley(rows, { period = 14, k = 0.6 }?)` | `IndicatorPoint[]` |
| Bands, clouds | `envelope(rows, { period = 20, percent = 10, type = 'sma' }?)`, `keltner(rows, { period = 20, mult = 2, atrPeriod = 10 }?)`, `linRegChannel(rows, { period = 100, deviations = 2 }?)` | `{ upper, middle, lower }` |
| | `ichimoku(rows, { tenkan = 9, kijun = 26, senkouB = 52 }?)`, `ichimokuFuture(rows, options?)` (the cloud past the last bar, as `{ barsAhead, senkouA?, senkouB? }[]`) | `{ tenkan, kijun, senkouA, senkouB, chikou }` |
| | `parabolicSar(rows, { step = 0.02, max = 0.2 }?)` | `{ line, up, down, direction }` |
| VWAP | `vwapBands(rows, { anchor = 'day', zone, source, multipliers = [1, 2, 3] }?)`, `anchoredVwap(rows, { from, source, multipliers }?)` | `{ vwap, upper1, lower1, upper2, lower2, upper3, lower3 }` |
| Previous period | `pivotPoints(rows, { kind = 'classic', period = 'auto', zone }?)` (classic, fibonacci, woodie, camarilla), `cpr(rows, { period, zone }?)`, `previousHighLow(rows, { period, zone }?)`, `weeksHighLow(rows, { weeks = 52 }?)`, `openingRange(rows, { minutes = 15, open = 555, zone }?)` | `{ pp, r1..r4, s1..s4 }`, `{ top, pivot, bottom }`, `{ high, low, close }`, `{ high, low }` |
| Swings | `pivotHighLow(rows, { left = 10, right = 10 }?)` (markers), `zigzag(rows, { deviation = 5, legs = 10 }?)` (line) | `{ high, low }`, `IndicatorPoint[]` |
| Momentum | `cci(rows, 14)`, `williamsR(rows, 14)`, `roc(rows, 14)`, `momentum(rows, 10)`, `cmo(rows, 14)`, `dpo(rows, 20)`, `trix(rows, 18)`, `aroonOscillator(rows, 14)`, `balanceOfPower(rows, 14)`, `awesomeOscillator(rows)`, `elliottWaveOscillator(rows)`, `ultimateOscillator(rows)`, `coppock(rows)`, `connorsRsi(rows)` | `IndicatorPoint[]` |
| | `stochRsi`, `tsi`, `ppo`, `kst`, `fisher`, `rvi`, `smi`, `elderRay`, `aroon`, `vortex`, `adx`, `kdj`, `squeeze` | objects: `{ k, d }`, `{ tsi, signal }`, `{ ppo, signal, histogram }`, `{ kst, signal }`, `{ fisher, trigger }`, `{ rvi, signal }`, `{ smi, signal }`, `{ bull, bear }`, `{ up, down }`, `{ plus, minus }`, `{ adx, plusDI, minusDI }`, `{ k, d, j }`, `{ momentum, on, off }` |
| Volatility | `bollingerBandwidth`, `percentB`, `standardDeviation`, `choppiness`, `massIndex`, `historicalVolatility`, `ulcerIndex`, `adr`, `adrPercent` | `IndicatorPoint[]` |
| Volume | `mfi`, `cmf`, `adLine`, `chaikinOscillator`, `forceIndex`, `easeOfMovement`, `volumeRoc`, `relativeVolume`, `priceVolumeTrend`, `negativeVolumeIndex`, `positiveVolumeIndex`, `netVolume` | `IndicatorPoint[]` |
| | `klinger`, `volumeMa` | `{ kvo, signal }`, `{ volume, ma }` |

`period` for the previous-period studies is `'auto'` (intraday rows use the previous day, daily the previous week, weekly the
previous month, monthly the previous year), `'day'`, `'week'`, `'month'` or `'year'`; `zone` is the IANA zone that defines a day.

## Catalog (the registry a UI is built on)

```ts
import { INDICATORS, getIndicator, legendLabel } from 'lite-charts/indicators';
const rsi = getIndicator('rsi');                    // { id, name, shortName, category, overlay, inputs, outputs, guides, compute }
legendLabel(rsi, { period: 14 });                   // 'RSI 14'
rsi.compute(rows, { period: 9 });                   // { value: [{ time, value? }, ...] }, one row per input row
```

`INDICATORS` lists every indicator (85) by category (`trend`, `momentum`, `volatility`, `volume`, `other`). Each spec declares
its `inputs` (`int` / `float` with `min`, `max`, `step`; `select` and `source` with `options`; `bool`) and `outputs` (`line`,
`histogram`, `band-upper` / `band-lower` in pairs, `markers`, each with a `tone`). `compute(rows, params)` clamps every param to
its declaration (a missing, non-numeric or out-of-range value becomes the default or the nearest bound) and never throws: any
failure gives rows with `{ time }` only. Importing the catalog pulls every indicator in; import a function from the entry (or
its own file) to keep a bundle small.

## Incremental

```ts
const rsi14 = createIndicator('rsi', { period: 14 });  // 'sma' | 'ema' | 'rsi' | 'macd'
rsi14.seed(history);                                   // optional warm-up; returns the same array rsi(history) would
series.update(rsi14.next(liveRow));                    // O(1) per tick
```

`next(row)`: the same time as the last bar replaces it (the forming bar ticking), a newer time appends. An older time or a
time that cannot be read is ignored and returns `{ time }`. The numbers equal the batch functions' (they share code and
operation order). One difference: a leading run of bars with no value is skipped (batch back-fills it from the first
finite value, which needs the future). `macd` returns `{ macd, signal, histogram }` points. `reset()` forgets all state.
Other indicators have no incremental form: recompute the series (`atr`, `bollinger` and friends are linear time).

## Bad input

Nothing throws (an unknown `createIndicator` kind is the one programming error). A bar whose own input is not a finite
number (NaN, missing, text) is a `{ time }` row. The series carries on from the last finite value, so one bad bar never
poisons the bars after it; a leading gap is filled with the first finite value for the maths and still shows no value.
Window lengths are made integers of at least 1 (and at most the series length plus one). A zero-volume day has no `vwap`.
An unknown time zone reads as UTC.

## Differences from the host kernel (`chartist-core`), all deliberate

- `obv`: a bar whose close is not a number is `{ time }` (the kernel plots the carried number).
- `heikinAshi`: a bad bar is `{ time }` (the kernel repeats the last good body).
- `vwap`: no "session needs intraday bars" test; on daily bars use `reset: 'none'`. Bands are not included.
- `supertrend` also returns `up` / `down`; `donchian` calls the mean `middle` (the kernel `mid`), `macd` calls `histogram` what the kernel calls `hist`, and `bollinger` calls `basis` what the kernel calls `mid`.

Everything else is identical, checked on 1000 bars by `tests/chartist-lite/indicators.parity.test.ts` (the first twelve) and
`tests/chartist-lite/indicators-extra.parity.test.ts` (every study added later, on clean bars and on bars with bad values) in the
host repository.

The added studies differ from the kernel only where the host's clock or chart had to become a parameter:

- `pivotPoints`, `cpr`, `previousHighLow`, `relativeVolume`, `openingRange`, `vwapBands`: a `zone` (and for the opening range
  the `open` minute) replace the host's Indian exchange clock; `period: 'day' | 'week' | 'month' | 'year'` replaces `D / W / M / Y`.
  One bar alone is never "intraday" (the kernel reads a lone bar by its time of day). `vwapBands` has no "session needs
  intraday bars" test (use `anchor: 'week' | 'month' | 'year' | 'none'` on daily bars).
- `anchoredVwap` anchors on a `from` time; the kernel's period and highest-high anchors repaint as bars arrive and are left to the
  caller (pass the time of the bar you want).
- Names: `weeksHighLow`, `previousHighLow`, `pivotHighLow`, `bollingerBandwidth`, `choppiness` ... follow the file names; `smi`
  returns `signal` where the kernel says `ema`, `ppo` returns `histogram` where it says `hist`, `cpr` returns `top` / `bottom`
  where it says `tc` / `bc`, `keltner` calls the centre `middle`, and the default Keltner multiplier is the chart's 2.
- `squeeze` returns its two states as rows with value 0 (`on`, `off`) so they can be drawn as dots on the zero line;
  `parabolicSar` also returns `up` / `down` / `direction`; `ichimoku` aligns its displaced lines with the input and gives the part
  past the last bar from `ichimokuFuture`; `zigzag` returns the line with every leg filled (the last leg repaints, as in the kernel).
- Not ported: `chandelier` and `fractals` (the host keeps their calculation in the app, there is nothing to port), the kernel's
  `applySmoothing`, the `*WithMaType` / `slowStochastic` variants (compose `envelope`, `kdj` and the averages), `renko`
  (a transform, not an indicator) and the volume profile (needs volume at price, which candlestick rows do not carry).
