// External script (the page's CSP forbids inline scripts).
(function () {
  const L = window.ChartistLite;
  function bars(n) {
    const out = [];
    let c = 100;
    for (let i = 0; i < n; i++) {
      const o = c;
      c = Math.max(1, c * (1 + Math.sin(i * 0.7) * 0.02));
      out.push({ time: 1700000000 + i * 86400, open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c });
    }
    return out;
  }
  const chart = L.createChart('chart', { ariaLabel: 'Hostile page chart', timeScale: { timeZone: 'America/New_York' } });
  const s = chart.addSeries(L.CandlestickSeries, { title: 'TEST' });
  s.setData(bars(300));
  // A chart in a hidden container: fitContent must be applied once it gets a width.
  const hidden = L.createChart('hidden-box');
  const hs = hidden.addSeries(L.LineSeries);
  hs.setData(bars(500).map(b => ({ time: b.time, value: b.close })));
  hidden.timeScale().fitContent();
  if (window.ChartistLiteElement && window.ChartistLiteElement.defineChartistElement) window.ChartistLiteElement.defineChartistElement();
  window.__hostile = { chart, series: s, hidden, hiddenSeries: hs, bars };
})();
