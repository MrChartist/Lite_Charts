---
title: Tooltips, alerts and more
description: The extras entry of Chartist Lite: tooltips in three modes, watermark, go to latest, range switcher, compare, price alerts, bar replay, bands, session breaks and custom series.
order: 7.5
related: plugins, widget, api-reference
group: customise
task: Add tooltips, alerts, replay and more
summary: Tooltips, watermark, range switcher, compare, price alerts, bar replay, bands, session breaks and four custom series, each one call.
---

# Tooltips, alerts and more

The `extras` entry is a set of small plugins on the chart's public hooks (primitives, pointer handlers, crosshair and range subscriptions). Each is one function that returns a handle with `applyOptions` and `remove` or `destroy`; nothing is created until you call it. With a script tag, load `chartist-lite-extras.iife.min.js` and use `ChartistLiteExtras`. The whole entry is {{size.extras.gzip}} KB gzip; a bundler keeps only what you import.

## Tooltips

```js live height=360
import { createChart, CandlestickSeries, LineSeries } from 'lite-charts';
import { sma } from 'lite-charts/indicators';
import { createTooltip } from 'lite-charts/extras';

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
chart.addSeries(LineSeries, { title: 'SMA 20', lineWidth: 1.5 }).setData(sma(bars, 20));

const tooltip = createTooltip(chart, { mode: 'floating' });   // or 'tracking', 'magnifier'
```

Move the pointer over the chart. `'floating'` follows the pointer and flips at the edges; `'tracking'` is a compact card pinned above the hovered bar with a marker dot; `'magnifier'` is a fixed strip along the top of the plot with the value large. Each lists the date and, for every visible titled series (or the ones in `series`), open, high, low and close or the value, with the change as a sign and arrow as well as a colour. It reads the crosshair, so the keyboard inspect mode works too, and shows on a touch long-press. `format(info)` replaces the text (set as text, never as HTML). Switch modes with `tooltip.applyOptions({ mode })`.

## Watermark and the go-to-latest button

```js live height=320
const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
chart.timeScale().setVisibleLogicalRange({ from: 40, to: 120 });

createWatermark(chart, { text: 'DEMO', lines: ['Daily, invented data'], position: 'center', opacity: 0.08 });
createGoToRealtimeButton(chart);
```

The watermark shrinks its big line to fit the pane; `createImageWatermark(chart, { image })` draws a picture instead. The button appears while the newest bar is out of view (the chart scrolled back) and brings it back; it uses the core's `timeScale().isAtRealTime()` and `subscribeRealTimeChange()`.

## Range switcher

```js live height=320
const chart = createChart('chart');
chart.addSeries(AreaSeries, { title: 'DEMO' }).setData(longBars.map(b => ({ time: b.time, value: b.close })));
createRangeSwitcher(chart, { ranges: RANGE_KEYS, position: 'top-right' });
chart.timeScale().setVisibleSpan('1Y');
```

`RANGE_KEYS` is `1D 5D 1M 3M 6M YTD 1Y 5Y All`. A span ends at the last bar and is read in the chart's time zone; 1D and 5D mean the last one and five sessions in the data. `timeScale().setVisibleSpan(span)` is the core call behind it, also with `{ days, weeks, months, years }`. The switcher is a radio group: one Tab stop, then arrows.

## Compare

```js live height=360
const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);

const compare = createCompare(chart, { base: candles, mode: 'percent' });
compare.add(compareRows[0], { title: 'NORTH' });
compare.add(compareRows[1], { title: 'HARBOR' });
```

The axis switches to percent, measured from the first visible bar, so lines of any price compare directly, and re-bases as you pan or zoom; a chip legend names each line with its change. `compare.remove(line)` takes one away, `destroy()` gives the axis its old mode back.

## Price alerts

```js live height=360 output
const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const last = bars[bars.length - 1];

const alerts = createPriceAlerts(chart, candles, {
  onTrigger: t => output(`alert at ${t.price.toFixed(2)}: crossed going ${t.direction}`),
});
alerts.add(+(last.close * 1.01).toFixed(2));

// a made-up tick every second, so the alert fires
let close = last.close;
every(1000, () => {
  close = +(close * (1 + (Math.random() - 0.4) * 0.01)).toFixed(2);
  candles.update({ time: last.time, open: last.open, high: Math.max(last.high, close), low: Math.min(last.low, close), close });
});
```

An alert is a line with a bell on the price; it fires once when the price crosses it, in either direction, through `update()`, and then stays, muted, unless `removeOnTrigger` is set. A **+** beside the crosshair price, near the axis, adds one; drag a line to move it; its close control or Delete removes it. No notification API is used: you decide what happens in `onTrigger`. `exportJSON()` and `importJSON()` save them. `every(ms, fn)` above is a helper of this site that stops when the example goes away; use `setInterval` in your own page.

## Bar replay

```js live height=360
const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const replay = createReplay(chart, candles, { data: bars });
replay.start(bars.length - 60);
```

Replay shows the history up to one bar and moves forward bar by bar, at 1x, 2x, 4x or 10x: the strip over the chart has play, pause, step, speed and a Live button that leaves replay, and `pick()` arms "click a bar to start". It feeds the series only through `setData` and `update`, so indicators and alerts built on the series keep working. `exit()` shows all the data again.

## Bands, lines and session breaks

```js live height=360
const chart = createChart('chart', { timeScale: { timeZone: 'Asia/Kolkata' } });
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO 5m' });
candles.setData(intradayBars);
chart.timeScale().fitContent();

createSessionBreaks(chart);
const high = Math.max(...intradayBars.slice(150, 225).map(b => b.high));
createPartialPriceLine(candles, { fromTime: intradayBars[170].time, price: high, title: 'High of day' });
createVerticalLine(chart, { time: intradayBars[262].time, label: 'Event' });
```

`createBands(series, { upper, lower })` fills between two rows of values (Bollinger bands, a channel). `createSessionBreaks` marks the start of each day on intraday data; `createPartialPriceLine` is a price line that starts at a time; `createVerticalLine` marks one time with a label.

## Custom series

```js live height=320
const chart = createChart('chart');
const day = (i) => new Date(Date.UTC(2024, 0, 2 + i)).toISOString().slice(0, 10);
let a = 40, b = 30, c = 20;
const rows = Array.from({ length: 90 }, (_, i) => {
  a = Math.max(8, a + Math.sin(i / 7) * 2); b = Math.max(8, b + Math.cos(i / 9) * 1.6); c = Math.max(6, c + Math.sin(i / 5));
  return { time: day(i), values: [+a.toFixed(1), +b.toFixed(1), +c.toFixed(1)] };
});
chart.addSeries(StackedAreaSeries, { title: 'Volume by venue' }).setData(rows);
```

Four series types written on the public series contract, as examples you can copy: `StackedAreaSeries` (`{ time, values: [...] }`), `HeatmapSeries` (`{ time, low, step, cells: [0..1] }`, a column of cells per bar), `RoundedCandlesSeries` (candles with a `radius`) and `WhiskerBoxSeries` (`{ time, min, q1, median, q3, max }`). The gallery shows all four.

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
