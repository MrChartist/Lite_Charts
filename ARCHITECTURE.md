# Chartist Lite architecture

For contributors and stage-2 workers. Public README, licence and contributing guide are separate files.

## Commands (run inside `packages/chartist-lite/`)

| Task | Command |
|---|---|
| Install dev tools | `npm install` (TypeScript, Vitest, esbuild; no runtime dependencies) |
| Typecheck (sources and tests) | `npm run typecheck` |
| Unit tests | `npm test` |
| Build `dist/` | `npm run build` (ESM per entry, a licence banner on every file, declarations with real `.js` specifiers so `nodenext` consumers resolve them; optional entries `widget`, `transforms`, `extras` build only when their index file exists; IIFE globals `ChartistLite` (`chartist-lite.iife.min.js`), `ChartistLiteIndicators` (`chartist-lite-indicators.iife.min.js`), `ChartistLiteElement` (`chartist-lite.element.iife.min.js`, registers `<chartist-chart>` on load); `.d.ts` in `dist/types/`) |
| Size | `npm run size` (each entry bundled + minified + gzip, and every IIFE file as built; fails if the core is over 34.6 KB gzip) |
| Package as a consumer gets it | `npm run pack:check` (packs, unpacks into a throwaway consumer, imports every subpath in Node, type-checks a strict `nodenext` and a `bundler` consumer with `skipLibCheck: false`, and proves the types are real: a wrong member access must fail). ESM only: no CommonJS build, no `require` condition |
| Rename the npm package | `node scripts/rename-package.mjs <name> [--only package,src,examples,notes,readme,docs,site] [--dry]` (safe to run twice; the name is `lite-charts`; product name and `ChartistLite*` globals stay) |
| All of the above | `npm run check` |
| Browser smoke + screenshots | `npm run screenshots` (builds, then runs every `scripts/screenshots*.cjs`; needs Playwright importable on the machine; not a dev dependency, not in CI) |

## Modules

```
src/
  index.ts            public entry: createChart, CandlestickSeries, LineSeries, themes, types
  api.ts              public interfaces (ChartApi, SeriesApi, TimeScaleApi, PriceScaleApi, MouseEventParams)
  core/
    time.ts           Time input (UNIX seconds | 'YYYY-MM-DD' | {year,month,day}) -> seconds; granularity inference
    zone.ts           IANA zone offsets (DST-safe change table), civil-day maths
    time-index.ts     the shared time axis: sorted union of all series times + calendar fields per slot; ordinal mode
                      (one slot per row of the brick series, repeats kept, one-to-one virtual times)
    format.ts         price / percent / time text (true minus U+2212, no grouping)
    options.ts        ChartOptions, defaults, deep merge
    theme.ts          light and dark palettes, readable text colour on a fill
  scales/
    time-scale.ts     logical index <-> x (pure)
    price-scale.ts    price <-> y, linear / log / percent, margins (pure)
    price-ticks.ts    price tick planner (pure)
    time-ticks.ts     calendar-boundary time tick planner (pure)
  render/
    canvas.ts         one canvas sized on whole device pixels (DOM)
    text.ts           cached text measuring, tabular figures on canvas
    pixel.ts          device-pixel helpers, candle geometry (pure)
    decimate.ts       min/max decimation: rows -> one entry per device-pixel column (pure)
  series/
    definition.ts     THE SERIES CONTRACT (types only)
    series-model.ts   one series' rows, times and slots
    candlestick.ts    candlestick definition
    line.ts           line definition
  plugins/
    primitive.ts      THE PRIMITIVE CONTRACT (types only)
  chart/
    chart.ts          the chart: DOM, panes, state, scheduler, painters, public API implementation
    pane-layout.ts    stacked pane heights, separator moves, pane hit test (pure)
    legend.ts         the built-in legend: pure text builders (`describeRow`) and one DOM box per pane
    input.ts          pointer / wheel / touch / keyboard -> view operations
  indicators/         `./indicators` entry: pure indicator functions and incremental forms (no chart import)
  element/            `./element` entry: `<chartist-chart>` (`defineChartistElement`; `auto.ts` registers on load for the IIFE)
  react/              `./react` entry: `createChartistReact(React)`, React injected, never a dependency
  live/               `./live` entry: `connectLive`, providers (Coinbase, Binance, Kraken), bar building; the only network code
  drawings/           `./drawings` entry: drawing tools (see "Plugin input hooks and drawing tools")
  render/dom.ts       CSSOM style writes with `!important` resets (CSP-safe, immune to page CSS)
  core/span.ts        calendar spans for range keys (pure): parseSpan, spanStartDay, spanStart, spanFirstIndex, localMidnight
  widget/             `./widget` entry: createWidget (the ready-made workspace) and <chartist-terminal> (see "Widget")
  transforms/         `./transforms` entry: chart types (CHART_TYPES, applyChartType), brick transforms and the brick
                      time axis (brick-axis.ts: ordinalSeries, brickTickText, applyDelta)
  plugins/extras/     `./extras` entry: tooltip, watermark, price alerts, replay, compare, range switcher, go to realtime
```

Dependency direction: `core` and `scales` are pure and import nothing from `render`, `series` or `chart`.
`series/*.ts` definitions import only `core`, `render/pixel.ts` and `series/definition.ts`. `chart/` imports
everything. Nothing imports `chart/` except `index.ts`.

## Coordinate systems

| Space | Unit | Origin | Used by |
|---|---|---|---|
| Time | seconds (business day = UTC midnight) | epoch | data, `TimeIndex.times` |
| Logical | slot index on the shared axis (float allowed) | first distinct time = 0 (ordinal: first brick row = 0) | time scale, primitives (`logicalToX`) |
| Row | index into one series' rows | that series' first row | `SeriesDrawScope.from/to`, `x(rowIndex)` |
| CSS px | CSS pixels | chart top-left; the pane starts at (0,0) | API coordinates, primitives, axes, text |
| Device px | backing-store pixels | canvas top-left | series `draw` (identity transform), grid, crisp lines |

