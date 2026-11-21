// The demo charts of the home page and the examples gallery, loaded only on those pages and only once a chart nears
// the viewport. Each demo gets its container, the library globals and the site theme, and returns
// { charts, restyle(theme) }. Demo data are seeded random walks, not market data.
import { makeBars, makeBenchmark, makeIntraday } from './demo-data.js';

const TONES = {
  dark: { avg: '#FF9F0A', band: 'rgba(235, 235, 245, 0.5)', guide: 'rgba(235, 235, 245, 0.4)', resistance: '#64B5FF', support: '#FF9F0A', second: '#63D5C8' },
  light: { avg: '#B85C00', band: 'rgba(60, 60, 67, 0.5)', guide: 'rgba(60, 60, 67, 0.4)', resistance: '#0062C4', support: '#B25000', second: '#0A6A64' },
};
const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
const one = (chart, extra) => ({ charts: [chart], ...extra });
const closes = (bars) => bars.map((b) => ({ time: b.time, value: b.close }));
const make = (el, L, theme, opts = {}) => L.createChart(el, { theme, ariaLabel: el.dataset.label, ...opts });

function home(el, L, theme) {
  const I = window.ChartistLiteIndicators || {};
  const bars = makeBars(260, 7);
  const chart = make(el, L, theme);
  const state = { type: 'candles', ind: new Set(['sma']), theme };
  const stage = el.closest('[data-stage]');
  let series = [];
  let guides = [];
  function render() {
    const range = chart.timeScale().getVisibleLogicalRange();
    for (const s of series) chart.removeSeries(s);
    series = []; guides = [];
    const t = TONES[state.theme];
    const DEF = { candles: L.CandlestickSeries, bars: L.BarSeries, line: L.LineSeries, area: L.AreaSeries };
    const main = chart.addSeries(DEF[state.type], { title: 'DEMO' });
    main.setData(state.type === 'line' || state.type === 'area' ? closes(bars) : bars);
    series.push(main);
    if (state.ind.has('sma') && I.sma) {
      const s = chart.addSeries(L.LineSeries, { ...quiet, title: 'SMA 20', lineWidth: 2, color: t.avg });
      s.setData(I.sma(bars, 20)); series.push(s);
    }
    if (state.ind.has('bb') && I.bollinger) {
      const bb = I.bollinger(bars, { period: 20, mult: 2 });
      for (const [k, name] of [['upper', 'BB upper'], ['lower', 'BB lower']]) {
        const s = chart.addSeries(L.LineSeries, { ...quiet, title: name, lineWidth: 1, color: t.band });
        s.setData(bb[k]); series.push(s);
      }
    }
    if (state.ind.has('volume')) {
      const v = chart.addSeries(L.HistogramSeries, { title: 'Volume', priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false, priceFormat: { precision: 0, minMove: 1 } });
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      v.setData(bars.map((b) => ({ time: b.time, value: b.volume }))); series.push(v);
    }
    if (state.ind.has('rsi') && I.rsi) {
      const r = chart.addSeries(L.LineSeries, { title: 'RSI 14', lineWidth: 2, priceLineVisible: false, color: t.second }, 1);
      r.setData(I.rsi(bars, 14)); series.push(r);
      guides = [70, 30].map((price) => L.createPriceLine(r, { price, lineStyle: 'dotted', axisLabelVisible: false, color: t.guide }));
    }
    if (range) chart.timeScale().setVisibleLogicalRange(range);
  }
  render();
  if (stage) {
    stage.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-hero-type]');
      const ib = e.target.closest('[data-hero-ind]');
      if (tb) {
        state.type = tb.dataset.heroType;
        for (const b of stage.querySelectorAll('[data-hero-type]')) b.setAttribute('aria-pressed', String(b === tb));
        render();
      } else if (ib) {
        const k = ib.dataset.heroInd;
        if (state.ind.has(k)) state.ind.delete(k); else state.ind.add(k);
        ib.setAttribute('aria-pressed', String(state.ind.has(k)));
        render();
      }
    });
  }
  void guides;
  return one(chart, { restyle(t) { state.theme = t; chart.applyOptions({ theme: t }); render(); } });
}

