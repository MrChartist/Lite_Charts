---
title: The ready-made chart
description: createWidget and <chartist-terminal>: a complete chart workspace in one call, with toolbar, indicators dialog, chart types, ranges, drawing tools and live crypto.
order: 1.5
related: getting-started, live-data, indicator-catalogue
group: start
task: Get a whole chart product in one call
summary: A complete workspace around one chart: symbol search, intervals, {{chartTypes}} chart types, {{indicators}} indicators, ranges, drawing tools and live data.
---

# The ready-made chart

The `widget` entry builds a whole chart workspace around one chart: a top bar with symbol search, interval keys, the chart-type menu, a searchable indicators dialog, compare, price alerts, drawing tools, undo and redo, screenshot, full screen and settings; a bottom bar with range keys, go to date, a clock and the scale keys; legend rows you can hide, edit, move and remove. Give it rows, a feed of your own or live crypto, and it does the rest. The hero chart on the home page is this widget.

## One call

```js live height=560
import { createWidget } from 'lite-charts/widget';

const widget = createWidget('chart', {
  data: demoBars('ACME', '1D', 400),
  symbol: { symbol: 'ACME', description: 'Acme (demo data)' },
  interval: '1D',
  indicators: ['ema', 'rsi'],
});
```

The container needs a size, as for any chart: the widget fills it and follows it (pass `height` for a container without one). Everything lives in one open shadow root with its stylesheet adopted through the CSSOM, so page CSS does not reach it and a strict `style-src 'self'` policy does not block it. `demoBars(symbol, interval, count)` is exported by the entry: a seeded walk, the same bars for the same symbol and interval, useful for demos and tests.

With a script tag, load `chartist-lite-widget.iife.min.js` and use the global `ChartistLiteWidget`. The widget entry is {{size.widget.gzip}} KB gzip with the chart, the catalogue and the chart types inside; the drawing tools, live data and the extras are not in it (see the last chapter).

### Options

| Option | What it does |
|---|---|
| `symbol` | `'ACME'` or `{ symbol, description, exchange }` |
| `interval` | `'1m'`, `'5m'`, `'15m'`, `'1h'`, `'4h'`, `'1D'`, `'1W'` and so on; the first five of `intervals` show as keys |
| `intervals` | Interval keys offered; default `1m 5m 15m 1h 4h 1D 1W` |
| `chartType` | One of the {{chartTypes}} chart types, such as `'candles'`, `'hollow'`, `'renko'` |
| `theme` | `'light'`, `'dark'` or `'auto'` |
| `timeZone` | An IANA zone for the axis and the clock |
| `data` | Rows: times as UNIX seconds, `'YYYY-MM-DD'` or ISO text; `value` rows become flat bars |
| `feed` | A data source of your own (next chapter) |
| `live` | `true` or `{ provider, symbol }`: real crypto from public exchanges, with the live module |
| `indicators` | Catalogue ids, or `{ id, params, visible, placement, styles }` |
| `drawings` | `true`, saved drawings JSON to restore, or `{ tools: 'basic' \| 'all' \| ToolDefinition[], open, saved }`; needs the drawings module |
| `toolbar` | Parts on or off, such as `{ compare: false, alerts: false }` |
| `persist` | `{ key, storage? }`: keep the workspace in `localStorage`; nothing is stored without it |
| `strings` | Every visible word |
| `modules`, `load` | The drawings, live, extras and transforms modules, handed in or loaded on first use |
| `settings` | `{ grid, vertGrid, crosshair, scaleMode, autoScale, volume, sessionBreaks, tooltip, watermark }` |
| `catalog`, `watermark`, `height`, `chartOptions` | Your own indicator list, the watermark text, a height in px, options for the chart itself |

The default settings: grid on, vertical grid off, crosshair `'normal'`, linear scale with autoscale, volume on, session breaks off, tooltip `'off'`, watermark off.

## A feed of your own

```js live height=560
const SYMBOLS = [
  { symbol: 'ACME', description: 'Acme (demo data)' },
  { symbol: 'GLOBEX', description: 'Globex (demo data)' },
];
const last = new Map();

const widget = createWidget('chart', {
  symbol: SYMBOLS[0], interval: '1h',
  feed: {
    intervals: ['5m', '15m', '1h', '4h', '1D'],
    async getBars({ symbol, interval, limit }) {
      const rows = demoBars(symbol, interval, Math.min(limit || 600, 2000));
      last.set(symbol + interval, { ...rows[rows.length - 1] });
      return rows;
    },
    subscribeBars({ symbol, interval }, onBar) {
      const id = setInterval(() => {
        const bar = last.get(symbol + interval);
        if (!bar) return;
        bar.close = +(bar.close * (1 + (Math.random() - 0.5) * 0.002)).toFixed(2);
        bar.high = Math.max(bar.high, bar.close); bar.low = Math.min(bar.low, bar.close);
        onBar({ ...bar });
      }, 1000);
      return () => clearInterval(id);
    },
    async searchSymbols(query) {
      const q = query.trim().toLowerCase();
      return SYMBOLS.filter(s => !q || s.symbol.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    },
  },
});
```

