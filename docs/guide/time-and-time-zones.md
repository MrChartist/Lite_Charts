---
title: Time and time zones
description: How Chartist Lite reads times, why its time axis has no gaps for nights and weekends, and how to show exchange time with an IANA time zone.
order: 6
related: indicators, theming, getting-started
group: build
task: Show exchange time
summary: Times, the gap-free axis, IANA zones and the number rules on the axis.
---

# Time and time zones

## What a time can be

Every row has a `time`, in one of three forms:

| Form | Example | Meaning |
|---|---|---|
| UNIX seconds | `1709527500` | An instant |
| A date string | `'2024-03-04'` | A business day: a calendar date, not an instant |
| A business-day object | `{ year: 2024, month: 3, day: 4 }` | The same, as an object |

Rows must be in ascending time order. The chart stores your `time` exactly as given and hands it back in events such as the crosshair callback.

Business days are always read on the UTC calendar, so `'2024-03-09'` is 9 March for every viewer whatever the time zone option says. Use dates for daily and longer bars. Use UNIX seconds for intraday bars, and set the zone.

## The time axis has no gaps

The chart keeps one shared time axis: the sorted union of every series' times, one slot per distinct time. Time with no data has no slot, so a night, a weekend or a holiday is never drawn as an empty stretch. Bars are evenly spaced.

Axis ticks sit on real calendar boundaries read from your bars. For each calendar level (time of day, day of month, month, year) the chart keeps the finest step whose labels still fit, and a tick lands on the first bar of a new period, so a holiday moves a tick to the next real bar instead of printing a date with no bar under it. A label shows the coarsest boundary it crosses: a new year prints the year, a new month the month, a new session the date, anything else the clock time or the day number. Labels that would touch are dropped, strongest first kept.

## Showing exchange time

```js live height=360 controls=zone
const chart = createChart('chart', {
  timeScale: { timeZone: 'Asia/Kolkata' },
});
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO-C' });
candles.setData(intradayBars);   // five sessions of five-minute bars, in UNIX seconds
```

Switch the zone above: the same bars are labelled in another city. The buttons call `chart.applyOptions({ timeScale: { timeZone } })`.

`timeScale.timeZone` is an IANA zone such as `'America/New_York'` or `'Asia/Kolkata'`, or `'local'` for the viewer's own zone. The default is `'UTC'`. The axis labels and the crosshair stamp read each instant in that zone. The same instants read as 09:15 for a bar at the Mumbai open and as the previous evening if you choose a Los Angeles zone; the data does not change.

Daylight saving is handled: the zone's UTC offset for each instant comes from a change table built once per zone from `Intl.DateTimeFormat`, so panning over years of bars makes no `Intl` call per bar. The element form is `time-zone="America/New_York"`.

> [!NOTE]
> Date-only data ignore `timeZone`: a business day is a calendar date, not an instant.

## Clock and date spelling

```js live height=280
const chart = createChart('chart', { localization: { hours12: true, dateOrder: 'month-day' } });
chart.addSeries(LineSeries, { title: 'Close' })
  .setData(intradayBars.map(b => ({ time: b.time, value: b.close })));
```

- `hours12`: 12-hour clock on the axis and crosshair. Default false (24-hour).
- `dateOrder`: `'day-month'` (default, "29 Sep") or `'month-day'` ("Sep 29").
- `timeFormatter(time)`: replaces the crosshair's time stamp; it receives the bar's time as given in the data.
- `priceFormatter(price)`: replaces the price text everywhere (axis, last value, crosshair, legend).
- `noDataText`: the text shown in the centre of a chart with no data yet. Default "No data"; an empty string shows nothing.

Month and weekday names on the axis are English abbreviations (`Jan` to `Dec`, `Sun` to `Sat`). The axis tick text is always English and has no formatter option; `timeFormatter` replaces the crosshair stamp only.

## Numbers on the axis

The built-in price text never uses grouping separators (`12345.60`, not `12,345.60`) and writes a negative number with the true minus sign U+2212 (`−2.35`), which is as wide as a plus sign in tabular figures and which screen readers read as "minus". `formatPrice(value, precision)` and `formatPercent(value, precision)` are exported if you want the same text elsewhere. `formatPercent` signs its output: `+1.50%`, `−2.00%`, `0.00%`. A value that rounds to zero carries no sign. Set `localization.priceFormatter` if your readers expect grouping.

## Other places a zone appears

- `vwap(rows, { zone })` restarts each calendar day in that zone.
- `aggregate(rows, 'day' | 'week' | 'month', zone)` folds bars by calendar in that zone.

Pass the exchange's own zone to both, the same one you give the time axis.

## Scrolling and live data

The view is anchored to the last bar. When you append a bar the live view moves with it; a view the reader has scrolled back stays where it is. `chart.timeScale().scrollToRealTime()` jumps back to the newest bar. See the [API reference](api-reference.md) for the time scale methods.