`x(i) = paneWidth - (lastIndex + rightOffset - i + 0.5) * barSpacing` (bar centre). The view is anchored to the
last bar: appending a bar moves a live view with it, and a scrolled-back view (`rightOffset < -0.5`) is kept still.
Non-trading time has no slot, so it is never drawn as a gap. Rows of one series map to slots through
`SeriesModel.pos` (binary search; every series need not have every slot).

Layout (stage 2, 2026-11-21): panes are stacked vertically above one time axis. Horizontally every pane shares
`[leftAxisWidth, cssW - rightAxisWidth]` (the plot), so bars line up across panes. Vertically the height left after the
time axis is shared by stretch factor (`chart/pane-layout.ts`: whole px, 1 px separator, no pane under 32 px when they
fit; the top pane starts at 3, a new pane at 1). Each pane owns its price scales: 'right', 'left' and any overlay id.
An axis side takes width only while some pane shows that side (scale `visible` and holding data), so the left axis
appears when a series uses `priceScaleId: 'left'`; the widest label of any pane sets the side's width (8 px hysteresis).

Coordinates in the public API are pane-relative: `timeToCoordinate` / `logicalToCoordinate` are x from the plot's left
edge; `series.priceToCoordinate` is y from the top of the series' pane; `MouseEventParams.point` is relative to the
pane under the pointer (with `paneIndex`). Primitives and series renderers get chart (canvas) coordinates, as before:
their scopes already include the plot and pane offsets. With one pane and no left axis, both are the same.

Panes are created by `addSeries(def, opts, paneIndex)` (an index past the last pane appends one) or
`series.moveToPane(i)`, and a pane below the top one is removed when its last series goes (later panes move up). The
top pane always exists. Between panes a DOM `role="separator"` element (focusable; drag, or Up/Down arrows, Shift for
40 px) moves the boundary; the new heights become the stretch factors, so proportions survive a resize.

## Render pipeline

1. Anything that changes the view calls `invalidate(mask)`: `OVERLAY` (crosshair, focus ring), `MAIN` (data, scales,
   options) or `LAYOUT` (size, DPR, theme, fonts). Masks are OR-ed and painted in ONE `requestAnimationFrame`.
2. `LAYOUT`: read the container size and `devicePixelRatio`, size both canvases (`render/canvas.ts`: whole device
   pixels, device-pixel-content-box when the browser reports it), resolve the theme.
3. `MAIN` (`paintMain`): `layout()` = pane boxes, time scale width and clamp, autoscale every price scale of every
   pane over the visible bars (series `low/high(row, options)` + primitives' `autoscale`), price ticks per pane and
   side, axis widths (repeat up to twice if they changed), time ticks. Then per pane: grid (1 device px), separator
   line, clip to the pane, primitives `bottom`, the pane's series in add order, primitives `normal`, last-value price
   lines, primitives `top`, unclip, left and right axes (tick labels, last-value tags, primitive tags; tags pushed
   apart, labels under a tag hidden; a primitive tag whose price is off the pane is dropped unless `keepInView`).
   Finally the time axis labels.
4. Overlay (`paintOverlay`, always after the above, and alone on a pointer move): crosshair (vertical line through
   every pane, horizontal line in the pane under the pointer), hover dots
   (`crosshairMarker`), primitives' `drawOverlay`, crosshair axis tags (the axis under a tag is blanked to whole
   labels), focus ring when focus is from the keyboard.

A pointer move costs one overlay repaint; it never redraws series. Only visible rows are touched (`rowRange` by binary
search, plus one row each side). Zoom-out never stops before the whole series fits (`TimeScaleModel.minSpacing()` =
the smaller of `minBarSpacing` and width / bars), so `fitContent` shows 100k+ bars; below the candle-width floor the
painters draw a compressed form through min/max decimation (`render/decimate.ts`): candles and bars one column per
device pixel from lowest low to highest high (coloured by first open vs last close), lines and areas the first,
highest, lowest and last value per column. The time-axis planner visits only day/month start slots
(`TimeIndex.dayStarts` / `monthStarts`) for its day, month and year cadences. Measured (Chromium headless, 1200 x 600,
DPR 1, 100k one-minute bars, `scripts/screenshots.cjs`): `setData` + fit + first paint 44-46 ms; pan frames with 2000
bars in view median 0.8 ms, worst 2.7-3.2 ms; `fitContent` + full paint with all 100k bars in view median 3.1 ms,
worst 4.5-4.8 ms.

`update(row)`: O(1) data path. Same time as the last row: replace it. Newer: append to the series and, if newer than
every slot, append one slot to the shared axis (`TimeIndex.append`, calendar read for that slot only). A time that
exists in the axis already (another series has it) reuses the slot; a time in the middle of the axis that nobody has
yet forces one O(n) rebuild. Repaint is the normal `MAIN` frame (visible bars only).

## Stage-2 contracts

### Adding a series type (area, bar, histogram, baseline)

One file `src/series/<type>.ts` exporting `<Type>Series: SeriesDefinition<<Type>Data, <Type>Options>` plus its data
and options types; one export line in `src/index.ts`; tests in `src/__tests__/<type>.test.ts`. The chart needs no
change. Contract (`src/series/definition.ts`):

- `type` unique string; `defaults` = type-specific option defaults (common options are added by the chart).
- `normalize(input)` validates and COPIES one row (use `copyTime(input.time)`); return `null` for a whitespace row
  (time only); throw `TypeError('Chartist Lite: ...')` naming the field for a bad row.
- `value(row)` single value (last-value tag, percent base, magnet); `low(row)` / `high(row)` for autoscale.
- `lastValueColor(row, options, colors)`; optional `crosshairMarker(row, options, colors)` for a hover dot.
- `low(row, options?)` / `high(row, options?)`: the chart passes the series' options as a second argument (stage 2,
  additive), e.g. a histogram's `base` is included in autoscale.
