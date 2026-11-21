// Page script: the theme toggle and the live demo charts. Charts are created when they near the viewport.
// Everything is wrapped so a missing global (a blocked script) leaves the text content in place and logs nothing.
import { makeBars, makeIntraday, simpleAverage } from './demo-data.js';

const root = document.documentElement;
const registry = [];

const PALETTE = {
  light: { second: '#B85C00', band: 'rgba(60, 60, 67, 0.55)', guide: 'rgba(60, 60, 67, 0.45)', resistance: '#0066CC', support: '#B25000' },
  dark: { second: '#FF9F0A', band: 'rgba(235, 235, 245, 0.55)', guide: 'rgba(235, 235, 245, 0.45)', resistance: '#0A84FF', support: '#FF9F0A' },
};

function currentTheme() { return root.dataset.theme === 'dark' ? 'dark' : 'light'; }

function systemTheme() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; }
}

function applyTheme(name) {
  root.dataset.theme = name;
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.setAttribute('aria-pressed', name === 'dark' ? 'true' : 'false');
    btn.textContent = name === 'dark' ? 'Light mode' : 'Dark mode';
  }
  for (const entry of registry) entry.restyle(name);
  for (const el of document.querySelectorAll('chartist-chart')) el.setAttribute('theme', name);
}

function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.hidden = false;
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('cl-theme', next); } catch (e) { /* storage blocked: the choice lasts for this visit */ }
    });
  }
  let stored = null;
  try { stored = localStorage.getItem('cl-theme'); } catch (e) { stored = null; }
  applyTheme(stored === 'dark' || stored === 'light' ? stored : (root.dataset.theme === 'dark' || root.dataset.theme === 'light' ? root.dataset.theme : systemTheme()));
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      let s = null;
      try { s = localStorage.getItem('cl-theme'); } catch (e) { s = null; }
      if (!s) applyTheme(systemTheme());
    });
  } catch (e) { /* no matchMedia */ }
}

const plain = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };

