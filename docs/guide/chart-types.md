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

A **series** type draws the rows as they are. A **transform** first turns them into new rows: Heikin-Ashi candles, Renko bricks, line-break lines, Kagi segments, point and figure columns or range bars. Transforms read the close by default (`source: 'close'`; also `'open'`, `'high'`, `'low'`, `'hl2'`, `'hlc3'`, `'ohlc4'`). The functions behind them (`renko`, `lineBreak`, `kagi`, `pointFigure`, `rangeBars`) and incremental forms for live data (`createRenko`, `createLineBreak`, `createRangeBars`) are exported too; the irregular ones draw on the brick time axis described below.

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

## The brick time axis

Renko, line break, Kagi, point and figure and range bars are not evenly spaced in time (`irregularTime: true`): one source bar can make several bricks, and many bars can make none. `applyChartType` gives these types a definition with an **ordinal time axis** (`definition.ordinal`), so the chart places bricks by row order, one slot per brick, and every brick keeps the true date of the bar that made it: nothing is moved, and the crosshair, its date tag, the legend and the keyboard inspect mode name that date. Ticks sit only on bricks, where the calendar date changes from one brick to the next; a year label stays the bare year only on a January brick and otherwise names the month (`Aug 2020`), and a month label stays the bare month only in the month's first 7 days and otherwise names the day (`17 Mar`), so a jump of years between two bricks reads as a jump and the axis is sparser than a calendar one.

The same bars as candles, on a calendar axis:

```js live height=320
const chart = createChart('chart');
const { definition, data, options } = applyChartType('candles', bars.slice(-120), { series: { title: 'DEMO candles' } });
chart.addSeries(definition, options).setData(data);
chart.timeScale().fitContent();
```

And as Renko, on the brick axis (hover a brick: the tag shows the date of the bar that made it):

```js live height=320 output
const chart = createChart('chart');
const { definition, data, options, info } = applyChartType('renko', bars.slice(-120), { brick: 0, series: { title: 'DEMO Renko' } });
chart.addSeries(definition, options).setData(data);
chart.timeScale().fitContent();
chart.paint();
output(`${data.length} bricks, brick ${info.brick}; ordinal axis: ${chart.timeScale().isOrdinal()}`);
```

What else holds on a brick axis:

- **Other series** share the brick rows: row i of every series sits on brick i, and `setData` or `update` throws when a row's time differs from the brick's. Give a volume histogram the bricks' own `volume`, and compute indicators on the bricks (`sma(data, 20)`), not on the source bars. Rows that stop lining up after the bricks change (a new brick size) are kept but not drawn until the series is set again. The ready-made chart does all of this: volume and indicators follow the bricks, compare symbols are kept but not drawn.
- **Times.** A time given to `timeToCoordinate`, `timeToLogical`, markers or `seriesRowAt` finds the FIRST brick dated that time; `setVisibleRange` covers every brick dated inside the range, `setVisibleSpan('1Y')` the bricks whose source dates fall in the span. `logicalToTime` gives brick j (from 0) of the bricks dated T the time T + span × j / (j + 1), `span` being the smallest gap between bricks, so time and slot map one to one and a drawing anchored on the third brick of a bar stays on it.
- **Drawings** are anchored in time and price, so they are never destroyed by a type switch: on candles a point drawn on a brick sits on (or just after) the bar that made the brick, and back on Renko it returns to the same brick. A point dated where no brick is lies between the bricks around it.
- **Live data.** `createRenko`, `createLineBreak` and `createRangeBars` take one bar at a time; `applyDelta(series, delta)` pops the bricks a tick took back and appends the new ones (`update(row, { append: true })` adds a brick with the same time as the last), in O(changed bricks). A scrolled-back view stays still and a view at the live edge follows the new bricks.
- **Off on a brick axis:** session breaks (bricks have no sessions) and the ready-made chart's replay.

```js
import { createRenko, applyDelta, ordinalSeries } from 'lite-charts/transforms';

const inc = createRenko(history, { brick: 0.5 });
const series = chart.addSeries(ordinalSeries(CandlestickSeries));
series.setData(inc.rows);
feed.onBar(bar => applyDelta(series, inc.update(bar)));   // a new bar, or the forming bar again
```

A host that wants the old calendar axis passes `calendarTime: true`: the plain definition, and times spread to be unique (`spreadTimes`: the next second, or the next day for business days, after the previous row; `info.shifted` counts them). On the default brick axis `info.shifted` is always 0.

Heikin Ashi keeps one candle per bar, so its time axis is exact.

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
