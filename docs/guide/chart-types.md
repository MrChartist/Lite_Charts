---
title: Chart types
description: The {{chartTypes}} chart types of Chartist Lite, from candles to Renko, Kagi, line break, point and figure and range bars, switched with one call to applyChartType.
order: 3.5
related: series-types, widget, api-reference
group: build
task: Switch between {{chartTypes}} chart types
summary: Candles to Renko, Kagi and point and figure, each one call to applyChartType, with the inputs a settings form needs.
---

# Chart types

The `transforms` entry adds {{chartTypes}} chart types on top of the six core series. `CHART_TYPES` lists them with the inputs a settings form needs, and `applyChartType(id, rows, options)` returns everything `addSeries` wants, so switching type is one call. The ready-made chart's chart-type menu is built on the same two exports.

## One call

```js live height=360
import { createChart } from 'lite-charts';
import { applyChartType } from 'lite-charts/transforms';

const chart = createChart('chart');
const { definition, data, options } = applyChartType('hollow', bars, { series: { title: 'DEMO' } });
chart.addSeries(definition, options).setData(data);
```

Rows in are candlesticks (or `{ time, value }` rows, which the line looks accept). They are cleaned first: a row whose time cannot be read is dropped, an older time is dropped, and a repeated time keeps the last row, so `setData` never throws on them. The result also carries `info`, such as the Renko brick size that was used. With a script tag, load `chartist-lite-transforms.iife.min.js` and use `ChartistLiteTransforms`; the entry is {{size.transforms.gzip}} KB gzip.

## Every type

| Id | Name | Kind | Inputs |
|---|---|---|---|
| `candles` | Candles | series | |
| `hollow` | Hollow candles | series | |
| `bars` | Bars | series | |
| `highLow` | High-low | series | |
| `line` | Line | series | |
| `stepLine` | Step line | series | |
| `area` | Area | series | |
| `hlcArea` | HLC area | series | |
| `baseline` | Baseline | series | `base`: base price, 0 takes the first close |
| `columns` | Columns | series | |
| `heikinAshi` | Heikin Ashi | transform | |
| `renko` | Renko | transform, irregular time | `brick`: brick size, 0 for automatic |
| `lineBreak` | Line break | transform, irregular time | `lines`: 3 (1 to 10) |
| `kagi` | Kagi | transform, irregular time | `reversal`: 4 % (0.1 to 50) |
| `pointFigure` | Point & figure | transform, irregular time | `box`: box size, 0 for automatic; `reversal`: 3 boxes (1 to 9) |
| `rangeBars` | Range bars | transform, irregular time | `range`: 0 for automatic |

A **series** type draws the rows as they are. A **transform** first turns them into new rows: Heikin-Ashi candles, Renko bricks, line-break lines, Kagi segments, point and figure columns or range bars. Transforms read the close by default (`source: 'close'`; also `'open'`, `'high'`, `'low'`, `'hl2'`, `'hlc3'`, `'ohlc4'`). The functions behind them (`renko`, `lineBreak`, `kagi`, `pointFigure`, `rangeBars`) and incremental forms for live data (`createRenko`, `createLineBreak`, `createRangeBars`) are exported too.

## Bricks, lines and boxes

```js live height=360 output
const chart = createChart('chart');
const { definition, data, options, info } = applyChartType('renko', bars, { brick: 0, series: { title: 'DEMO Renko' } });
chart.addSeries(definition, options).setData(data);
chart.timeScale().fitContent();
output(`brick ${info.brick.toFixed(2)}, ${data.length} bricks from ${bars.length} bars`);
```

```js live height=360
const chart = createChart('chart');
const { definition, data, options } = applyChartType('pointFigure', bars, { box: 0, reversal: 3, series: { title: 'DEMO P&F' } });
chart.addSeries(definition, options).setData(data);
chart.timeScale().fitContent();
```

An automatic size (0) is measured from the data. In Renko, every move of one brick draws a brick; in line break (close only) a new line forms on a new extreme in the current direction, or when the close breaks the body of the last `lines` lines the other way; in Kagi the line turns after a reversal of the given percent; point and figure stacks X and O boxes and starts a new column after `reversal` boxes the other way; every range bar spans exactly `range` from the previous bar's close, with no fixed price grid.

## What the time axis shows

> [!WARNING]
> Renko, line break, Kagi, point and figure and range bars are **not evenly spaced in time** (`irregularTime: true`): one source bar can make several bricks, and many bars can make none. The chart's axis is a time axis, so these types borrow times. Each brick keeps the time of the bar that made it, or the next second (the next day, for business days) after the previous row when several bricks come from one bar (`spreadTimes`; `info.shifted` counts them). The labels on the axis therefore show when bricks were formed, roughly, not a calendar, and a crosshair date on a shifted brick is off by those seconds or days. An axis that labels bricks rather than dates is not built yet.

Heikin Ashi keeps one candle per bar, so its time axis is exact.

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