const DEMOS = {
  home(el, L, theme) {
    const bars = makeBars(260, 7);
    const chart = L.createChart(el, { theme, ariaLabel: el.dataset.label });
    chart.addSeries(L.CandlestickSeries, { title: 'DEMO' }).setData(bars);
    chart.addSeries(L.LineSeries, { title: 'SMA 20', lineWidth: 2, lastValueVisible: false, priceLineVisible: false }).setData(simpleAverage(bars, 20));
    return { chart, restyle: (t) => chart.applyOptions({ theme: t }) };
  },

  candles(el, L, theme) {
    const bars = makeBars(120, 11);
    const chart = L.createChart(el, { theme, ariaLabel: el.dataset.label });
    const candles = chart.addSeries(L.CandlestickSeries, { title: 'DEMO' });
    candles.setData(bars);
    const hi = Math.max(...bars.slice(-30).map((b) => b.high));
    const lo = Math.min(...bars.slice(-30).map((b) => b.low));
    const lines = [
      L.createPriceLine(candles, { price: hi, title: 'Resistance', lineStyle: 'dashed', color: PALETTE[theme].resistance }),
      L.createPriceLine(candles, { price: lo, title: 'Support', lineStyle: 'dotted', color: PALETTE[theme].support }),
    ];
    const marks = [];
    for (let i = 70; i < bars.length - 8; i += 14) {
      marks.push({ time: bars[i].time, position: 'belowBar', shape: 'arrowUp', text: 'Buy' });
      marks.push({ time: bars[i + 6].time, position: 'aboveBar', shape: 'arrowDown', text: 'Sell' });
    }
    L.createSeriesMarkers(candles, marks);
    return {
      chart,
      restyle(t) {
        chart.applyOptions({ theme: t });
        lines[0].applyOptions({ color: PALETTE[t].resistance });
        lines[1].applyOptions({ color: PALETTE[t].support });
      },
    };
  },

  line(el, L, theme) {
    const bars = makeBars(120, 11);
    const chart = L.createChart(el, { theme, ariaLabel: el.dataset.label });
    chart.addSeries(L.LineSeries, { title: 'Close' }).setData(bars.map((b) => ({ time: b.time, value: b.close })));
    return { chart, restyle: (t) => chart.applyOptions({ theme: t }) };
  },

  area(el, L, theme) {
    const bars = makeBars(120, 11);
    const chart = L.createChart(el, { theme, ariaLabel: el.dataset.label });
    chart.addSeries(L.AreaSeries, { title: 'Close' }).setData(bars.map((b) => ({ time: b.time, value: b.close })));
    return { chart, restyle: (t) => chart.applyOptions({ theme: t }) };
  },

  bar(el, L, theme) {
    const bars = makeBars(120, 11);
    const chart = L.createChart(el, { theme, ariaLabel: el.dataset.label });
    chart.addSeries(L.BarSeries, { title: 'DEMO' }).setData(bars.map(({ volume, ...row }) => row));
    return { chart, restyle: (t) => chart.applyOptions({ theme: t }) };
  },

  histogram(el, L, theme) {
    const bars = makeBars(120, 11);
    const chart = L.createChart(el, { theme, ariaLabel: el.dataset.label });
    const hist = chart.addSeries(L.HistogramSeries, { title: 'Volume' });
    const fill = (t) => {
      const colors = t === 'dark' ? L.darkTheme : L.lightTheme;
      hist.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? colors.up : colors.down })));
    };
    fill(theme);
    return { chart, restyle(t) { chart.applyOptions({ theme: t }); fill(t); } };
  },

  baseline(el, L, theme) {
    const bars = makeBars(120, 11);
    const chart = L.createChart(el, { theme, ariaLabel: el.dataset.label });
    chart.addSeries(L.BaselineSeries, { baseValue: 100, title: 'Close' }).setData(bars.map((b) => ({ time: b.time, value: b.close })));
    return { chart, restyle: (t) => chart.applyOptions({ theme: t }) };
  },

  indicators(el, L, theme) {
    const { sma, bollinger } = window.ChartistLiteIndicators;
    const bars = makeBars(220, 7);
    const chart = L.createChart(el, { theme, ariaLabel: el.dataset.label });
    chart.addSeries(L.CandlestickSeries, { title: 'DEMO' }).setData(bars);
    const avg = chart.addSeries(L.LineSeries, { ...plain, lineWidth: 2, title: 'SMA 20', color: PALETTE[theme].second });
    avg.setData(sma(bars, 20));
    const bb = bollinger(bars, { period: 20, mult: 2 });
    const basis = chart.addSeries(L.LineSeries, { ...plain, lineWidth: 1, lineStyle: 'dashed', title: 'Bollinger basis', color: PALETTE[theme].band });
    const upper = chart.addSeries(L.LineSeries, { ...plain, lineWidth: 1, title: 'Bollinger upper', color: PALETTE[theme].band });
    const lower = chart.addSeries(L.LineSeries, { ...plain, lineWidth: 1, title: 'Bollinger lower', color: PALETTE[theme].band });
    basis.setData(bb.basis); upper.setData(bb.upper); lower.setData(bb.lower);
    return {
      chart,
      restyle(t) {
        chart.applyOptions({ theme: t });
        avg.applyOptions({ color: PALETTE[t].second });
        for (const s of [basis, upper, lower]) s.applyOptions({ color: PALETTE[t].band });
      },
    };
  },

  panes(el, L, theme) {
    const { rsi } = window.ChartistLiteIndicators;
    const bars = makeBars(220, 7);
    const chart = L.createChart(el, { theme, ariaLabel: el.dataset.label });
    chart.addSeries(L.CandlestickSeries, { title: 'DEMO' }).setData(bars);
    const volume = chart.addSeries(L.HistogramSeries, { title: 'Volume', priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false, priceFormat: { precision: 0, minMove: 1 } });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volume.setData(bars.map((b) => ({ time: b.time, value: b.volume })));
    const rsiLine = chart.addSeries(L.LineSeries, { title: 'RSI 14', lineWidth: 2, priceLineVisible: false, color: PALETTE[theme].second }, 1);
    rsiLine.setData(rsi(bars, 14));
    const guides = [70, 30].map((price) => L.createPriceLine(rsiLine, { price, lineStyle: 'dotted', axisLabelVisible: false, color: PALETTE[theme].guide }));
    return {
      chart,
      restyle(t) {
        chart.applyOptions({ theme: t });
        rsiLine.applyOptions({ color: PALETTE[t].second });
        for (const g of guides) g.applyOptions({ color: PALETTE[t].guide });
      },
    };
  },

  zone(el, L, theme) {
    const bars = makeIntraday(5, 37);
    const chart = L.createChart(el, { theme, ariaLabel: el.dataset.label, timeScale: { timeZone: 'Asia/Kolkata' } });
    chart.addSeries(L.CandlestickSeries, { title: 'DEMO-C' }).setData(bars);
    return { chart, restyle: (t) => chart.applyOptions({ theme: t }) };
  },
};

function create(el) {
  if (el.dataset.ready) return;
  const make = DEMOS[el.dataset.demo];
  const L = window.ChartistLite;
  if (!make || !L) return;
  el.dataset.ready = '1';
  el.textContent = '';
  try {
    const entry = make(el, L, currentTheme());
    el._demo = entry;
    registry.push(entry);
  } catch (err) {
    el.dataset.ready = '';
    el.textContent = 'This chart could not be drawn in this browser.';
  }
}

function initZones() {
  for (const group of document.querySelectorAll('[data-zones]')) {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-zone]');
      const el = group.closest('figure')?.querySelector('[data-demo]');
      if (!btn || !el) return;
      create(el);
      if (!el._demo) return;
      el._demo.chart.applyOptions({ timeScale: { timeZone: btn.dataset.zone } });
      for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    });
  }
}

function initCharts() {
  const targets = Array.from(document.querySelectorAll('[data-demo]'));
  if (targets.length === 0) return;
  if (!('IntersectionObserver' in window)) { targets.forEach(create); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); create(e.target); }
  }, { rootMargin: '200px' });
  targets.forEach((t) => io.observe(t));
}

initTheme();
initZones();
initCharts();