function candles(el, L, theme) {
  const bars = makeBars(120, 11);
  const chart = make(el, L, theme);
  const c = chart.addSeries(L.CandlestickSeries, { title: 'DEMO' });
  c.setData(bars);
  const hi = Math.max(...bars.slice(-30).map((b) => b.high));
  const lo = Math.min(...bars.slice(-30).map((b) => b.low));
  const lines = [
    L.createPriceLine(c, { price: hi, title: 'Resistance', lineStyle: 'dashed', color: TONES[theme].resistance }),
    L.createPriceLine(c, { price: lo, title: 'Support', lineStyle: 'dotted', color: TONES[theme].support }),
  ];
  const marks = [];
  for (let i = 70; i < bars.length - 8; i += 14) {
    marks.push({ time: bars[i].time, position: 'belowBar', shape: 'arrowUp', text: 'Buy' });
    marks.push({ time: bars[i + 6].time, position: 'aboveBar', shape: 'arrowDown', text: 'Sell' });
  }
  L.createSeriesMarkers(c, marks);
  return one(chart, { restyle(t) { chart.applyOptions({ theme: t }); lines[0].applyOptions({ color: TONES[t].resistance }); lines[1].applyOptions({ color: TONES[t].support }); } });
}

function simple(kind) {
  return (el, L, theme) => {
    const bars = makeBars(120, 11);
    const chart = make(el, L, theme);
    if (kind === 'line') chart.addSeries(L.LineSeries, { title: 'Close' }).setData(closes(bars));
    if (kind === 'area') chart.addSeries(L.AreaSeries, { title: 'Close' }).setData(closes(bars));
    if (kind === 'bar') chart.addSeries(L.BarSeries, { title: 'DEMO' }).setData(bars.map(({ volume, ...r }) => r));
    if (kind === 'candles') chart.addSeries(L.CandlestickSeries, { title: 'DEMO' }).setData(bars);
    if (kind === 'baseline') chart.addSeries(L.BaselineSeries, { baseValue: 100, title: 'Close' }).setData(closes(bars));
    if (kind === 'histogram') {
      const h = chart.addSeries(L.HistogramSeries, { title: 'Volume', priceFormat: { precision: 0, minMove: 1 } });
      const fill = (t) => { const c = t === 'dark' ? L.darkTheme : L.lightTheme; h.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? c.up : c.down }))); };
      fill(theme);
      return one(chart, { restyle(t) { chart.applyOptions({ theme: t }); fill(t); } });
    }
    return one(chart);
  };
}

function indicators(el, L, theme) {
  const { sma, bollinger } = window.ChartistLiteIndicators;
  const bars = makeBars(220, 7);
  const chart = make(el, L, theme);
  chart.addSeries(L.CandlestickSeries, { title: 'DEMO' }).setData(bars);
  const avg = chart.addSeries(L.LineSeries, { ...quiet, lineWidth: 2, title: 'SMA 20', color: TONES[theme].avg });
  avg.setData(sma(bars, 20));
  const bb = bollinger(bars, { period: 20, mult: 2 });
  const up = chart.addSeries(L.LineSeries, { ...quiet, lineWidth: 1, title: 'BB upper', color: TONES[theme].band });
  const lo = chart.addSeries(L.LineSeries, { ...quiet, lineWidth: 1, title: 'BB lower', color: TONES[theme].band });
  up.setData(bb.upper); lo.setData(bb.lower);
  return one(chart, { restyle(t) { chart.applyOptions({ theme: t }); avg.applyOptions({ color: TONES[t].avg }); up.applyOptions({ color: TONES[t].band }); lo.applyOptions({ color: TONES[t].band }); } });
}

function panes(el, L, theme) {
  const { rsi } = window.ChartistLiteIndicators;
  const bars = makeBars(220, 7);
  const chart = make(el, L, theme);
  chart.addSeries(L.CandlestickSeries, { title: 'DEMO' }).setData(bars);
  const volume = chart.addSeries(L.HistogramSeries, { title: 'Volume', priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false, priceFormat: { precision: 0, minMove: 1 } });
  chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  volume.setData(bars.map((b) => ({ time: b.time, value: b.volume })));
  const r = chart.addSeries(L.LineSeries, { title: 'RSI 14', lineWidth: 2, priceLineVisible: false, color: TONES[theme].second }, 1);
  r.setData(rsi(bars, 14));
  const guides = [70, 30].map((price) => L.createPriceLine(r, { price, lineStyle: 'dotted', axisLabelVisible: false, color: TONES[theme].guide }));
  return one(chart, { restyle(t) { chart.applyOptions({ theme: t }); r.applyOptions({ color: TONES[t].second }); for (const g of guides) g.applyOptions({ color: TONES[t].guide }); } });
}

