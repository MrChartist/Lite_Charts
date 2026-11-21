---
title: Indicators
description: Built-in technical indicators for Chartist Lite as plain functions from rows to series data: moving averages, Bollinger bands, RSI, MACD, ATR, VWAP, Supertrend and more, with incremental forms for live data.
order: 3
related: series-types, panes-and-scales, time-and-time-zones
---

# Indicators

The `indicators` entry is a set of pure functions from rows to series data. It has no chart import, no DOM and no dependencies, and each function is its own file, so a bundler keeps only what you import.

```js
import { sma, rsi, macd } from '@mrchartist/chartist-lite/indicators';
```

With a script tag, load `chartist-lite-indicators.iife.min.js` and use the global `ChartistLiteIndicators`.

## Input

An array of rows: candlesticks `{ time, open, high, low, close, volume? }` or `{ time, value }`. `time` is anything the chart accepts (UNIX seconds, `'YYYY-MM-DD'`, `{ year, month, day }`) and is returned exactly as given.

`source` (`'close'` by default; also `'open'`, `'high'`, `'low'`, `'hl2'`, `'hlc3'`, `'ohlc4'`) picks the price read from candlesticks by `sma`, `ema`, `wma`, `rsi`, `macd`, `bollinger` and `vwap` (whose default is `'hlc3'`). A `{ time, value }` row always reads its `value`, so one indicator's output can feed another: `sma(sma(rows, 5), 5)`.

`atr`, `donchian`, `stochastic` and `supertrend` need `high`, `low` and `close`. `obv` and `vwap` need `volume`.

## Output

Arrays are aligned one to one with the input, so `series.setData(sma(rows, 20))` works as is. A bar with no value (warm-up, or bad input) is `{ time }`: it takes a slot and draws nothing. Multi-output functions return an object of arrays.

| Function | Returns | First value on bar |
|---|---|---|
| `sma(rows, period = 20, { source }?)` | `IndicatorPoint[]` | `period − 1` |
| `ema(rows, period = 20, { source }?)` (SMA seed) | `IndicatorPoint[]` | `period − 1` |
| `wma(rows, period = 20, { source }?)` | `IndicatorPoint[]` | `period − 1` |
| `rsi(rows, period = 14, { source }?)` (Wilder) | `IndicatorPoint[]` | `period` |
| `atr(rows, period = 14)` (Wilder) | `IndicatorPoint[]` | `period − 1` |
| `obv(rows)` | `IndicatorPoint[]` | 0 |
| `vwap(rows, { zone, source, reset }?)` | `IndicatorPoint[]` | 0 (needs volume above 0) |
| `bollinger(rows, { period = 20, mult = 2, source }?)` | `{ basis, upper, lower }` | `period − 1` |
| `donchian(rows, period = 20)` | `{ upper, lower, middle }` | `period − 1` |
| `macd(rows, { fast = 12, slow = 26, signal = 9, source }?)` | `{ macd, signal, histogram }` | `slow − 1`; signal and histogram at `slow + signal − 2` |
| `stochastic(rows, { kPeriod = 14, dPeriod = 3 }?)` | `{ k, d }` | `kPeriod − 1`; `d` at `kPeriod + dPeriod − 2` |
| `supertrend(rows, { period = 10, multiplier = 3 }?)` | `{ line, up, down, direction }` | `period − 1` |
| `heikinAshi(rows)` | `{ time, open, high, low, close }[]` | 0 |
| `aggregate(rows, by, zone = 'UTC')` | `{ time, open, high, low, close, volume }[]` | n/a |

`macd.histogram` is `{ time, value }`, ready for a `HistogramSeries` (add a `color` per row for sign colours). `supertrend.up` and `.down` are `line` split by trend so each can be coloured; `direction` is 1 (up) or −1 per bar.

## Drawing indicators on a chart

Overlays such as a moving average go on the price pane as line series. Oscillators such as RSI go in a lower pane so they get their own scale (see [Panes and scales](panes-and-scales.md)):

```js
import { createChart, CandlestickSeries, LineSeries, createPriceLine } from '@mrchartist/chartist-lite';
import { sma, rsi } from '@mrchartist/chartist-lite/indicators';

const chart = createChart('chart');
chart.addSeries(CandlestickSeries).setData(bars);
chart.addSeries(LineSeries, { title: 'SMA 20' }).setData(sma(bars, 20));

const rsiLine = chart.addSeries(LineSeries, { title: 'RSI 14' }, 1);   // pane 1: a new pane below
rsiLine.setData(rsi(bars, 14));
createPriceLine(rsiLine, { price: 70, lineStyle: 'dotted' });
createPriceLine(rsiLine, { price: 30, lineStyle: 'dotted' });
```

## Higher timeframes

```js
import { aggregate } from '@mrchartist/chartist-lite/indicators';

aggregate(fiveMinuteBars, { every: 3 });                 // 15-minute bars
aggregate(fiveMinuteBars, 'day', 'America/New_York');    // one bar per calendar day in that zone
```

`aggregate(rows, { every: n })` folds n consecutive bars into one; `aggregate(rows, 'day' | 'week' | 'month', zone)` folds by calendar day, Monday-based week or calendar month in the IANA `zone`. The new bar takes the open of the first bar, the highest high, the lowest low, the close of the last and the summed volume, and keeps the first bar's time. Numeric times are instants read in `zone`; `'YYYY-MM-DD'` and `{ year, month, day }` times are business days read on the UTC calendar. `vwap` follows the same rule for what a day is: on daily bars use `reset: 'none'`. Build a higher timeframe by aggregating the source bars, then run the indicator on the result.

## Incremental forms for live data

```js
import { createIndicator } from '@mrchartist/chartist-lite/indicators';

const rsi14 = createIndicator('rsi', { period: 14 });   // 'sma' | 'ema' | 'rsi' | 'macd'
rsi14.seed(history);                                    // optional warm-up; returns what rsi(history) would
rsiSeries.update(rsi14.next(liveRow));                  // O(1) per tick
```

`next(row)`: a row with the same time as the last bar replaces it (the forming bar ticking); a newer time appends. An older time, or a time that cannot be read, is ignored and returns `{ time }`. The numbers equal the batch functions' because they share code and operation order. One difference: a leading run of bars with no value is skipped (the batch form back-fills it from the first finite value, which needs the future). `macd` returns `{ macd, signal, histogram }` points. `reset()` forgets all state. The other indicators have no incremental form; recompute them (`atr`, `bollinger` and the rest run in linear time).

## Bad input

Nothing throws, except an unknown `createIndicator` kind, which is a programming error. A bar whose own input is not a finite number (NaN, missing, text) becomes a `{ time }` row, and the series carries on from the last finite value, so one bad bar never poisons the bars after it. Window lengths are made integers of at least 1 (and at most the series length plus one). A zero-volume day has no `vwap`. An unknown time zone reads as UTC.

## Where the maths comes from

The numeric behaviour is the same as the indicator code of the host application this package was started in; `PROVENANCE.md` lists each file and what changed, and the header comment of each source file states the exact maths. Differences from that code are deliberate and listed in `src/indicators/README.md`: for example `obv` and `heikinAshi` give a `{ time }` row for a bar with a bad close, and `vwap` has no bands.
