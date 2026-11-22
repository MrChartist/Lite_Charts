---
title: Indicator catalogue
description: Every one of the {{indicators}} indicators in the Chartist Lite catalogue, searchable and filterable, with category, inputs, defaults, outputs and a live preview.
order: 10.5
related: indicators, widget, api-reference
group: reference
layout: wide
task: Find an indicator and its inputs
summary: All {{indicators}} indicators with their category, inputs, defaults and outputs, and a live preview of each.
---

# Indicator catalogue

Every indicator of the `indicators` entry, read from its catalogue when this page was built. Type to filter, pick a category, and choose a name to see it live on demo data above the table. The ready-made chart's indicators dialog is built on the same list.

## The catalogue

@@CATALOGUE@@

## Use an entry from code

```js live height=360
import { createChart, CandlestickSeries, LineSeries } from 'lite-charts';
import { getIndicator, legendLabel } from 'lite-charts/indicators';

const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);

const spec = getIndicator('supertrend');
const params = { period: 10 };
const out = spec.compute(bars, params);            // one array of rows per output
for (const o of spec.outputs) {
  chart.addSeries(LineSeries, { title: `${legendLabel(spec, params)} ${o.label}`, lineWidth: 2 }, spec.overlay ? 0 : 1)
    .setData(out[o.key]);
}
```

`INDICATORS` is the whole list and `getIndicator(id)` one entry: `{ id, name, shortName, category, overlay, inputs, outputs, guides, compute }`. `compute(rows, params)` never throws: every input is clamped to its declared range, an unusable value takes the default, and every output has one row per input row (`{ time }` alone while a window fills). `legendLabel(spec, params)` gives "RSI 14" or "BB 20 2". Importing the catalogue brings every indicator in, which is right for a UI; to keep a bundle small, import the one function you use from the entry instead (`import { rsi } from 'lite-charts/indicators'`). See [Indicators](indicators.md) for the functions themselves.

Each output says how it is drawn: `line`, `histogram` (coloured by sign unless it has its own tone), `band-upper` and `band-lower` (the two edges of one band) or `markers` (isolated values drawn as dots). `guides` are reference lines for an oscillator pane, such as 30 and 70 for RSI.

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