function macdDemo(el, L, theme) {
  const { macd } = window.ChartistLiteIndicators;
  const bars = makeBars(220, 7);
  const chart = make(el, L, theme);
  chart.addSeries(L.CandlestickSeries, { title: 'DEMO' }).setData(bars);
  const m = macd(bars, { fast: 12, slow: 26, signal: 9 });
  const hist = chart.addSeries(L.HistogramSeries, { title: 'Histogram', lastValueVisible: false, priceLineVisible: false }, 1);
  const line = chart.addSeries(L.LineSeries, { ...quiet, title: 'MACD', lineWidth: 2, color: TONES[theme].resistance }, 1);
  const sig = chart.addSeries(L.LineSeries, { ...quiet, title: 'Signal', lineWidth: 1, color: TONES[theme].avg }, 1);
  const fill = (t) => { const c = t === 'dark' ? L.darkTheme : L.lightTheme; hist.setData(m.histogram.map((p) => (p.value === undefined ? p : { ...p, color: p.value >= 0 ? c.up : c.down }))); };
  fill(theme); line.setData(m.macd); sig.setData(m.signal);
  return one(chart, { restyle(t) { chart.applyOptions({ theme: t }); fill(t); line.applyOptions({ color: TONES[t].resistance }); sig.applyOptions({ color: TONES[t].avg }); } });
}

function heikin(el, L, theme) {
  const { heikinAshi } = window.ChartistLiteIndicators;
  const chart = make(el, L, theme);
  chart.addSeries(L.CandlestickSeries, { title: 'Heikin-Ashi' }).setData(heikinAshi(makeBars(160, 7)));
  return one(chart);
}

function scale(el, L, theme) {
  const bars = makeBars(220, 7);
  const chart = make(el, L, theme);
  chart.addSeries(L.LineSeries, { title: 'DEMO', lineWidth: 2 }).setData(closes(bars));
  const b = chart.addSeries(L.LineSeries, { title: 'Benchmark', lineWidth: 2, color: TONES[theme].avg });
  b.setData(makeBenchmark(bars));
  chart.priceScale('right').applyOptions({ mode: 'percent' });
  return one(chart, { restyle(t) { chart.applyOptions({ theme: t }); b.applyOptions({ color: TONES[t].avg }); } });
}

function zone(el, L, theme) {
  const chart = make(el, L, theme, { timeScale: { timeZone: 'Asia/Kolkata' } });
  chart.addSeries(L.CandlestickSeries, { title: 'DEMO-C' }).setData(makeIntraday(5, 37));
  return one(chart);
}

function keys(el, L, theme) {
  const chart = make(el, L, theme);
  chart.addSeries(L.CandlestickSeries, { title: 'DEMO' }).setData(makeBars(90, 31));
  return one(chart);
}

/** The drawing tools playground: the built-in toolbar and a few drawings to start from. */
function draw(el, L, theme, toolbar = true) {
  const D = window.ChartistLiteDrawings;
  const bars = makeBars(260, 11);
  const chart = make(el, L, theme);
  const candles = chart.addSeries(L.CandlestickSeries, { title: 'DEMO' });
  candles.setData(bars);
  chart.timeScale().setVisibleLogicalRange({ from: bars.length - 110, to: bars.length + 6 });
  const tools = D.createDrawingTools(chart, candles, { toolbar });
  const b = (i) => bars[bars.length - 1 - i];
  tools.add({ tool: 'fib', points: [{ time: b(95).time, price: b(95).low }, { time: b(55).time, price: b(55).high }] });
  tools.add({ tool: 'long', points: [{ time: b(18).time, price: b(18).close }, { time: b(4).time, price: b(18).close * 1.05 }] });
  tools.add({ tool: 'horizontal', points: [{ time: b(0).time, price: b(40).high }], text: 'Resistance' });
  return { charts: [chart], tools: [tools] };
}

/** 5000 bars for the frame meter (site.js times pan and zoom frames on it). */
function meter(el, L, theme) {
  const chart = make(el, L, theme, { interaction: { kinetic: false } });
  chart.addSeries(L.CandlestickSeries, { title: 'DEMO, 5000 bars' }).setData(makeBars(5000, 3));
  return one(chart);
}

export const DEMOS = {
  home, draw, drawings: (el, L, theme) => draw(el, L, theme, false), candles, indicators, panes, zone, keys, meter, scale, heikin, macd: macdDemo,
  line: simple('line'), area: simple('area'), bar: simple('bar'), histogram: simple('histogram'), baseline: simple('baseline'),
  's-candles': simple('candles'), 's-bar': simple('bar'), 's-line': simple('line'), 's-area': simple('area'),
  's-histogram': simple('histogram'), 's-baseline': simple('baseline'),
};

window.__CL_DEMOS = DEMOS;
