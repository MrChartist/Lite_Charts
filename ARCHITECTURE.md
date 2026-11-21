# Chartist Lite architecture

For contributors and stage-2 workers. Public README, licence and contributing guide are separate files.

## Commands (run inside `packages/chartist-lite/`)

| Task | Command |
|---|---|
| Install dev tools | `npm install` (TypeScript, Vitest, esbuild; no runtime dependencies) |
| Typecheck (sources and tests) | `npm run typecheck` |
| Unit tests | `npm test` |
| Build `dist/` | `npm run build` (ESM per entry; IIFE globals `ChartistLite` (`chartist-lite.iife.min.js`), `ChartistLiteIndicators` (`chartist-lite-indicators.iife.min.js`), `ChartistLiteElement` (`chartist-lite.element.iife.min.js`, registers `<chartist-chart>` on load); `.d.ts` in `dist/types/`) |
| Size | `npm run size` (each entry bundled + minified + gzip, and the three IIFE files as built; fails if the core is over 45 KB gzip) |
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
    time-index.ts     the shared time axis: sorted union of all series times + calendar fields per slot
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
    input.ts          pointer / wheel / touch / keyboard -> view operations
  indicators/         `./indicators` entry: pure indicator functions and incremental forms (no chart import)
  element/            `./element` entry: `<chartist-chart>` (`defineChartistElement`; `auto.ts` registers on load for the IIFE)
  react/              `./react` entry: `createChartistReact(React)`, React injected, never a dependency
  render/dom.ts       CSSOM style writes with `!important` resets (CSP-safe, immune to page CSS)
```

Dependency direction: `core` and `scales` are pure and import nothing from `render`, `series` or `chart`.
`series/*.ts` definitions import only `core`, `render/pixel.ts` and `series/definition.ts`. `chart/` imports
everything. Nothing imports `chart/` except `index.ts`.

## Coordinate systems

| Space | Unit | Origin | Used by |
|---|---|---|---|
| Time | seconds (business day = UTC midnight) | epoch | data, `TimeIndex.times` |
| Logical | slot index on the shared axis (float allowed) | first distinct time = 0 | time scale, primitives (`logicalToX`) |
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

Entry `@mrchartist/chartist-lite/indicators` (`src/indicators/index.ts`). Pure functions, no chart import:
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
