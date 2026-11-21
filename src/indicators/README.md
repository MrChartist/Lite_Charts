# Indicators entry

`import { sma, rsi, macd } from '@mrchartist/chartist-lite/indicators'`. Pure functions from rows to data for
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

Everything else is identical, checked on 1000 bars by `tests/chartist-lite/indicators.parity.test.ts` in the host repository.
