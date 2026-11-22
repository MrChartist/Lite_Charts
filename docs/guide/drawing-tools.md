---
title: Drawing tools
description: Fifteen drawing tools for Chartist Lite (trend lines, channels, Fibonacci, measure, long and short positions, text, brush) with a toolbar, undo and JSON export.
order: 6.5
related: plugins, api-reference, accessibility
group: build
task: Let readers draw on the chart
summary: Fifteen drawing tools with a ready toolbar, undo, keyboard editing and JSON export.
---

# Drawing tools

The `drawings` entry adds drawing tools to a chart: a ready toolbar, fifteen tools, selection and editing by pointer and keyboard, undo and redo, events and a versioned JSON format. It is built on the chart's own primitive and pointer hooks, so it needs nothing the core does not already expose.

## Add the toolbar

```js live height=480
import { createChart, CandlestickSeries } from '@mrchartist/chartist-lite';
import { createDrawingTools } from '@mrchartist/chartist-lite/drawings';

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);

const tools = createDrawingTools(chart, candles, { toolbar: true });
```

Pick a tool on the rail, or focus the chart and press its key (T for a trend line), then press on the chart. Tools with two points take a press and a release (or two clicks); a horizontal line takes one; the brush draws while you hold. After a drawing is finished the rail goes back to the cursor, unless keep drawing is on. Importing the entry touches no DOM; the toolbar is built only when `toolbar` is set.

With a script tag, load `chartist-lite-drawings.iife.min.js` after the core file and use the global `ChartistLiteDrawings`.

### Options

| Option | Values | Default |
|---|---|---|
| `toolbar` | `true` (a rail on the left) or `{ position: 'left' \| 'top' }` | `false` |
| `magnet` | Snap points to the nearest open, high, low or close; holding ctrl or cmd inverts it | `true` |
| `keepDrawing` | Stay on the tool after a drawing is finished | `false` |
| `defaultStyle` | `{ color, width: 1 \| 2 \| 3, dash: 'solid' \| 'dashed' }` for new drawings | the theme's line colour, width 2, solid |
| `persist` | `{ key, storage? }`: save after every change and load at start (`localStorage` unless you pass a storage) | off |

The rail is one column of grouped buttons: the cursor, then Lines, Shapes, Fibonacci, Measure, Positions and Annotate. A group with more than one tool opens a flyout menu that lists each tool with its key; the menu works with the arrow keys, Home, End, Enter and Escape. Below the groups sit keep drawing, magnet and hide all, then undo, redo and delete all. Selecting a drawing shows a small style bar for its colour, width and dash. The toolbar lives in a shadow root and writes its styles through the CSSOM, so page CSS cannot reach it and a strict `style-src 'self'` policy does not block it.

## The tools

| Id | Tool | Rail group | Key | Points |
|---|---|---|---|---|
| `trend` | Trend line | Lines | T | 2 |
| `ray` | Ray | Lines | | 2 |
| `extended` | Extended line | Lines | | 2 |
| `horizontal` | Horizontal line | Lines | H | 1 |
| `horizontalRay` | Horizontal ray | Lines | | 1 |
| `vertical` | Vertical line | Lines | V | 1 |
| `rectangle` | Rectangle | Shapes | R | 2 |
| `channel` | Parallel channel | Shapes | | 3 |
| `fib` | Fibonacci retracement | Fibonacci | F | 2 |
| `measure` | Measure | Measure | M | 2 |
| `long` | Long position | Positions | L | 2 |
| `short` | Short position | Positions | S | 2 |
| `arrow` | Arrow | Annotate | A | 2 |
| `text` | Text note | Annotate | N | 1 |
| `brush` | Brush | Annotate | B | freehand |

The list is exported as `TOOLS` (`{ id, label, points }`, with 0 points for the brush). The Fibonacci tool draws the levels 0, 0.236, 0.382, 0.5, 0.618, 0.786 and 1. A long or short position given two points (entry and target) gets a stop at half that distance on the other side, a reward to risk of 2.00; drag it to change it. Holding Shift while placing a point keeps the line horizontal, vertical or at 45 degrees from the previous point.

## Keys

With the chart focused:

| Key | Action |
|---|---|
| T, H, V, R, F, M, L, S, A, N, B | Pick that tool (see the table above); the same key again drops it. Only without Shift, Alt, Ctrl or Cmd |
| Delete, Backspace | Remove the selected drawing |
| Escape | Cancel the drawing in progress, then drop the tool, then the selection |
| Left, Right | Move the selected drawing by one bar (Shift: 10) |
| Up, Down | Move it by one price step, the series' `minMove` (Shift: 10) |
| Ctrl or Cmd + Z | Undo; with Shift, redo |
| Ctrl or Cmd + Y | Redo |
| Shift + H | Add a horizontal line at the close of the bar under the crosshair (or the last bar) |

A locked drawing can be selected and deleted but not moved. Undo keeps the last 100 changes.

## Drawings from code

`add` takes a spec and returns the drawing; times are UNIX seconds, `'YYYY-MM-DD'` strings or business-day objects, and are stored as UNIX seconds so drawings stay put through zoom, resize, a time zone change and new data.

