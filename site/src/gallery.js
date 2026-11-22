// The feature gallery of the examples page: one card per feature, each with tabs. Every tab is a piece of code that
// the build compiles into the page's live script (as the guides' live fences are) and that the card runs as shown;
// "Get this code" shows that same text. `bars`, `longBars`, `intradayBars` and `compareRows` are the site's invented
// demo data; `every(ms, fn)` is a repeating timer that stops when the tab changes.

const imp = (core, more = []) => [`import { ${core.join(', ')} } from 'lite-charts';`, ...more].join('\n');
const tab = (label, code, extra = {}) => ({ label, code, ...extra });

/** The cards. `chartTypes` is CHART_TYPES as read from the source at build time. */
export function features(chartTypes) {
  return [
    {
      id: 'types', title: 'Chart types', guide: ['chart-types', 'Chart types'],
      text: `All ${chartTypes.length} chart types through one call to <code>applyChartType</code>, from candles to Renko, Kagi and point and figure.`,
      tabs: chartTypes.map((t) => tab(t.name, `${imp(['createChart'], ["import { applyChartType } from 'lite-charts/transforms';"])}

const chart = createChart('chart');
const { definition, data, options } = applyChartType('${t.id}', bars, { ${t.id === 'kagi' ? 'reversal: 1.5, ' : ''}series: { title: 'DEMO' } });
chart.addSeries(definition, options).setData(data);
chart.timeScale().fitContent();`)),
    },
    {
      id: 'theme', title: 'Themes and colours', guide: ['theming', 'Theming'], themeFree: true,
      text: 'Dark and light themes, and any colour of your own. Gains and losses keep a sign and an arrow, not colour alone.',
      tabs: [['Dark', "{ theme: 'dark' }"], ['Light', "{ theme: 'light' }"], ['Custom colours', `{
  theme: 'dark',
  colors: {
    background: '#0B1A2A', grid: 'rgba(120, 170, 220, 0.10)', text: '#CFE3F7', crosshair: 'rgba(207, 227, 247, 0.5)',
    up: '#2EC4B6', down: '#FF9F1C', upText: '#3DD9CA', downText: '#FFB347', line: '#FFD166',
  },
}`]].map(([label, opts]) => tab(label, `${imp(['createChart', 'CandlestickSeries', 'LineSeries'], ["import { sma } from 'lite-charts/indicators';"])}

const chart = createChart('chart', ${opts});
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
chart.addSeries(LineSeries, { title: 'SMA 20', lineWidth: 2 }).setData(sma(bars, 20));`)),
    },
    {
      id: 'ranges', title: 'Range switcher', guide: ['extras', 'Tooltips, alerts and more'],
      text: 'A span that ends at the last bar, read in the chart\'s time zone: one call, or the switcher drawn over the chart.',
      tabs: ['1M', '6M', 'YTD', '1Y', 'All'].map((k) => tab(k, `${imp(['createChart', 'AreaSeries'], ["import { createRangeSwitcher } from 'lite-charts/extras';"])}

const chart = createChart('chart');
chart.addSeries(AreaSeries, { title: 'DEMO' }).setData(longBars.map(b => ({ time: b.time, value: b.close })));
const switcher = createRangeSwitcher(chart, { position: 'top-right' });
switcher.select('${k}');`)),
    },
    {
      id: 'legend', title: 'Legend', guide: ['theming', 'Theming'],
      text: 'The built-in legend reads the bar under the pointer, one row per titled series in each pane, or stays out of the way.',
      tabs: [
        tab('Price only', `${imp(['createChart', 'CandlestickSeries'])}

const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);`),
        tab('With averages', `${imp(['createChart', 'CandlestickSeries', 'LineSeries'], ["import { sma, ema } from 'lite-charts/indicators';"])}

const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
chart.addSeries(LineSeries, { title: 'SMA 20', lineWidth: 2 }).setData(sma(bars, 20));
chart.addSeries(LineSeries, { title: 'EMA 50', lineWidth: 2 }).setData(ema(bars, 50));`),
        tab('Hidden', `${imp(['createChart', 'CandlestickSeries'])}

const chart = createChart('chart', { legend: { visible: false } });
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);`),
      ],
    },
    {
      id: 'compare', title: 'Compare in percent', guide: ['extras', 'Tooltips, alerts and more'],
      text: 'Other series as percent change from the first visible bar, on the price axis, with a chip legend. Pan and they re-base.',
      tabs: [1, 2, 3, 4].map((n) => tab(n === 1 ? '1 series' : `${n} series`, `${imp(['createChart', 'CandlestickSeries'], ["import { createCompare } from 'lite-charts/extras';"])}

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const compare = createCompare(chart, { base: candles, mode: 'percent' });
${['NORTH', 'HARBOR', 'MERIDIAN', 'SUMMIT'].slice(0, n).map((t, i) => `compare.add(compareRows[${i}], { title: '${t}' });`).join('\n')}`)),
    },
    {
      id: 'latest', title: 'Go to latest and watermark', guide: ['extras', 'Tooltips, alerts and more'],
      text: 'A button that appears while the newest bar is out of view, and a watermark that fits its pane.',
      tabs: [
        tab('Go to latest', `${imp(['createChart', 'CandlestickSeries'], ["import { createGoToRealtimeButton } from 'lite-charts/extras';"])}

const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
chart.timeScale().setVisibleLogicalRange({ from: 40, to: 110 });   // scrolled back
createGoToRealtimeButton(chart);`),
        tab('Watermark', `${imp(['createChart', 'CandlestickSeries'], ["import { createWatermark } from 'lite-charts/extras';"])}

const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
createWatermark(chart, { text: 'DEMO', lines: ['Daily, invented data'], position: 'center', opacity: 0.08 });`),
        tab('Both', `${imp(['createChart', 'CandlestickSeries'], ["import { createGoToRealtimeButton, createWatermark } from 'lite-charts/extras';"])}

const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
chart.timeScale().setVisibleLogicalRange({ from: 40, to: 110 });
createWatermark(chart, { text: 'DEMO', position: 'center', opacity: 0.08 });
createGoToRealtimeButton(chart);`),
      ],
    },
    {
      id: 'tooltips', title: 'Tooltips', guide: ['extras', 'Tooltips, alerts and more'],
      text: 'Three looks for the values under the crosshair. They read the crosshair, so the keyboard inspect mode works too.',
      tabs: [['Floating', 'floating'], ['Tracking', 'tracking'], ['Magnifier', 'magnifier']].map(([label, mode]) => tab(label, `${imp(['createChart', 'CandlestickSeries', 'LineSeries'], ["import { sma } from 'lite-charts/indicators';", "import { createTooltip } from 'lite-charts/extras';"])}

const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
chart.addSeries(LineSeries, { title: 'SMA 20', lineWidth: 1.5 }).setData(sma(bars, 20));
createTooltip(chart, { mode: '${mode}' });`)),
    },
    {
      id: 'scales', title: 'Price scales', guide: ['panes-and-scales', 'Panes and scales'],
      text: 'Linear, log and percent modes, and a second scale on the left for a series of another size.',
      tabs: [
        ...['linear', 'log', 'percent'].map((m) => tab(m[0].toUpperCase() + m.slice(1), `${imp(['createChart', 'LineSeries'])}

const chart = createChart('chart', { rightPriceScale: { mode: '${m}' } });
chart.addSeries(LineSeries, { title: 'DEMO', lineWidth: 2 }).setData(longBars.map(b => ({ time: b.time, value: b.close })));`)),
        tab('Left and right', `${imp(['createChart', 'CandlestickSeries', 'HistogramSeries'])}

const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
chart.addSeries(HistogramSeries, { title: 'Volume', priceScaleId: 'left', priceFormat: { precision: 0, minMove: 1 } })
  .setData(bars.map(b => ({ time: b.time, value: b.volume })));`),
      ],
    },
    {
      id: 'data', title: 'Live updates, gaps and history', guide: ['live-data', 'Live data'],
      text: 'update() for the forming bar, empty rows for gaps, and older history that loads as you scroll left, here from a made-up provider with no network.',
      tabs: [
        tab('Realtime updates', `${imp(['createChart', 'CandlestickSeries'])}

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars.slice(0, 160));
let i = 160, last = { ...bars[159] };
every(400, () => {
  if (i >= bars.length) return;
  const close = +(last.close * (1 + (Math.random() - 0.5) * 0.01)).toFixed(2);
  last = { ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close) };
  candles.update(last);                        // same time: the forming bar changes
  if (Math.random() < 0.15) { last = { ...bars[i], open: close }; i++; candles.update(last); }   // newer: a new bar
});`),
        tab('Whitespace', `${imp(['createChart', 'LineSeries'])}

const chart = createChart('chart');
const rows = bars.map((b, i) => (i > 90 && i < 120 ? { time: b.time } : { time: b.time, value: b.close }));
chart.addSeries(LineSeries, { title: 'DEMO, with a gap', lineWidth: 2 }).setData(rows);   // { time } alone: a gap`),
        tab('Infinite history', `${imp(['createChart', 'CandlestickSeries'], ["import { connectLive } from 'lite-charts/live';"])}

// A provider of our own that makes bars up (no network) and can page back.
const step = 3600;
const now = Math.floor(Date.now() / 1000 / step) * step;
const bar = (t) => { const p = 100 + 8 * Math.sin(t / 90000) + 3 * Math.sin(t / 17000); return { time: t, open: p, high: p + 0.6, low: p - 0.6, close: p + 0.3 * Math.sin(t / 5000), volume: 1 }; };
const madeUp = {
  id: 'made-up', intervals: ['1h'], canPageBack: true,
  async history(symbol, interval, { limit, before }) {
    const end = before ?? now + step;
    return Array.from({ length: limit }, (_, k) => bar(end - (limit - k) * step));
  },
  subscribe(symbol, interval, on) { on.open(); return () => {}; },
};
const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO, scroll left' });
connectLive(candles, { provider: madeUp, interval: '1h', history: 150, chart });   // older pages load at the left edge`),
      ],
    },
    {
      id: 'indicators', title: 'Indicators and markers', guide: ['indicator-catalogue', 'Indicator catalogue'],
      text: 'Volume, markers and any entry of the catalogue: <code>getIndicator(id).compute(bars)</code> gives one row per bar for each output.',
      tabs: [
        tab('Volume', `${imp(['createChart', 'CandlestickSeries', 'HistogramSeries'])}

const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
const volume = chart.addSeries(HistogramSeries, { title: 'Volume', priceScaleId: 'volume', priceFormat: { precision: 0, minMove: 1 } });
chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
volume.setData(bars.map(b => ({ time: b.time, value: b.volume })));`),
        tab('Markers', `${imp(['createChart', 'CandlestickSeries', 'createSeriesMarkers'])}

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const marks = [];
for (let i = 40; i < bars.length - 10; i += 30) {
  marks.push({ time: bars[i].time, position: 'belowBar', shape: 'arrowUp', text: 'Buy' });
  marks.push({ time: bars[i + 12].time, position: 'aboveBar', shape: 'arrowDown', text: 'Sell' });
}
createSeriesMarkers(candles, marks);`),
        ...[['Moving averages', 'ema', '{ period: 21 }'], ['Supertrend', 'supertrend', '{}'], ['MACD', 'macd', '{}'], ['RSI', 'rsi', '{}']].map(([label, id, params]) => tab(label, `${imp(['createChart', 'CandlestickSeries', 'LineSeries', 'HistogramSeries'], ["import { getIndicator, legendLabel } from 'lite-charts/indicators';"])}

const chart = createChart('chart');
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);
const spec = getIndicator('${id}');
const params = ${params};
const out = spec.compute(bars, params);
const pane = spec.overlay ? 0 : 1;
for (const o of spec.outputs) {
  const type = o.kind === 'histogram' ? HistogramSeries : LineSeries;
  chart.addSeries(type, { title: \`\${legendLabel(spec, params)} \${o.label}\`, lineWidth: 2, priceLineVisible: false }, pane).setData(out[o.key]);
}`)),
      ],
    },
    {
      id: 'alerts', title: 'Price alerts', guide: ['extras', 'Tooltips, alerts and more'],
      text: 'Lines with a bell that fire once when the price crosses them. A made-up tick each second moves the price here; drag a line, or use the + by the axis.',
      tabs: [['Stay muted', 'false'], ['Remove on trigger', 'true']].map(([label, remove]) => tab(label, `${imp(['createChart', 'CandlestickSeries'], ["import { createPriceAlerts } from 'lite-charts/extras';"])}

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const last = bars[bars.length - 1];
const alerts = createPriceAlerts(chart, candles, { removeOnTrigger: ${remove} });
alerts.add(+(last.close * 1.01).toFixed(2));
alerts.add(+(last.close * 0.99).toFixed(2));

let close = last.close;
every(1000, () => {
  close = +(close * (1 + (Math.random() - 0.5) * 0.012)).toFixed(2);
  candles.update({ ...last, high: Math.max(last.high, close), low: Math.min(last.low, close), close });
});`)),
    },
    {
      id: 'replay', title: 'Bar replay', guide: ['extras', 'Tooltips, alerts and more'],
      text: 'Step through history bar by bar, at 1x to 10x, with indicators following. Press play on the strip.',
      tabs: [
        tab('From 60 bars back', `${imp(['createChart', 'CandlestickSeries'], ["import { createReplay } from 'lite-charts/extras';"])}

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const replay = createReplay(chart, candles, { data: bars });
replay.start(bars.length - 60);`),
        tab('Pick a start bar', `${imp(['createChart', 'CandlestickSeries'], ["import { createReplay } from 'lite-charts/extras';"])}

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const replay = createReplay(chart, candles, { data: bars });
replay.pick(true);   // click a bar to start there`),
      ],
    },
    {
      id: 'bands', title: 'Bands and session breaks', guide: ['extras', 'Tooltips, alerts and more'],
      text: 'A filled band between two lines, session breaks on intraday data, and a price line that starts at a bar.',
      tabs: [
        tab('Bollinger band', `${imp(['createChart', 'CandlestickSeries', 'LineSeries'], ["import { bollinger } from 'lite-charts/indicators';", "import { createBands } from 'lite-charts/extras';"])}

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const bb = bollinger(bars, { period: 20, mult: 2 });
chart.addSeries(LineSeries, { title: 'BB 20', lineWidth: 1, lineStyle: 'dashed', priceLineVisible: false }).setData(bb.basis);
createBands(candles, { upper: bb.upper, lower: bb.lower, chart });`),
        tab('Session breaks', `${imp(['createChart', 'CandlestickSeries'], ["import { createSessionBreaks, createVerticalLine } from 'lite-charts/extras';"])}

const chart = createChart('chart', { timeScale: { timeZone: 'Asia/Kolkata' } });
chart.addSeries(CandlestickSeries, { title: 'DEMO 5m' }).setData(intradayBars);
chart.timeScale().fitContent();
createSessionBreaks(chart);
createVerticalLine(chart, { time: intradayBars[262].time, label: 'Event' });`),
        tab('Partial price line', `${imp(['createChart', 'CandlestickSeries'], ["import { createPartialPriceLine } from 'lite-charts/extras';"])}

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const from = bars.length - 50;
const high = Math.max(...bars.slice(from).map(b => b.high));
createPartialPriceLine(candles, { fromTime: bars[from].time, price: high, title: 'High since' });`),
      ],
    },
    {
      id: 'custom', title: 'Custom series', guide: ['extras', 'Tooltips, alerts and more'],
      text: 'Four series types written on the public series contract: copy one to start your own.',
      tabs: [
        tab('Stacked area', `${imp(['createChart'], ["import { StackedAreaSeries } from 'lite-charts/extras';"])}

const chart = createChart('chart');
let a = 40, b = 30, c = 20;
const rows = bars.slice(0, 120).map((bar, i) => {
  a = Math.max(8, a + Math.sin(i / 7) * 2); b = Math.max(8, b + Math.cos(i / 9) * 1.6); c = Math.max(6, c + Math.sin(i / 5));
  return { time: bar.time, values: [+a.toFixed(1), +b.toFixed(1), +c.toFixed(1)] };
});
chart.addSeries(StackedAreaSeries, { title: 'Volume by venue' }).setData(rows);`),
        tab('Heatmap', `${imp(['createChart', 'LineSeries'], ["import { HeatmapSeries } from 'lite-charts/extras';"])}

const chart = createChart('chart');
const rows = [], mid = [];
bars.slice(0, 90).forEach((bar, i) => {
  const m = 100 + 3 * Math.sin(i / 11);
  const cells = Array.from({ length: 28 }, (_, k) => { const z = (92 + k * 0.6 - m) / 2.4; return Math.exp(-z * z); });
  rows.push({ time: bar.time, low: 92, step: 0.6, cells });
  mid.push({ time: bar.time, value: +m.toFixed(2) });
});
chart.addSeries(HeatmapSeries, { title: 'Depth' }).setData(rows);
chart.addSeries(LineSeries, { title: 'Mid', lineWidth: 1.5 }).setData(mid);`),
        tab('Rounded candles', `${imp(['createChart'], ["import { RoundedCandlesSeries } from 'lite-charts/extras';"])}

const chart = createChart('chart');
chart.addSeries(RoundedCandlesSeries, { title: 'DEMO', radius: 0.7 }).setData(bars.slice(-80));`),
        tab('Whisker box', `${imp(['createChart'], ["import { WhiskerBoxSeries } from 'lite-charts/extras';"])}

const chart = createChart('chart');
let m = 50;
const rows = Array.from({ length: 36 }, (_, i) => {
  m += 0.35 + Math.sin(i / 3) * 0.4;
  const s = 1.2 + i * 0.09;
  return { time: bars[i * 5].time, min: +(m - s * 2.1).toFixed(2), q1: +(m - s * 0.7).toFixed(2), median: +m.toFixed(2), q3: +(m + s * 0.7).toFixed(2), max: +(m + s * 2.1).toFixed(2) };
});
chart.addSeries(WhiskerBoxSeries, { title: 'Forecast' }).setData(rows);`),
      ],
    },
    {
      id: 'drawings', title: 'Drawing tools', guide: ['drawing-tools', 'Drawing tools'],
      text: 'The toolbar with the default tools or every tool, and drawings added from code. Pick a tool on the rail and draw.',
      tabs: [
        tab('Default tools', `${imp(['createChart', 'CandlestickSeries'], ["import { createDrawingTools } from 'lite-charts/drawings';"])}

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
createDrawingTools(chart, candles, { toolbar: true });`),
        tab('Every tool', `${imp(['createChart', 'CandlestickSeries'], ["import { createDrawingTools, ALL_TOOLS } from 'lite-charts/drawings';"])}

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
createDrawingTools(chart, candles, { toolbar: true, tools: ALL_TOOLS });`),
        tab('From code', `${imp(['createChart', 'CandlestickSeries'], ["import { createDrawingTools } from 'lite-charts/drawings';"])}

const chart = createChart('chart');
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
const tools = createDrawingTools(chart, candles, { toolbar: true });
const at = (i) => bars[bars.length - 1 - i];
tools.add({ tool: 'fib', points: [{ time: at(95).time, price: at(95).low }, { time: at(55).time, price: at(55).high }] });
tools.add({ tool: 'long', points: [{ time: at(18).time, price: at(18).close }, { time: at(4).time, price: at(18).close * 1.05 }] });`),
      ],
    },
    {
      id: 'keys', title: 'Keyboard and screen reader', guide: ['accessibility', 'Accessibility'],
      text: 'Click the chart or tab to it, press Enter, then the arrows: each bar is read aloud through a live region, and the legend follows.',
      tabs: [
        tab('Default', `${imp(['createChart', 'CandlestickSeries'])}

const chart = createChart('chart', { ariaLabel: 'DEMO daily price' });
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);`),
        tab('Own description', `${imp(['createChart', 'CandlestickSeries'])}

const chart = createChart('chart', {
  ariaLabel: 'DEMO daily price, invented data',
  ariaDescription: 'Press Enter to step through bars with the arrow keys; Escape stops.',
});
chart.addSeries(CandlestickSeries, { title: 'DEMO' }).setData(bars);`),
      ],
    },
    {
      id: 'tags', title: 'With no code: the tags', guide: ['widget', 'The ready-made chart'],
      text: 'One script tag and one HTML tag: a chart, or the whole ready-made workspace. Both read JSON or CSV from <code>src</code>.',
      tabs: [
        tab('<chartist-chart>', `<script src="chartist-lite.element.iife.min.js"></script>
<chartist-chart type="candlestick" src="assets/demo-bars.json" volume height="320"
  aria-label="DEMO daily candles"></chartist-chart>`, { lang: 'html' }),
        tab('<chartist-terminal>', `<script src="chartist-lite.terminal.iife.min.js"></script>
<chartist-terminal src="assets/demo-bars.json" symbol="DEMO" interval="1D" indicators="ema" height="420"></chartist-terminal>`, { lang: 'html' }),
      ],
    },
  ];
}
