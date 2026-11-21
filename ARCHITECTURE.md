# Chartist Lite architecture

For contributors and stage-2 workers. Public README, licence and contributing guide are separate files.

## Commands (run inside `packages/chartist-lite/`)

| Task | Command |
|---|---|
| Install dev tools | `npm install` (TypeScript, Vitest, esbuild; no runtime dependencies) |
| Typecheck (sources and tests) | `npm run typecheck` |
| Unit tests | `npm test` |
| Build `dist/` | `npm run build` (ESM per entry, `dist/chartist-lite.iife.min.js` global `ChartistLite`, `.d.ts` in `dist/types/`) |
| Size | `npm run size` (each entry bundled + minified + gzip; fails if the core is over 45 KB gzip) |
| All of the above | `npm run check` |
| Browser smoke + screenshots | `npm run build && node scripts/screenshots.cjs` (needs Playwright importable on the machine; not a dev dependency, not in CI) |

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
  series/
    definition.ts     THE SERIES CONTRACT (types only)
    series-model.ts   one series' rows, times and slots
    candlestick.ts    candlestick definition
    line.ts           line definition
  plugins/
    primitive.ts      THE PRIMITIVE CONTRACT (types only)
  chart/
    chart.ts          the chart: DOM, state, scheduler, painters, public API implementation
    input.ts          pointer / wheel / touch / keyboard -> view operations
  indicators/ element/ react/   reserved subpath entries (empty in stage 1)
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

Layout (stage 1, one pane): pane = `[0, cssW - priceAxisWidth] x [0, cssH - timeAxisHeight]`, price axis on the
right, time axis at the bottom. The axis width is measured from its labels (hysteresis of 8 px so a pan does not make
it jitter). **Multi-pane is not built.** It is prepared for: price scales are per id and carry their own `height`,
primitives receive a `pane` rect, series receive a device `pane` rect, and the painter clips per pane; adding panes
means a `panes: { rect, scales }[]` list in `chart.ts` and a `paneIndex` series option, not a contract change.

## Render pipeline

1. Anything that changes the view calls `invalidate(mask)`: `OVERLAY` (crosshair, focus ring), `MAIN` (data, scales,
   options) or `LAYOUT` (size, DPR, theme, fonts). Masks are OR-ed and painted in ONE `requestAnimationFrame`.
2. `LAYOUT`: read the container size and `devicePixelRatio`, size both canvases (`render/canvas.ts`: whole device
   pixels, device-pixel-content-box when the browser reports it), resolve the theme.
3. `MAIN` (`paintMain`): `layout()` = time scale width and clamp, autoscale every price scale over the visible bars
   (series `low/high` + primitives' `autoscale`), price ticks, axis width (repeat up to twice if it changed), time
   ticks. Then paint: background, grid (1 device px), clip to pane, primitives `bottom`, series in add order,
   primitives `normal`, last-value price lines, primitives `top`, unclip, price axis (tick labels, last-value tags,
   primitive tags; tags pushed apart, labels under a tag hidden), time axis labels.
4. Overlay (`paintOverlay`, always after the above, and alone on a pointer move): crosshair lines, hover dots
   (`crosshairMarker`), primitives' `drawOverlay`, crosshair axis tags (the axis under a tag is blanked to whole
   labels), focus ring when focus is from the keyboard.

A pointer move costs one overlay repaint; it never redraws series. Only visible rows are touched (`rowRange` by binary
search, plus one row each side). Candles closer than 3 device px fold into one-pixel columns, lines closer than one
device px into per-column min/max, so a zoomed-out chart costs one rectangle or four path points per pixel column.
Scratch arrays in `candlestick.ts` are module-level and reused. Measured (Chromium, 1200 x 600, DPR 1, 100k
one-minute bars, `scripts/screenshots.cjs`): `setData` + fit + first paint about 35-41 ms; pan frames (2000 bars in
view) median 1.4-1.5 ms, worst 3.6-4.7 ms.

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
- `draw(scope)`: DEVICE pixels, identity transform, clipped to the pane, `ctx.save/restore` done by the chart.
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
pointer move, keep cheap), `priceAxisLabels()` (tags on the axis), `autoscale(range)`. Scope gives `timeToX`,
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
