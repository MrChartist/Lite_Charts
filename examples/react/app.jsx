// A minimal React page for @mrchartist/chartist-lite/react. Built by build.mjs (esbuild bundles React from node_modules).
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createChartistReact } from '../../src/react/index';

// One line per app: bind the wrapper to your React.
const { ChartistChart } = createChartistReact(React);

function sma(rows, n) {
  let sum = 0;
  return rows.map((r, i) => {
    sum += r.close;
    if (i >= n) sum -= rows[i - n].close;
    return i >= n - 1 ? { time: r.time, value: +(sum / n).toFixed(2) } : { time: r.time };
  });
}

function App({ stats }) {
  const [rows, setRows] = React.useState([]);
  const [legend, setLegend] = React.useState('');
  const candles = React.useMemo(() => rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })), [rows]);
  const average = React.useMemo(() => sma(rows, 20), [rows]);

  React.useEffect(() => {
    fetch('../data/demo-daily.json').then(r => r.json()).then(setRows);
  }, []);

  // A live tick: a NEW array whose last bar changed. The chart is not rebuilt; the last bar goes through update().
  const tick = () => setRows(prev => {
    const last = prev[prev.length - 1];
    const close = +(last.close * 1.01).toFixed(2);
    return [...prev.slice(0, -1), { ...last, close, high: Math.max(last.high, close) }];
  });
  const append = () => setRows(prev => {
    const last = prev[prev.length - 1];
    const d = new Date(last.time + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    const c = +(last.close * 1.005).toFixed(2);
    return [...prev, { time: d.toISOString().slice(0, 10), open: last.close, high: c + 1, low: last.close - 1, close: c, volume: 1000 }];
  });

  return (
    <>
      <header>
        <h1>DEMO · ChartistChart in React</h1>
        <div>
          <button id="tick" type="button" onClick={tick}>Live tick</button>{' '}
          <button id="append" type="button" onClick={append}>New bar</button>
        </div>
      </header>
      <div id="legend">{legend}</div>
      <div className="card">
        <ChartistChart
          height={420}
          ariaLabel="DEMO-A daily price with a 20-bar average, sample data"
          options={{ theme: 'auto' }}
          series={[
            { id: 'price', type: 'candlestick', data: candles, options: { title: 'DEMO-A' } },
            { id: 'sma', type: 'line', data: average, options: { title: 'SMA 20', lineWidth: 2, lastValueVisible: false, priceLineVisible: false } },
          ]}
          onReady={chart => { stats.ready += 1; stats.chart = chart; }}
          onCrosshairMove={p => {
            const row = [...p.seriesData.values()].find(r => r && 'close' in r);
            setLegend(row ? `${row.time}  O ${row.open}  H ${row.high}  L ${row.low}  C ${row.close}` : '');
          }}
        />
      </div>
    </>
  );
}

// ?strict=1 wraps the app in StrictMode (effects run twice in development). window.__app is read by the browser check.
const params = new URLSearchParams(location.search);
const stats = { ready: 0, chart: null };
const container = document.getElementById('root');
const root = createRoot(container);
const tree = <App stats={stats} />;
root.render(params.get('strict') === '1' ? <React.StrictMode>{tree}</React.StrictMode> : tree);
window.__app = { stats, container, unmount: () => root.unmount() };