The contract, with times in UNIX seconds:

| Method | Called | Returns |
|---|---|---|
| `getBars({ symbol, interval, from?, to?, limit? })` | On start and on every symbol, interval or range change | A promise of rows, oldest first |
| `subscribeBars({ symbol, interval }, onBar)` | After `getBars`, if present | An unsubscribe function. Call `onBar(bar)` for the forming bar: the same time replaces the last bar, a newer time appends |
| `searchSymbols(query)` | When the reader types in the symbol search, if present | A promise of `{ symbol, description?, exchange? }` |
| `intervals` | Read once | The intervals the feed serves (default: the widget's `intervals`) |

A range key (1D to All) picks a fitting interval from what the feed offers and asks for enough bars. A failing `getBars` shows an error state in the chart and fires the `error` event. The status pill reads Live while `subscribeBars` is running.

## Live crypto

```js live height=560 connect
import { createWidget } from 'lite-charts/widget';
import { connectLive } from 'lite-charts/live';

const widget = createWidget('chart', {
  live: true, symbol: 'BTC-USD', interval: '1h', timeZone: 'local',
  modules: { live: { connectLive } },
});
```

`live: true` streams from public exchange APIs through the [live entry](live-data.md): history, then trades folded into bars, with the status in the top bar ("Live · Coinbase"). The symbol search offers the pairs the live module streams: BTC, ETH, SOL, XRP, DOGE, ADA, LTC and BNB against USD (`CRYPTO_SYMBOLS`). Chart types and indicators work on live bars. If no exchange answers within 12 s the widget shows invented demo data and says so in its status. The visitor's browser talks to the exchange directly; the privacy notes, CSP hosts and exchange terms in the [live data guide](live-data.md) apply.

## The toolbar and its parts

Top bar: `symbol`, `status`, `intervals`, `chartType`, `indicators`, `compare`, `alerts`, `draw`, `undo`, `screenshot`, `fullscreen`, `theme`, `settings`. Bottom bar: `ranges`, `goto`, `clock`, `scale`. Turn any of them off with `toolbar: { compare: false }`.

- **Responsive.** Each bar measures its items on a resize, never per frame, and moves the lowest priority ones into a More menu (compare first, then redo, undo, alert, theme, screenshot, full screen, draw, settings, chart type, indicators, and last the interval keys). Under 560 px, or on a narrow touch screen, menus and dialogs open as bottom sheets.
- **Indicators dialog.** Searchable, grouped by category, with settings per indicator: inputs, colour, width, visibility, and on price or in its own pane. Legend rows show the values of the hovered bar; hover or tap a row to hide, edit or remove it, and on a pane's first row move the pane, maximise it or close it.
- **Drawing tools.** The pencil key opens the drawing rail in the widget's left bar (a scrolling row above the bottom bar on phone widths), and the controls for a selected drawing appear in the top bar. The rail offers all {{drawingTools}} tools by default; `drawings: { tools: 'basic' }` keeps the default {{basicTools}}. Closing the rail hides only the rail: the drawings stay on the chart and can still be selected, moved and deleted (the selected one's controls stay in the top bar), while the letter keys go back to the widget and no tool can be armed until it is opened again. A saved workspace with drawings shows them at start with the rail closed (the drawing module loads for them); the eye on the rail, hide all drawings, is saved with the workspace. See [Drawing tools](drawing-tools.md).
- **Screenshot** downloads a PNG with the legend painted in; **full screen** uses the browser's full-screen mode, and the chart follows its container.

## Persistence, save and load

Nothing is stored unless you ask. With `persist: { key: 'my-chart' }` the workspace (symbol, interval, chart type, theme, zone, indicators with their settings, compare symbols, settings, drawings, whether the drawing rail is open and whether drawings are hidden, and the price alerts) is written to `localStorage` under `chartist-lite-workspace:my-chart`, 300 ms after a change, and read back at start, where it wins over the options.

```js
const json = widget.save();            // { format: 'chartist-lite-workspace', version: 2, ... }
await widget.load(json);               // or the JSON text
```

The format is versioned; version 1 workspaces are migrated, and fields that do not check out are dropped rather than trusted.

