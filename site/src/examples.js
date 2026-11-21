// The examples gallery: one entry per card. `id` is also the demo name in demos.js (or an element card). `code` is
// what the card shows and what its demo runs, minus the demo data and the theme colours of the site.

export const EXAMPLES = [
  {
    id: 'candles', kind: 'series', title: 'Candlesticks, price lines and markers', tags: ['CandlestickSeries', 'createPriceLine', 'createSeriesMarkers'],
    label: 'Demo candlestick chart with price lines and markers', guide: ['plugins', 'Plugins guide'],
    text: 'Candles with resistance and support lines from the last 30 bars, and buy and sell markers. Lines and markers are small plugins built on the primitive contract.',
    code: `const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO' });
candles.setData(bars);
createPriceLine(candles, { price: high30, title: 'Resistance', lineStyle: 'dashed' });
createPriceLine(candles, { price: low30, title: 'Support', lineStyle: 'dotted' });
createSeriesMarkers(candles, [
  { time: '2024-04-08', position: 'belowBar', shape: 'arrowUp', text: 'Buy' },
  { time: '2024-04-16', position: 'aboveBar', shape: 'arrowDown', text: 'Sell' },
]);`,
  },
  {
    id: 'line', kind: 'series', title: 'Line', tags: ['LineSeries'], label: 'Demo line chart of closing prices', guide: ['series-types', 'Series types'],
    text: 'Closing prices as a line. Options include width, a dashed or dotted style, and a step type that holds each value.',
    code: `chart.addSeries(LineSeries, { title: 'Close' })
  .setData(bars.map(b => ({ time: b.time, value: b.close })));`,
  },
  {
    id: 'area', kind: 'series', title: 'Area', tags: ['AreaSeries'], label: 'Demo area chart of closing prices', guide: ['series-types', 'Series types'],
    text: 'The same closes as an area: a line with a fill that fades towards the foot of the pane.',
    code: `chart.addSeries(AreaSeries, { title: 'Close' })
  .setData(bars.map(b => ({ time: b.time, value: b.close })));`,
  },
  {
    id: 'bar', kind: 'series', title: 'OHLC bars', tags: ['BarSeries'], label: 'Demo OHLC bar chart', guide: ['series-types', 'Series types'],
    text: 'Open, high, low and close as a stem with an open tick on the left and a close tick on the right.',
    code: `chart.addSeries(BarSeries, { title: 'DEMO' }).setData(bars);`,
  },
  {
    id: 'histogram', kind: 'series', title: 'Histogram', tags: ['HistogramSeries'], label: 'Demo volume histogram coloured by direction', guide: ['series-types', 'Series types'],
    text: 'Columns from a base value. Each row here carries its own colour: the theme\'s up colour when the bar closed above its open.',
    code: `const volume = chart.addSeries(HistogramSeries, { title: 'Volume' });
volume.setData(bars.map(b => ({
  time: b.time, value: b.volume, color: b.close >= b.open ? darkTheme.up : darkTheme.down,
})));`,
  },
  {
    id: 'baseline', kind: 'series', title: 'Baseline', tags: ['BaselineSeries'], label: 'Demo baseline chart around a value of 100', guide: ['series-types', 'Series types'],
    text: 'A line split around a base value of 100: the up colour above it, the down colour below, each with a light fill.',
    code: `chart.addSeries(BaselineSeries, { baseValue: 100, title: 'Close' })
  .setData(bars.map(b => ({ time: b.time, value: b.close })));`,
  },
  {
    id: 'indicators', kind: 'indicators', title: 'Moving average and Bollinger bands', tags: ['sma', 'bollinger'], label: 'Demo candlestick chart with a moving average and Bollinger bands', guide: ['indicators', 'Indicators guide'],
    text: 'A 20-bar simple moving average and Bollinger bands from the <code>indicators</code> entry, drawn as line series.',
    code: `import { sma, bollinger } from '@mrchartist/chartist-lite/indicators';

chart.addSeries(LineSeries, { title: 'SMA 20' }).setData(sma(bars, 20));
const bb = bollinger(bars, { period: 20, mult: 2 });
chart.addSeries(LineSeries, { title: 'BB upper' }).setData(bb.upper);
chart.addSeries(LineSeries, { title: 'BB lower' }).setData(bb.lower);`,
  },
  {
    id: 'macd', kind: 'indicators', title: 'MACD in its own pane', tags: ['macd', 'HistogramSeries'], label: 'Demo candlestick chart with a MACD pane', guide: ['indicators', 'Indicators guide'],
    text: 'MACD, its signal line and the histogram in a second pane, the histogram coloured by sign.',
    code: `const m = macd(bars, { fast: 12, slow: 26, signal: 9 });
chart.addSeries(HistogramSeries, { title: 'Histogram' }, 1).setData(
  m.histogram.map(p => p.value === undefined ? p : { ...p, color: p.value >= 0 ? darkTheme.up : darkTheme.down }));
chart.addSeries(LineSeries, { title: 'MACD' }, 1).setData(m.macd);
chart.addSeries(LineSeries, { title: 'Signal' }, 1).setData(m.signal);`,
  },
  {
    id: 'heikin', kind: 'indicators', title: 'Heikin-Ashi candles', tags: ['heikinAshi'], label: 'Demo Heikin-Ashi candlestick chart', guide: ['indicators', 'Indicators guide'],
    text: 'The same bars smoothed into Heikin-Ashi candles, which hold their colour through a trend.',
    code: `chart.addSeries(CandlestickSeries, { title: 'Heikin-Ashi' }).setData(heikinAshi(bars));`,
  },
  {
    id: 'panes', kind: 'panes', title: 'Volume overlay and an RSI pane', tags: ['paneIndex', 'priceScaleId'], label: 'Demo candlestick chart with volume and an RSI pane below', guide: ['panes-and-scales', 'Panes guide'],
    text: 'Volume on an overlay scale at the foot of the price pane, and RSI 14 in a pane below with guides at 70 and 30. Drag the divider to resize.',
    code: `const volume = chart.addSeries(HistogramSeries, { title: 'Volume', priceScaleId: 'volume' });
chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
const rsiLine = chart.addSeries(LineSeries, { title: 'RSI 14' }, 1);   // pane 1
rsiLine.setData(rsi(bars, 14));
createPriceLine(rsiLine, { price: 70, lineStyle: 'dotted' });`,
  },
  {
    id: 'scale', kind: 'panes', title: 'Linear, log and percent scales', tags: ['PriceScaleOptions'], label: 'Demo line chart with a switchable price scale mode', guide: ['panes-and-scales', 'Panes guide'], controls: 'scale',
    text: 'Two lines on one scale. Switch the mode: percent measures each from the first visible bar, so they compare directly.',
    code: `chart.addSeries(LineSeries, { title: 'DEMO' }).setData(closes);
chart.addSeries(LineSeries, { title: 'Benchmark' }).setData(benchmark);
chart.priceScale('right').applyOptions({ mode: 'percent' });   // or 'log', 'linear'`,
  },
  {
    id: 'zone', kind: 'time', title: 'Time zones', tags: ['timeScale.timeZone'], label: 'Demo five-minute candlestick chart over five sessions', guide: ['time-and-time-zones', 'Time guide'], controls: 'zone',
    text: 'Five sessions of five-minute bars in UNIX seconds. No slot for the nights, and labels read in the zone you choose; the data never changes.',
    code: `const chart = createChart('chart', { timeScale: { timeZone: 'Asia/Kolkata' } });
chart.addSeries(CandlestickSeries, { title: 'DEMO-C' }).setData(intradayBars);
chart.applyOptions({ timeScale: { timeZone: 'America/New_York' } });`,
  },
  {
    id: 'element-candles', kind: 'element', element: true, title: 'The element: candles and volume', tags: ['<chartist-chart>'], guide: ['embedding', 'Embedding guide'], lang: 'html',
    text: 'A custom element reading its rows from an inline JSON script. The table inside it is what crawlers and visitors without JavaScript see.',
    code: `<script src="chartist-lite.element.iife.min.js"></script>
<chartist-chart type="candlestick" volume height="320">
  <script type="application/json">[{"time":"2024-01-02","open":10,"high":12,"low":9,"close":11,"volume":900}]</script>
</chartist-chart>`,
  },
  {
    id: 'element-area', kind: 'element', element: true, title: 'The element: an area', tags: ['<chartist-chart>'], guide: ['embedding', 'Embedding guide'], lang: 'html',
    text: 'The same rows read as one closing value per day, with <code>type="area"</code>.',
    code: `<chartist-chart type="area" height="260">
  <script type="application/json">[{"time":"2024-01-01","value":100}]</script>
</chartist-chart>`,
  },
];
