---
title: Theming
description: Light, dark and automatic themes in Chartist Lite: override colours and fonts, switch themes at runtime, and what the attribution link is.
order: 7
related: accessibility, plugins, api-reference
group: customise
task: Match your brand
summary: Dark and light, colour overrides, fonts, the legend and the attribution link.
---

# Theming

## Light, dark and auto

```js live height=320 controls=theme
const chart = createChart('chart', { theme: 'auto' });
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
```

`theme` is `'light'` (the default), `'dark'` or `'auto'`. `'auto'` follows the visitor's `prefers-color-scheme` setting and repaints when it changes. On this site the live examples follow the site's own theme toggle instead; the buttons above switch this one chart. Switch at any time:

```js
chart.applyOptions({ theme: 'dark' });
```

Series colours that you did not set explicitly follow the theme, so a switch recolours candles, lines and last-value tags. A colour you did set stays; if you set series colours per theme, set them again in the same handler. The histogram rows of the [series guide](series-types.md) carry their own colours, so refill them on a theme switch.

## The built-in palettes

`lightTheme` and `darkTheme` are exported as plain data (`ThemeColors`):

| Key | Used for |
|---|---|
| `background` | Chart background |
| `text` | Axis text |
| `mutedText` | Secondary text, such as the attribution link |
| `grid` | Grid lines |
| `paneSeparator` | The line between stacked panes |
| `crosshair` | Crosshair lines |
| `tagBackground`, `tagText` | Crosshair axis tags |
| `up`, `down` | Rising and falling candles, bars and tags |
| `upText`, `downText` | Text and arrows of a rise or fall, such as the change in the legend; at least 4.5:1 on the background |
| `volume` | Default colour of a histogram: a quiet ink that sits behind the price |
| `line` | Default colour of a line series |
| `focusRing` | Keyboard focus ring |

The palette follows Apple's system colours: green and red for up and down (darker variants for text), blue for lines, and no purple. The light background is white and the dark one `#141414`.

## Overriding colours

```js live height=280
const chart = createChart('chart', {
  colors: { up: '#0A84FF', down: '#FF9F0A' },
});
chart.addSeries(CandlestickSeries, { title: 'Blue and orange' }).setData(bars);
```

`colors` is a partial `ThemeColors` applied over the built-in theme, light and dark alike. If you need different overrides per theme, call `applyOptions({ colors })` together with the theme switch. Check contrast yourself when you override: the library does not validate it. Inside the library, text on a coloured tag is picked as black or white for contrast with that fill; that helper is not exported.

## Fonts and sizes

```js
createChart('chart', { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13 });
```

The default `fontFamily` is the system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`), so no web font is loaded. `fontSize` is in CSS pixels and is never below 12: a smaller value is raised to 12. Numbers are drawn with tabular figures so columns of prices line up.

## Grid, crosshair and axes

| Option | Values |
|---|---|
| `grid` | `{ vertLines: boolean, horzLines: boolean }`; by default only the horizontal lines are drawn (`vertLines: false`) |
| `legend` | `{ visible: boolean }`; the built-in legend, on by default (see below) |
| `crosshair.mode` | `'normal'` follows the pointer, `'magnet'` snaps the horizontal line to the first series' value, `'hidden'` |
| `crosshair.labels` | Axis tags under the crosshair lines |
| `rightPriceScale`, `leftPriceScale` | `{ mode: 'linear' \| 'log' \| 'percent', autoScale, scaleMargins: { top, bottom }, visible }` |
| `timeScale` | `barSpacing`, `minBarSpacing`, `maxBarSpacing`, `rightOffset`, `visible`, `timeZone` |
| `interaction` | `wheelZoom` (`'auto'` default, `true`, `'modifier'`, `false`), `dragPan`, `pinchZoom`, `kinetic`, `keyboard`, `doubleClickReset` (default true) |

A fast drag keeps gliding after release; that is turned off under `prefers-reduced-motion`.

## The legend

Each pane has a small legend at its top left. It lists every visible series in that pane that has a `title`: a candlestick or bar shows `O H L C` and the change from the previous close, with an arrow and a sign (`▲ +1.20 (+1.10%)`); a single-value series shows a colour dot and its value. It reads the bar under the pointer, and the last bar when nothing is hovered. A pane with no titled series shows no legend.

```js
createChart('chart', { legend: { visible: false } });   // hide it
```

The legend is ordinary text (it can be selected and copied), drawn in the chart's font, size and theme colours, in its own shadow root so page CSS does not reach it. Price text in it follows `localization.priceFormatter` and each series' `priceFormat`.

## Size

The chart fills its container and follows it with a `ResizeObserver` (`autoSize`, on by default). To fix the size instead, pass `autoSize: false` with `width` and `height`, or call `chart.resize(width, height)`, which turns `autoSize` off. The canvas is sized in whole device pixels, and lines are placed on device pixels so they stay one crisp pixel at any device pixel ratio.

## The attribution link

By default a small text link, "Chartist", pointing to `https://mrchartist.com`, sits in the empty corner under the price axis, beside the time axis, so it never covers data. It is an option: nothing in the code forces it, and `attribution: false` hides it. The licence terms are in the `LICENSE` file.

```js
createChart('chart', { attribution: false });                          // hide it
createChart('chart', { attribution: { position: 'bottom-left' } });    // move it into the top pane
```

`position` is `'axis-corner'` (default; the top pane's bottom-left corner when no price axis is drawn), `'bottom-left'`, `'bottom-right'`, `'top-left'` or `'top-right'`. The link lives in its own closed shadow root, so the page's `a {}` rules cannot restyle it, and it can be clicked (the chart leaves pointer input on it alone). On the element it is `attribution="false"`. Keeping it is appreciated and costs one small link.

## Page theme and the chart together

Charts do not read your page's CSS. If your page has its own theme toggle, call `chart.applyOptions({ theme })` for each chart when it changes, or use `'auto'` if the page follows the system setting. The site you are reading does exactly this: the toggle at the top of the page switches the page and every live chart on it.
