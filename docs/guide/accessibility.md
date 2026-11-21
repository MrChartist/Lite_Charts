---
title: Accessibility
description: Keyboard control, screen reader support, reduced motion and fallback content for crawlers in Chartist Lite, and what has and has not been tested.
order: 9
related: theming, getting-started, api-reference
---

# Accessibility

A chart drawn on a canvas has no text of its own. Chartist Lite adds what a canvas lacks: a focusable chart with a name and spoken help, keyboard control, and a live region that reads the bar you inspect. For the data itself, give crawlers and screen reader users ordinary page content.

## What the chart does

- **Focusable and named.** The chart root takes focus (`tabindex="0"`), has `role="application"` with `aria-roledescription="chart"`, and its accessible name is the `ariaLabel` option (default "Price chart"). Set a meaningful one: `createChart('chart', { ariaLabel: 'DEMO daily price' })`. On the element it is the `aria-label` attribute.
- **Spoken help.** The chart's accessible description is the `ariaDescription` option. The default reads: "Left and right arrows pan, plus and minus zoom, Home and End jump to the first and last bar. Press Enter to inspect bars one at a time with the arrow keys; Escape stops."
- **Inspect mode and a live region.** Enter (or Space) starts inspecting bars one at a time. Each step is announced politely through a live region as the bar's date or time followed by each series' values, for example "open 100.00, high 104.00, low 99.00, close 103.00" for a candlestick or the one value for a line. The announcement uses the series `title` as its name, so set titles.
- **Visible focus.** A focus ring in the theme's `focusRing` colour appears when focus comes from the keyboard.

## Keyboard

With the chart focused (and `interaction.keyboard` on, the default):

| Key | Action |
|---|---|
| Left, Right | Pan 2 bars (Shift: 20). In inspect mode, step 1 bar (Shift: 10) |
| `+` or `=`, Up | Zoom in |
| `-` or `_`, Down | Zoom out |
| Home, End | Jump to the first or last bar. In inspect mode, inspect the first or last bar |
| Enter, Space | Start or stop inspecting bars |
| Escape | Stop inspecting |

Keys with Alt, Ctrl or Meta held are left to the browser. Escape is not captured when you are not inspecting.

**Panes.** The divider between stacked panes is a focusable separator (`role="separator"`, labelled "Resize panes"); Up and Down move it by 8 CSS px, or 40 with Shift. See [Panes and scales](panes-and-scales.md).

## Pointer and touch

Drag pans, the wheel or a trackpad zooms at the pointer, two fingers pinch, double-click resets the view. By default (`wheelZoom: 'auto'`) a plain wheel over an unfocused chart scrolls the page instead of zooming, so a chart never traps a visitor scrolling past it; click or tab into the chart, or hold ctrl/cmd, to zoom. `touch-action` follows `dragPan` and `pinchZoom`, so a gesture the chart does not handle stays with the browser. Each can be switched off through the `interaction` options. A fast drag keeps gliding after release unless the visitor prefers reduced motion; then it stops when released.

## Text for crawlers and screen readers

The custom element shows its child content until the chart draws, then hides it. Put the facts there as an ordinary table:

```html
<chartist-chart type="line" src="/data/weekly.csv" aria-label="Weekly values">
  <table>
    <caption>Weekly values, sample data</caption>
    <tr><th>Week of</th><th>Value</th></tr>
    <tr><td>2024-01-01</td><td>100.00</td></tr>
    <tr><td>2024-03-18</td><td>120.70</td></tr>
  </table>
</chartist-chart>
```

This stays in the page source and shows normally for visitors without JavaScript, because browsers treat the unknown tag as an inline container. For a chart made with `createChart`, write the equivalent text next to the container yourself: a caption, a short summary of what the chart shows, or a table. Do not rely on the canvas for anything a reader needs to know.

## Colour and contrast

Candles, bars and the baseline series show direction in colour. The built-in palettes use Apple's system colours with higher-contrast variants where text sits on a fill. The contrast ratio of every colour pair was not measured as part of this package (Needs verification). If you override colours, check contrast yourself, and add text such as a legend or table so colour is not the only way to learn direction.

The smallest text the chart draws is 12 CSS px: `fontSize` is raised to 12 if you set less. Negative numbers use the true minus sign U+2212, which screen readers read as "minus".

## What has been tested

Tested in Chromium only (Playwright scripts in `scripts/`): the example pages draw, and the element, React and iframe embeds behave as [Embedding](embedding.md) lists. In Chromium, `scripts/screenshots.cjs` drives inspect mode (Enter, arrows, Home) and reads the live region's text, and `scripts/screenshots-review.cjs` checks the focus ring inside `<chartist-chart>`. Not tested: screen readers (no VoiceOver, NVDA or JAWS run is recorded), other browsers, forced-colours mode. Treat the roles and the live region as implemented but unverified with assistive technology (Needs verification).
