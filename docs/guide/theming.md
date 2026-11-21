---
title: Theming
description: Light, dark and automatic themes in Chartist Lite: override colours and fonts, switch themes at runtime, and what the attribution link is.
order: 7
related: accessibility, plugins, api-reference
---

# Theming

## Light, dark and auto

```js
const chart = createChart('chart', { theme: 'auto' });
```

`theme` is `'light'` (the default), `'dark'` or `'auto'`. `'auto'` follows the visitor's `prefers-color-scheme` setting and repaints when it changes. Switch at any time:

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
| `line` | Default colour of a line series |
| `focusRing` | Keyboard focus ring |

The palette follows Apple's system colours: green and red for up and down (the higher-contrast variants where text sits on them), blue for lines, and no purple.

## Overriding colours

```js
createChart('chart', {
  colors: { up: '#1A7F37', down: '#CF222E', background: '#FAFAFA' },
});
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
| `grid` | `{ vertLines: boolean, horzLines: boolean }` |
| `crosshair.mode` | `'normal'` follows the pointer, `'magnet'` snaps the horizontal line to the first series' value, `'hidden'` |
| `crosshair.labels` | Axis tags under the crosshair lines |
| `rightPriceScale`, `leftPriceScale` | `{ mode: 'linear' \| 'log' \| 'percent', autoScale, scaleMargins: { top, bottom }, visible }` |
| `timeScale` | `barSpacing`, `minBarSpacing`, `maxBarSpacing`, `rightOffset`, `visible`, `timeZone` |
| `interaction` | `wheelZoom`, `dragPan`, `pinchZoom`, `kinetic`, `keyboard`, `doubleClickReset` (all default true) |

A fast drag keeps gliding after release; that is turned off under `prefers-reduced-motion`.

## Size

The chart fills its container and follows it with a `ResizeObserver` (`autoSize`, on by default). To fix the size instead, pass `autoSize: false` with `width` and `height`, or call `chart.resize(width, height)`, which turns `autoSize` off. The canvas is sized in whole device pixels, and lines are placed on device pixels so they stay one crisp pixel at any device pixel ratio.

## The attribution link

By default a small text link, "Chartist", pointing to `https://mrchartist.com`, is drawn on the chart at the bottom left. It is an option: nothing in the code forces it, and `attribution: false` hides it. The licence terms are in the `LICENSE` file.

```js
createChart('chart', { attribution: false });                          // hide it
createChart('chart', { attribution: { position: 'bottom-right' } });   // move it
```

`position` is `'bottom-left'` (default), `'bottom-right'`, `'top-left'` or `'top-right'`. On the element it is `attribution="false"`. Keeping it is appreciated and costs one small link.

## Page theme and the chart together

Charts do not read your page's CSS. If your page has its own theme toggle, call `chart.applyOptions({ theme })` for each chart when it changes, or use `'auto'` if the page follows the system setting. The site you are reading does exactly this: the toggle at the top of the page switches the page and every live chart on it.