- `draw(scope)`: DEVICE pixels, identity transform, clipped to the pane, `ctx.save/restore` done by the chart.
  Stage 2 adds `scope.decimate(access)` (min/max per device-pixel column, shared buffer valid until the next call;
  also exported as `decimateColumns` from `render/decimate.ts` and the package entry) and `scope.paneIndex`; both are
  optional in the type so hand-made scopes in tests stay valid. Use the compressed form when `scope.barSpacing` is
  under your type's floor (candles and bars: 3 device px; lines and areas: 1).
  Iterate `scope.from..scope.to` only, skip `null` rows, use `scope.x(i)` / `scope.y(price)` (NaN = not drawable),
  snap with `Math.round` / `render/pixel.ts` (`deviceWidth`, `crispCoord`, `candleLayout`), batch one path per
  colour, no allocation per bar. Colours default from `scope.colors` (theme) when the option is undefined, so a theme
  switch recolours the series.
- A histogram for volume goes on an overlay scale: `priceScaleId: 'volume'` and
  `chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })`. Its baseline is
  `scope.y(0)`; overlay scales autoscale like any other (a histogram's `low(row)` should return 0).
- `baseline` needs a base price option and `scope.y(base)`; `area` fills to `scope.pane.height`.

### Primitives (price lines, markers, drawings)

Contract `src/plugins/primitive.ts`. A primitive is a plain object; attach to a series (`series.attachPrimitive(p)`,
prices map through that series' scale) or the pane (`chart.attachPrimitive(p)`, scale `p.priceScaleId ?? 'right'`).
Hooks: `attached(host)` (keep `host.requestUpdate`), `detached()`, `zOrder` ('bottom' | 'normal' | 'top'),
`draw(scope)` (main layer, CSS px, transform set, clipped to the pane), `drawOverlay(scope)` (overlay layer, every
pointer move, keep cheap), `priceAxisLabels(colors)` (tags on the axis; stage 2 passes the theme colours in use; a
label whose price is off the pane shows no tag unless `keepInView: true`), `autoscale(range)`. A pane primitive goes
on the top pane with `chart.attachPrimitive`, on another with `chart.panes()[i].attachPrimitive`. Scope gives `timeToX`,
`logicalToX`, `priceToY`, `text()` / `measureText()` with tabular figures, `formatPrice` (the axis' own format).

Planned stage-2 plugins, one file each in `src/plugins/`, exported from `src/index.ts` as functions so they tree-shake:
`createPriceLine(series, { price, color, title, lineStyle })` returning `{ applyOptions, remove }`, and
`createSeriesMarkers(series, markers[])` returning `{ setMarkers, remove }`. Both are thin primitives; no chart change.

### Indicators

Entry `lite-charts/indicators` (`src/indicators/index.ts`). Pure functions, no chart import:
`sma(rows: readonly { time: Time; close: number }[], period: number): (LineData | WhitespaceData)[]`, and so on; the
output is fed to a `LineSeries` (or a stage-2 histogram). Warm-up bars return whitespace rows `{ time }` so slots stay
aligned. Same boundary rules; no import from `chart/`. Incremental (`next(row)`) forms are optional.

### Element and React

`src/element/index.ts` exports `defineChartistElement(tagName = 'chartist-chart')` (registration only when called:
the package is `sideEffects: false`). `src/react/index.ts` is a thin component; React is an optional peer dependency
and must never become a runtime dependency of the core entry.

### Keyboard and screen readers

The chart root is focusable (`role="application"`, `aria-roledescription="chart"`, `aria-label`, and
`aria-describedby` pointing at a hidden help text from the `ariaDescription` option). Outside inspect mode: Left/Right
pan 2 bars (Shift 20), +/-/Up/Down zoom, Home/End jump. Enter or Space starts inspect mode: the crosshair sits on a bar
(the hovered one, else the last visible), Left/Right step one bar (Shift 10), Home/End go to the first/last bar, the view
scrolls by whole bars to keep it on screen, and a polite `aria-live` region reads the bar: stamp, then per visible
series "open, high, low, close" (rows with those four numbers) or its value (`describeSlot` in `chart.ts`). Enter,
Space or Escape ends it; a mouse move ends it too. Pane separators are separate tab stops (Up/Down move them).

## Conventions and ownership

- Files: kebab-case, one series type or plugin per file; tests in `src/__tests__/*.test.ts` (pure code only; Node
  environment, no DOM library).
- Errors start with `Chartist Lite:` and say what to do. Numbers on screen: `formatPrice` / `formatPercent` only.
- Never touch the DOM at module top level (the boundary test fails). Never import outside the package; source files
  import no package at all (`src/__tests__/boundary.test.ts`).
- Ownership: stage 1 (lead) owns `core/`, `scales/`, `render/`, `chart/`, `api.ts`, `series/definition.ts`,
  `series/series-model.ts`, `plugins/primitive.ts`. Stage-2 workers add new files and one export line in
  `src/index.ts` each; a contract change goes through the lead and this file.
- Every port from the host repository gets a line in `PROVENANCE.md`.

## Embedding robustness (review of 2026-11-21)

- **No inline style markup.** Every style is a CSSOM write (`render/dom.ts`), so `style-src 'self'` works; the element
  adopts a constructable stylesheet. Each created element (root, canvases, separators, hidden help and live region)
  resets margin, padding, border, sizing and max-width with `!important`, so page rules do not reach it. The
  attribution link sits in a closed shadow root and the input layer leaves pointer input on it alone (pointer capture
  starts only once a press becomes a drag).
- **Direction.** The root is `dir="ltr"` and text contexts are `direction = 'ltr'`.
- **Wheel.** `wheelAction` in `chart/input.ts` (pure): `'auto'` zooms on a plain vertical wheel only with focus
  (`:focus-within`, which works inside shadow roots) or when no ancestor can scroll that way.
- **Ids** are `chartist-lite-<counter>-<random>`, unique when two copies of the library load.
- **Checks.** Pure parts in `src/__tests__/review-fixes.test.ts`; DOM parts in `scripts/screenshots-review.cjs` with the
  page `examples/hostile/` (strict CSP, RTL, hostile CSS).

## Default look (polish of 2026-11-21)

Restrained, after iOS / macOS Stocks: calm ink, colour only where it carries direction.

- **Theme tokens** (`core/theme.ts`): `up` / `down` are mark colours tuned per theme (light `#26A148` / `#E0262F`, dark
  `#2FBE57` / `#F2463B`); `upText` / `downText` are the text variants (at least 4.5:1, tested); `volume` is a quiet ink
  (16% light, 18% dark) that histograms use by default; grid 7% ink.
- **Axes**: price labels and minor time labels in `mutedText`, major time labels (year, month, session date) in `text`
  at weight 600; figures are centred on their own ink (`TextPainter.baselineShift`), so tag text sits in the middle at
  any DPR. Vertical grid lines are off by default (`grid.vertLines`), horizontal on.
- **Candles**: about 30% of the spacing is gap, never under one device pixel; wick and body share the colour.
- **Area**: an eased three-stop fade to transparent (only when no custom colours are given).
- **Crosshair**: fades in over 120 ms (overlay `globalAlpha`, a few overlay frames; at once under reduced motion).
- **Legend** (`chart/legend.ts`): one DOM box per pane at the top-left of the plot, in an open shadow root with
  important CSSOM resets (CSP-safe, page CSS cannot reach it). Line 1: the first titled series (OHLC with the change
  from the previous close, sign, arrow and direction colour; or its value); line 2: the other titled series. Hovered bar,
  else each series' last bar. Written only when its text changes (`syncLegends`, after each frame). `legend: false` hides it;
  a press on it selects text instead of panning (`isLink`).
- **Empty chart**: `localization.noDataText` (default 'No data') centred in the top pane.
- **Pane separator**: a 1 px hairline on the canvas, an 11 px invisible DOM hit area.

## Frame budget (120 Hz / 144 Hz, 2026-11-21)

`npm run bench` (`scripts/bench.cjs`, page `scripts/bench-page.html` + `bench-page.js`) measures the COST of one frame
on the production build: input handlers, every queued `requestAnimationFrame` callback (the bench runs them itself), and
style / layout of DOM the frame wrote; canvas rasterisation is forced after each frame and reported apart (headless has
no GPU). Results: `docs/PERFORMANCE.md`, `docs/performance.json`; exit 1 when a p95 is over 8.33 ms. What keeps it there:

- **Typed fast path for dense drawing.** `SeriesModel` keeps `vals`, `lows`, `highs` (Float64Array per row) and the
  scope passes them with `slots`, `xOrigin`, `xStep` (x of row i = `xOrigin + xStep * slots[i]`), plus `valueBlocks`
  (min / max per 32 rows). The folded line, candle and histogram loops read these instead of row objects and closures,
  and skip whole blocks inside a pixel column. Lines fold per CSS pixel and draw one or two vertices per column (each
  canvas call crosses into the browser).
- **Autoscale from cached extremes.** `SeriesModel.extents(a, b)` uses per-128-row min / max blocks, invalidated by
  block on `update()`, so a live tick with 100k bars in view does not rescan them (log mode keeps the plain scan).
- **One paint per frame, no timers.** Passive pointer listeners (only wheel, dblclick and keydown can cancel), the
  latest pointer position painted by the next frame, time-based kinetic scroll and crosshair fade.

## Plugin input hooks and drawing tools (2026-11-21)

Core hooks (additive): `chart.addPointerHandler(handler)` returns a remover; a `ChartPointerHandler` may implement
`pointerDown(e)` (return true to own the gesture: its moves and release go to `pointerMove` / `pointerUp`, the chart does
not pan or zoom), `hover(e)`, `keyDown(e)` (asked before the chart's own keys; return true when handled) and
`blocksTouch()` (true turns `touch-action` to none). `chart.setCursor(cursor | null)` forces the cursor.
`ChartPointerEvent` carries `point` (plot / pane-relative), `paneIndex`, fractional `logical`, `area`, `pointerType` and
the modifier keys. `timeScale().timeToLogical(time)` / `logicalToTime(logical)` interpolate between bars and extrapolate
past either end at the median bar interval, so anchors in time survive zoom, resize, time zone and data changes.
`PrimitiveHost.requestOverlay()` repaints only the overlay; `PrimitiveDrawScope.seriesRowAt(time)` reads a row.

Entry `lite-charts/drawings` (`src/drawings/`, IIFE global `ChartistLiteDrawings`):

| File | Role |
|---|---|
| `geometry.ts` | pure: distances, line clipping (segment / ray / extended), simplification, arrow heads, 45-degree constraint, Fibonacci, measure and position figures, magnet (nearest O/H/L/C) |
| `tools.ts` | the catalogue (`TOOLS`), `renderDrawing` / `renderLabels` (CSS px, crisp axis-aligned edges), `hitDrawing` (handle index, `BODY` or -1), `handlePoints`, `paintBox` (culling) |
| `controller.ts` | `createDrawingTools`: state, pointer and key handling through the hooks above, one series primitive per pane (main layer for settled drawings, overlay for hover, selection, the drawing being created and the one being dragged), undo / redo (snapshots, 100 deep), events (`hidden` when hide all changes), versioned JSON, opt-in `persist`; `setShortcuts(on)` (option `shortcuts`, default on) turns the letter keys and Shift + H off and on, `setToolbarVisible(on)` hides the rail without destroying anything (a host's closed drawing panel) |
| `toolbar.ts` | the optional rail, style bar and text editor (shadow DOM, CSSOM styles, roving tab index). One rail button per `TOOL_GROUPS` entry (cursor; Lines; Shapes; Fibonacci; Measure; Positions; Annotate), then switches (keep drawing, magnet, hide), then history and delete all, set apart; a multi-tool group opens a `role="menu"` flyout (press and hold, the corner mark, or the arrow away from the rail) and shows its last used tool. 28 px controls, 4 px gaps, 6 px padding, radius concentric; one column (or row) that scrolls inside itself with edge fades. It re-lays out when the top pane's box changes. Single-key shortcuts: `TOOL_KEYS` in `tools.ts` |

**Writing a tool of your own** (outside this entry): a `ChartPrimitive` attached to a series paints it (main layer in
`draw`, feedback in `drawOverlay`); a `ChartPointerHandler` creates and edits it. Anchor points in time and price:
`timeScale().timeToLogical(time)` then `logicalToCoordinate`, and `series.priceToCoordinate(price)` for hit testing in
the pointer's coordinates; in `draw`, `scope.logicalToX(logical)` and `scope.priceToY(price)` (chart coordinates). While
something moves, repaint with `host.requestOverlay()` and paint the moving thing in `drawOverlay`, so the main layer is
not redrawn on every pointer move. Inside this entry, a new tool is one `TOOLS` entry plus a case in `renderDrawing`,
`hitDrawing` (and `renderLabels` / `handlePoints` when it has labels or special handles).

## Live data (2026-11-21)

Entry `lite-charts/live` (`src/live/`, IIFE `ChartistLiteLive`). The core never imports it and makes no
network requests; the plain element build does not contain it (the element-live build does).

| File | Role |
|---|---|
| `providers.ts` | `LiveProvider` interface; built-ins `coinbase`, `binance`, `kraken`; pure parsers (`parse*`) tested on real samples in `__fixtures__/`; symbol maps |
| `bars.ts` | `BarBuilder` (trades into time buckets; late trades dropped, duplicate ids counted once; streamed bars replace their time) and `backoffMs` |
| `connect.ts` | `connectLive`: history, stream, reconnect, backfill, pause, older history, status |

`connectLive(series, options)` returns `{ status(), provider(), symbol(), interval(), setInterval(i), setSymbol(s),
loadOlder(), disconnect() }`. Options: `symbol` ('BTC-USD'), `interval` ('1m' | '5m' | '15m' | '1h' | '6h' | '1d'),
`provider` (a built-in name, tried first with the others as fallback when its history fails, or your own provider used
alone), `volumeSeries`, `chart` (older history when the view reaches the left edge), `history` (500), `onStatus`,
`onError`, `onBars`, and injection points `fetch`, `WebSocket`, `env` (frames, timers, random, clock, document,
window). Statuses: 'connecting' | 'live' | 'reconnecting' | 'offline' | 'error'.

- **Once per frame.** Ticks update a builder; changed bars wait in a map and one `requestAnimationFrame` hands them to
  `series.update()` (and the volume series) in time order.
- **Reconnect.** A stream that closes reconnects after a jittered exponential wait (1 s doubling to 30 s, +/- 30%); the
  reload of history backfills the gap with `update()` (or `setData` when the gap is longer than the history).
- **Pause.** A hidden tab or an offline browser closes the stream and aborts requests (status 'offline'); showing the
  tab or coming online reloads and resubscribes.
- **Generations.** Every start bumps a generation number; anything from an older one (a late fetch, a closing socket)
  is ignored. Every fetch has an AbortController. `disconnect()` closes the socket, aborts, clears the timer, cancels
  the frame and removes every listener.
- **Never throws into the page.** Errors go to `onError`; host callbacks are wrapped.

A provider of your own: `{ id, intervals, canPageBack, history(symbol, interval, { limit, before? }, { fetch,
WebSocket, signal }) => Promise<LiveBar[] ascending>, subscribe(symbol, interval, { tick, open, closed }, { fetch,
WebSocket }) => close }`. `tick` takes `{ kind: 'trade', time, price, size, id? }` or `{ kind: 'bar', bar, closed }`.

Element: `<chartist-chart live symbol="BTC-USD" interval="1m" provider="coinbase" volume>` with
`chartist-lite.element-live.iife.min.js`; a status dot and word sit at the top right of the plot; `symbol` and
`interval` changes switch the stream; removal disconnects. React, without a hook of ours: create the chart in an effect
(or use the React wrapper's `onReady`), call `connectLive(series, options)` there, and return `() => live.disconnect()`
as the effect's cleanup.

## Core additions for the widget (2026-11-22, all additive)

| API | What |
|---|---|
| `timeScale().setVisibleSpan(span)` | Show a span that ends at the last bar, read in the chart's zone: '1D' / '5D' (the last n SESSIONS in the data), '1W', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All', or `{ days / weeks / months / years }`. At least five bars. Pure maths in `core/span.ts` (the one source: the extras' range switcher and `rangeStartDay` call it). Kept like any view request when there is no width or data yet |
| `timeScale().isAtRealTime()`, `subscribeRealTimeChange(fn)` / `unsubscribeRealTimeChange` | The newest bar is in view (`rightOffset >= -0.5`); the event fires once per painted frame when it changes. The extras' go-to-realtime button and the widget's "latest" key use it |
| `chart.onRemove(fn)` | Called once when `remove()` runs, before the chart's own teardown (plugins drop document listeners there); returns an unsubscribe |
| `ChartPointerHandler.longPress(e)` | A touch held still for `LONG_PRESS_MS` (350): return true to own the gesture (the chart stops panning). The timer is armed only while some handler implements it |
| `series.subscribeDataChanged(fn)` / `unsubscribeDataChanged` | After `setData` ('set') and `update` ('update', row): several plugins can watch one series without wrapping its methods (price alerts use it) |
| `SeriesDefinition.lastValueColor(row, options, colors, prev?)` | The row before, for a tag coloured by change (hollow candles) |

Full screen needs no core change: the chart follows its container (ResizeObserver), checked in
`scripts/screenshots-widget.cjs`. The irregular-time axis for brick types is the next section.

## Ordinal (brick) time axis (2026-11-22)

Renko, line break, Kagi, point and figure and range bars make rows that are not evenly spaced in time, several from
one source bar. **Design: a flag carried by the series definition** (`SeriesDefinition.ordinal: OrdinalAxis`), set by
`applyChartType` through `ordinalSeries(def)` (transforms entry, cached per definition so `===` holds). Why not a chart
option: the axis mode follows from what is drawn, so `applyChartType` -> `addSeries` -> `setData` is enough, the
widget's type switch needs no extra call, a definition from another bundle (the widget loading the transforms IIFE)
still works (structural check), and the label rule rides on the definition, so only brick users pay for it.

- **Lead.** The first series on the chart whose definition has `ordinal` (`Chart.lead`, a getter) makes the axis:
  `TimeIndex.rebuild(..., ordinal = true)` copies its times as they are (non-decreasing, repeats kept), one slot per
  row. With no such series the axis is the calendar union, unchanged.
- **Other series** must share the lead's rows: row i at slot i (`SeriesModel.remap`). `setData` / `update` of a
  non-lead series throws when row i's time differs from slot i's (`alignError`; checked before anything changes).
  Rows past the lead's end are kept off the axis (`pos = OFF`, never in `rowRange` / `rowAtSlot` / `lastRow`) and
  placed when the lead appends that row. When the lead's data change, rows of others that stop matching go `OFF` until
  their next `setData` (the widget re-sets volume and indicators right after). Repeated times are accepted only on an
  ordinal chart (`dup`).
- **update / pop.** Same time as the last row replaces it (as before); `{ append: true }` appends a row with the same
  time (O(1): `TimeIndex.append`, calendar read for one slot, `minGap`). `pop(n)` removes rows: on the lead O(n)
  (`TimeIndex.truncate`, day / month start lists trimmed, others' rows past the end `OFF`, a scrolled-back view kept
  still); on a calendar chart the axis is rebuilt. `applyDelta(series, delta, map?)` (transforms) applies an
  incremental transform's `{ from, rows, removed }`.
- **Times.** `indexOf` / `lowerBound` give the FIRST slot of a repeated time (`timeToCoordinate`, primitives'
  `timeToX`, `seriesRowAt`, markers). `setVisibleRange` uses `lowerBound(to, upper)` so every slot dated `to` is in.
  `setVisibleSpan` and `spanFirstIndex` need no change: the first brick whose source date is in the span. `timeOf` /
  `logicalOf` (TimeIndex, used by `logicalToTime` / `timeToLogical`) give slot a+j (the j-th brick after the first of
  time T) the virtual time `T + span * j / (j + 1)`, span = smallest positive gap between slots (`minGap`; one day for
  business days, 60 s, when there is none), piecewise linear between slots and `span` per slot past either end. It is
  strictly increasing and one-to-one, a brick keeps its virtual time when bricks are appended, and in calendar mode
  (j always 0) it is the old interpolation exactly (tested against the legacy formula).
- **Kind.** `inferTimeKind(times, n, ordinal)` reads the smallest positive gap on an ordinal axis (the closest thing
  to the source interval the bricks show); zero gaps never count.
- **Labels.** `planTimeTicks` takes `tickText` (the lead's `ordinal.tickText`) and calls it once per candidate after
  the hierarchy pass; cadence and layout are unchanged, so the longer texts keep fewer labels. A repeated time is
  never a boundary (keys equal), so ticks sit on the first brick of a date. The rule (`brickTickText`, ported from the
  host): year label -> `Aug 2020` unless the brick is in January; month label -> `17 Mar` past day 7; others unchanged.
- **Readers.** Crosshair tag, legend, inspect mode and `MouseEventParams` read the row at the slot (true date).
  Tooltip (extras) resolves the hovered brick by `logical` (n-th row of its time), kind via `kindOfRows(rows, true)`.
  Session breaks (extras) are off (`isOrdinal()`). Drawings: anchors are `{ time, price }` through
  `timeToLogical` / `logicalToTime`, so a point on a brick keeps its brick; switching candles <-> Renko maps by source
  time (nothing hidden or destroyed; back on Renko a point returns to the same brick); the magnet and the bar-reading
  tools (regression, VWAP, profile, ranges) address bricks by slot (`BarAccess.times` are the virtual times).
- **Widget.** Volume from the transform's rows; indicators computed on the bricks (`indRows`) when `isOrdinal()`,
  Heikin Ashi and series looks on the source bars; compare lines kept but empty on a brick axis; an indicator output
  that cannot line up is left empty. Replay stays off for transforms.
- **Cost.** Core +0.9 KB gzip (34454 -> about 35380 bytes; budget 34 -> 34.6 KB); the rule itself is in the transforms entry. Bench scenario
  `renko`: 10k bricks, crosshair, pan, zoom, live tick through `createRenko` + `applyDelta`, fit.
- **Fallback.** `applyChartType(..., { calendarTime: true })`: the plain definition and `spreadTimes` (next second /
  next day after the previous row); `info.shifted` counts moved rows (0 on the brick axis).
- **Checks.** `src/__tests__/ordinal-axis.test.ts` (index, model, planner with the host's cases plus one-day groups, a
  ten-year gap, DST, a single brick, one intraday day, business days; incremental + `applyDelta`);
  `scripts/screenshots-chart-types.cjs` (labels of a constructed series, crosshair / tag / inspect on a repeated
  brick, no cut or overlapping label, ranges and spans, live bricks without the axis jumping);
  `scripts/screenshots-widget.cjs` (indicators and volume on bricks, drawing round trip, save).

## Widget (2026-11-22)

Entry `lite-charts/widget` (`src/widget/`, IIFE `ChartistLiteWidget`; one-tag terminal build
`chartist-lite.terminal.iife.min.js`, global `ChartistLiteTerminal`, with live data and drawings bundled and both tags
registered on load). `createWidget(container, options)` builds a whole workspace around one chart.

| File | Role |
|---|---|
| `widget.ts` | `createWidget`: state, data (rows, a feed, or live crypto), chrome, menus, dialogs, indicators, keyboard, undo, persist, API |
| `types.ts` | public types (options, feed, handle, workspace JSON) |
| `strings.ts` | every visible word (`strings` option), `{x}` placeholders |
| `styles.ts` | the one stylesheet, adopted as a constructable sheet in the shadow root (CSP-safe); tokens on `.w`, `.dark` switches |
| `dom.ts` | element builders; `Layers`: menus, sheets and dialogs (focus in, Tab trapped in dialogs, arrows in menus, Escape returns focus) |
| `layout.ts` | pure: `collapseBar` (priority collapse into More), `useSheets` |
| `intervals.ts` | pure: interval text, seconds, digits, `intervalForSpan`, `barsForSpan` |
| `workspace.ts` | pure: `readWorkspace` (versioned, migrates v1, drops bad fields), `validateParams` |
| `chart-types.ts` | the transforms' `CHART_TYPES` / `applyChartType` (built in), core fallback, glyph per type |
| `demo.ts` | seeded demo bars and the built-in crypto list |
| `icons.ts` | the widget's own 24-grid, 1.8-unit, round-capped single-colour icons |
| `element.ts` / `auto.ts` | `<chartist-terminal>`; the terminal IIFE (also makes `<chartist-chart widget>` work) |

**Lazy by design.** The entry imports the core, the indicator catalog and the chart types. Drawings, live data and the
extras come only through `modules` (handed in) or `load` (`{ drawings: () => import('lite-charts/drawings') }`, called
the first time the part is needed: the pencil key, the bell, Replay, a tooltip or watermark setting, live mode). A page
that never draws never downloads the drawing code (checked in the browser test).

**The terminal's extras, on first use** (`auto.ts`). The terminal IIFE bundles drawings and live data but not the
extras; it hands every widget (and every `<chartist-terminal>`, through `setTerminalLoad`) `load.extras = loadExtras`.
URL: `setAssetBase(folder)` wins; then the terminal tag's `data-extras` (a URL, or `off`); then the terminal file's own
folder (`chartist-lite-extras.iife.min.js` next to it). The tag is `document.currentScript` captured while the IIFE
runs, else the first script whose file name is the terminal's, else one carrying `data-extras` (a module script or a
renamed file); with none of these the load rejects with code `extras-url` and the tip says to set `data-extras`. One
`<script src async>` (no inline, no eval; the tag's `nonce` copied; `data-extras-integrity` adds `integrity` and
`crossorigin="anonymous"`), one shared promise for every widget and caller; a failure clears it, so the next use
retries. The widget keeps the last loader error per module (`loadErrors`) for its tip, and shows a quiet tip when the
extras fail for alerts, tooltips / watermark / session breaks or Replay. The ESM entry's `modules` / `load` are
unchanged. Checked in `scripts/screenshots-widget.cjs` with `examples/widget-terminal.html` (two tags; file:// and a
routed http origin; module script; renamed file; failure and retry; `data-extras` URL and `off`) and on the site's hero.

**Chrome.** All DOM in one open shadow root on a host div; `:host { all: initial }`; one tone of flat bars (top bar,
bottom bar) around the plot, a rounded card inset 6 px. Controls 28 px
(44 px on a coarse pointer), capsules, inverted ink for the selected state, plain-text interval / range / scale keys
(selected in full ink at 600). Responsive: each bar measures its items on a resize (never per frame) and `collapseBar`
moves the lowest priority into More (top: compare 20, redo 29, undo 30, alert 32, theme 35, screenshot 40, full screen
42, draw 60 (89 while drawing), settings 70, chart type 85, indicators 88, interval keys 90; with the keys hidden the
menu button names the interval); under 560 px (or a narrow coarse pointer) menus and dialogs are bottom sheets.

**Drawing bar** (`.lbar` in the stage, `.tbar` a grid row between the stage and the bottom bar). The drawings entry's rail mounted in the chrome
through `toolbar: { container, variant, styleContainer }`: on a desk a flat left column (`--h` + 16 px wide, the
buttons on the top bar's 8 px line, the card's left edge 6 px past them), on the sheet breakpoint a row of `--h` +
12 px above the bottom bar that scrolls sideways (the grid shortens the plot). The bar has no surface of its own (the
`.w` tone shows through); class switches only (`.rail`, `.tray`, fade in / out by opacity), so opening costs one resize
of the chart and no per-frame layout. Pencil on: load the module (first time), show the bar, create the tools with
`ALL_TOOLS` (or `drawings.tools`), or show them again (`setToolbarVisible(true)`, `setShortcuts(true)`). Pencil off:
`setTool(null)`, `setShortcuts(false)`, fade, `setToolbarVisible(false)`; the tools stay, so drawings stay painted,
selectable, movable and deletable (Delete, arrows, Ctrl/Cmd+Z in the one widget stack; letters go back to the widget;
touch is blocked only while one is selected). The tools are also made with the rail closed when the workspace holds
drawings to show (saved, `persist` or `load(json)`, not hidden): the module loads for them, and only then; if it fails,
a tip says so and the pencil turns off. The eye (hide all) is `drawingsHidden` in the workspace, applied to new tools. A
breakpoint flip seen by `relayout` with the rail open destroys and recreates them for the other place (closed: when it
next opens). Drawing events push one widget history entry per synchronous turn (a delete-all emits one event per
drawing but is one undo step of the tools). The style bar of the selected drawing mounts in the top
bar's spacer; while a drawing is selected the collapse reserves room for its compact form (and the pencil's priority
rises to 89 while drawing, so it stays in sight). Flyouts open in the chart's own shadow root, at the chart's left edge
beside the column (`placeFlyout` for a button outside the chart) or upwards from the phone row. Tab order: top bar, the
rail (one stop, roving index), the chart. The widget's `pointerdown` listener runs in the capture phase (the rail stops
bubbling so the chart does not pan; open menus must still close). The open state is `drawingsOpen` in the workspace.
Cost with the rail closed: the same primitives and pointer handler as open, minus the toolbar's DOM (checked per pointer
step with 20 drawings in `scripts/screenshots-widget.cjs`).

**Indicators.** Specs from the catalog; outputs become line or histogram series (a histogram with tone 'line' is
coloured by sign), `band-upper` / `band-lower` pairs get a shaded fill primitive on price, guides become dotted price
lines. Placement 'overlay' (price pane; an oscillator on price gets its own overlay scale) or 'pane' (own pane, panes
follow list order). Legend rows are widget DOM over the card (the chart's own legend shows only the main series):
values of the hovered bar, written only when the text changes; hover (or tap) shows hide, settings, remove, and on a
pane's first row move up / down, maximise, close. A primitive's `draw` notices pane height changes and re-places the
rows in the next frame (no DOM read while nothing moved).

**Data.** `data` rows; or `feed.getBars` (+ `subscribeBars`, `searchSymbols`); or `live` (connectLive through its public
API with a proxy series, so chart types and indicators work on live bars; demo data, said in the status, if every
provider fails). Range keys pick a fitting interval from what the feed or provider offers and ask for enough bars.

**Keyboard.** Chart focused or chrome focused: `/` symbol search (letters too, except on the chart while the drawing
tools own the letter keys), `,` interval menu, Alt+I indicators, Alt+S screenshot, digits then Enter an interval in
minutes (60 = 1h, 1440 = 1D; Escape clears), Ctrl/Cmd+Z and Shift+Z undo and redo (widget changes and drawings, one
stack). None clashes with the chart's keys (arrows, + -, Home, End, Enter, Space, Escape) or the drawing tools'
letters. Interval and range keys are radio groups (one tab stop, arrows).

**Persist** is opt-in (`persist: { key }`): the workspace JSON (`format: 'chartist-lite-workspace'`, version 2) in
localStorage under `chartist-lite-workspace:<key>`, written 300 ms after a change; read at start and wins over the
options. `save()` / `load(json)` do the same by hand.

**Alert chips that crowd** (`createPriceAlerts`, extras). `layoutAlertChips(lines, { height, gap, top, bottom,
maxStack, obstacles })` (pure, tested) places the chips along the pane: each on its line when free; overlapping ones
stacked edge to edge around the mean of their lines, inside the pane and out of obstacle bands, in price order (ties:
insertion order), so the result depends only on the lines (no jitter while prices tick). A stack of more than
`maxStack` (5) chips, or more than fit, collapses into one group at the mean of its lines. A chip moved more than 2 px
keeps a thin leader to its line. The dragged alert is left out of the layout and drawn last, on its own line (the
others settle around the remaining lines; nothing moves under the pointer). Groups are DOM: one "N alerts" button per
group (44 px on a coarse pointer) in a `createHost` shadow root, opening a list (price, state, remove; keyboard: the
chip focuses into the list with Tab, Escape returns) on hover, focus or tap. The DOM is rewritten only when the
groups, their places, the list or the theme change: no DOM read, no layout per frame (checked: zero layout passes in a
drag through a pair). Axis tags: one per alert outside a group, one per group at the mean of its prices; the chart's
own tag pass (sorted, pushed apart by a tag height, kept in the pane) separates them. The last-price tag is in the
axis, where chips never go, so it is not passed as an obstacle (passing the moving price would make chips jump).
`placements()` reports the last layout. Touch: the nearest chip within 22 px takes a press.

**Price alerts in the workspace.** Optional field `alerts: { version: 1, bySymbol: { [symbol]: [{ id, price,
triggered, direction?, value?, time? }] } }`, per symbol only (a level means nothing for another symbol; the same for
every interval). `normalizeAlerts` (pure, `workspace.ts`) keeps what checks out: ids `[A-Za-z0-9_-]{1,32}` unique per
symbol, finite prices above zero, trigger details only on a triggered alert; `ALERT_LIMITS` 100 per symbol, 1000 in
all, 200 symbols; junk is dropped, never thrown. The widget's `alertStore` (every symbol) is the truth `save()` writes;
the extras' handle shows the current symbol's (imported on a symbol change, an undo / redo or a load) and reports
changes back (`onChange`: an undo step for an add, move or removal; a trigger is saved but is not an undo step, and an
undo / redo never re-arms a trigger that happened since). The handle runs with `watch: false`: the widget calls
`check(close, time)` with the source bar's true last price in `updateRow` (Renko and the other brick types fire on the
real price, not a brick edge) and `rebase()` after new history, so nothing fires from history: alerts watch only while
the page is open (an armed level crossed while the page was closed stays armed). Writes go through the 300 ms
debounce on changes only; a tick that crosses nothing writes nothing. Lazy: the extras load at start only when the
current symbol has saved alerts; if they fail, a tip says so and the store (hence the next save) keeps the alerts.
Events: `'alert'` once per firing (`{ id, symbol, price, direction, value, time }`) and `'change'`. Replay in the
widget feeds the series, not the source bars, so it fires no alerts.

**Performance.** No widget work per frame beyond the legend text of the hovered bar and one comparison of pane heights.
Bench scenario `widget` (10k bars, SMA + Bollinger + RSI, volume): see `docs/PERFORMANCE.md` (script cost only,
rasterisation not included).