**Price alerts** (the bell adds one at the last price, the "+" beside the price axis one where you point) are saved per symbol, the same for every interval: `alerts: { version: 1, bySymbol: { 'BTC-USD': [{ id, price, triggered, direction?, value?, time? }] } }`. Switching symbol shows that symbol's alerts and keeps the others. A triggered alert is saved as triggered, with the direction, the price that crossed it and that bar's time, and never fires again (moving it re-arms it). Alerts watch only while the page is open: an alert whose price was crossed while the page was closed is not fired from history on load; it stays armed and fires on the next live crossing. They fire on the true last price of the data, on Renko and the other brick types too. At most 100 per symbol and 1000 in all; saved alerts that do not check out are left out. A saved workspace with alerts for the current symbol loads the extras to show them; one without never does. `widget.alerts()`, `addAlert(price)`, `removeAlert(id)` and `clearAlerts()` work on the current symbol, and adding or removing one is an undo step.

## Words, keys and events

**Words.** Every visible word is in `strings`: pass the ones you want to change, such as `{ indicators: 'Indikatoren', searchSymbol: 'Symbol suchen' }`. `DEFAULT_STRINGS` lists them all.

**Keys**, with the chart or the toolbar focused:

| Key | Action |
|---|---|
| `/` (or a letter) | Symbol search; on the chart, letters belong to the drawing tools while they are on |
| `,` | The interval menu |
| Digits, then Enter | An interval in minutes: `60` is 1h, `1440` is 1D; Escape clears |
| Alt+I | The indicators dialog |
| Alt+S | Screenshot |
| Ctrl or Cmd+Z, Shift+Z | Undo and redo: widget changes and drawings, one stack |

None of these clash with the chart's own keys (arrows, plus and minus, Home, End, Enter, Space, Escape) or the drawing tools' letters. Interval and range keys are radio groups: one Tab stop, then arrows.

**Events.** `widget.on(event, fn)` returns a function that removes the handler. Events: `'ready'`, `'symbol'`, `'interval'`, `'chartType'`, `'indicators'`, `'theme'`, `'status'` (`{ status, provider, demo }`), `'alert'` (`{ id, symbol, price, direction, value, time }`, once per alert that fires, to notify the user), `'error'` and `'change'` (any change to the workspace, alerts included).

**Methods.** `setSymbol`, `setInterval`, `setChartType`, `addIndicator(id, params?, state?)` (returns a handle with `setParams`, `setVisible`, `setPlacement`, `setOutputStyle`, `remove`), `removeIndicator`, `indicators()`, `setTheme`, `setRange('1Y')`, `setData(rows)`, `save()`, `load(json)`, `alerts()`, `addAlert(price)`, `removeAlert(id)`, `clearAlerts()`, `screenshot(download?)` and `destroy()`, which leaves no node or listener behind. `widget.chart` is the chart inside, with the whole chart API.

## With no code: the tags

The one-tag terminal build has the widget, the chart types, live data and the drawing tools in one file:

```html
<script src="chartist-lite.terminal.iife.min.js"></script>

<chartist-terminal live symbol="BTC-USD" interval="1h" indicators="ema,rsi" drawings></chartist-terminal>
<chartist-terminal src="/prices.json" symbol="ACME" theme="dark" height="560"></chartist-terminal>
```

Attributes: `symbol`, `description`, `interval`, `intervals` (a comma list), `chart-type`, `theme`, `time-zone`, `live`, `provider`, `indicators` (catalogue ids), `drawings`, `src` (JSON or CSV rows), `height` (default 560), `persist` (a storage key) and `toolbar-off` (parts to hide). Changing `symbol`, `interval`, `chart-type` or `theme` switches in place; any other change rebuilds the widget. Events: `chartist-ready` (`detail.widget`, `detail.chart`) and `chartist-error`. With the same build, `<chartist-chart widget ...>` is the same workspace, and a plain `<chartist-chart>` still works. The file is {{size.terminal.gzip}} KB gzip.

## Load only what is used

The widget entry brings the chart, the indicator catalogue and the chart types. The drawing tools, live data and the extras come in only through `modules` (handed in) or `load` (called the first time the part is needed: the pencil key, the bell, Replay, a tooltip or watermark setting, live mode):

```js
const widget = createWidget(el, {
  feed,
  load: {
    drawings: () => import('lite-charts/drawings'),
    extras: () => import('lite-charts/extras'),
  },
});
```

A page that never draws never downloads the drawing code. The hero on the home page goes one step further: a static picture first, then the terminal file after the page has loaded.

> [!VERIFY]
> The widget's own checks run in Chromium. Firefox, Safari, real phones and screen readers have not been verified for it.

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