```js live height=420
const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const tools = createDrawingTools(chart, candles);

const at = (i) => bars[bars.length - 1 - i];
tools.add({ tool: 'trend', points: [{ time: at(120).time, price: at(120).low }, { time: at(20).time, price: at(20).low }] });
tools.add({ tool: 'rectangle', points: [{ time: at(90).time, price: at(90).high }, { time: at(60).time, price: at(60).low }],
  style: { color: '#FF9F0A', dash: 'dashed' } });
tools.add({ tool: 'measure', points: [{ time: at(45).time, price: at(45).close }, { time: at(5).time, price: at(5).close }] });
tools.add({ tool: 'text', points: [{ time: at(100).time, price: at(100).high * 1.02 }], text: 'Range' });
```

`update(id, patch)` changes points, style, text, pane or `locked`; `remove(id)`, `clear()` and `select(id)` do what they say; `drawings()` returns copies of all of them. A spec with an unknown tool or a point without a finite price throws a `TypeError` that names the problem.

## Save and load

`exportJSON()` returns versioned text; `importJSON(text, mode)` loads it back, replacing (the default) or appending, and returns how many drawings it read. Unknown tools and bad entries are skipped; text that is not an export, or from a newer version, throws.

```js live height=360 controls=draw
const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const tools = createDrawingTools(chart, candles, { toolbar: true });
const at = (i) => bars[bars.length - 1 - i];
tools.add({ tool: 'fib', points: [{ time: at(95).time, price: at(95).low }, { time: at(55).time, price: at(55).high }] });

const saved = tools.exportJSON();     // { "format": "chartist-lite-drawings", "version": 1, "drawings": [...] }
tools.clear();
tools.importJSON(saved);              // 1
```

Draw something, then use the buttons: Export JSON shows the text, Clear empties the chart, Import it back reads the exported text. For saving in the browser without writing that code, pass `persist: { key: 'my-chart' }`.

## Events

`on(event, handler)` returns a function that removes the handler. Events are `'created'`, `'changed'`, `'removed'` and `'selected'`; the handler receives a copy of the drawing, or `null` when a selection is cleared.

```js live height=360 output
const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const tools = createDrawingTools(chart, candles, { toolbar: true });

tools.on('created', d => output(`created ${d.tool}`));
tools.on('changed', d => output(`changed ${d.tool}`));
tools.on('removed', d => output(`removed ${d.tool}`));
tools.on('selected', d => output(d ? `selected ${d.tool}` : 'selection cleared'));
```

## Write a tool of your own

The drawing tools use two hooks every plugin can use. A primitive paints, and a pointer handler takes gestures before the chart pans. Here Shift and a click place a dot, anchored to a time and a price so it stays on its bar when you zoom:

```js live height=320
const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);

const dots = [];
let host = null;
candles.attachPrimitive({
  attached(h) { host = h; },
  draw(s) {
    s.ctx.fillStyle = '#FF9F0A';
    for (const d of dots) {
      const logical = chart.timeScale().timeToLogical(d.time);
      const y = s.priceToY(d.price);
      if (logical === null || y === null) continue;
      s.ctx.beginPath();
      s.ctx.arc(s.logicalToX(logical), y, 5, 0, Math.PI * 2);
      s.ctx.fill();
    }
  },
});

chart.addPointerHandler({
  pointerDown(e) {
    if (!e.shiftKey || e.area !== 'pane') return false;   // anything else stays with the chart
    const time = chart.timeScale().logicalToTime(e.logical);
    const price = candles.coordinateToPrice(e.point.y);
    if (time !== null && price !== null) { dots.push({ time, price }); host.requestUpdate(); }
    return true;                                         // this gesture is ours: no pan
  },
});
```

`addPointerHandler(handler)` returns a remover. A handler may implement `pointerDown(e)` (return `true` to own the gesture; its moves and release then go to `pointerMove` and `pointerUp`), `hover(e)`, `keyDown(e)` (asked before the chart's own keys; return `true` when handled) and `blocksTouch()` (while it returns `true` the chart sets `touch-action: none`). The event carries `point` (relative to the pane), `paneIndex`, a fractional `logical`, `area` (`'pane'`, `'price'`, `'time'` or `'none'`), `pointerType` and the modifier keys. `chart.setCursor(cursor)` forces the pointer cursor; `null` gives it back.

`timeScale().timeToLogical(time)` and `logicalToTime(logical)` interpolate between bars and extrapolate past either end at the median bar interval, so a point can sit in the empty space right of the last bar. While something moves, repaint with `host.requestOverlay()` and paint the moving part in `drawOverlay`, so the main layer is not redrawn on every pointer move. The full contract is in `ARCHITECTURE.md`, "Plugin input hooks and drawing tools".

## Performance

The frame benchmark includes a drawings chart (candles with 20 drawings of every tool) and a gesture that drags a selected horizontal line; see [Performance](../PERFORMANCE.md).

> [!VERIFY]
> Drawing with touch on real phones and tablets, and in browsers other than Chromium, has not been verified.

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
