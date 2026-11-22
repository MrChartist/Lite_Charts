// The widget on examples/widget-hostile.html: demo bars, three panes, the extras' tooltip and watermark on.
const T = window.ChartistLiteTerminal;
const box = document.getElementById('w');
box.setAttribute('data-h', '');
window.__widget = T.createWidget(box, {
  symbol: { symbol: 'NOVA', description: 'Nova Industries (demo)' }, interval: '1D', height: 620,
  data: T.demoBars('NOVA', '1D', 500),
  indicators: ['bollinger', 'rsi', 'macd'],
  modules: { extras: window.ChartistLiteExtras },
  settings: { tooltip: 'floating', watermark: true },
});
