// In-page part of scripts/bench.cjs. setup() builds a chart; run() drives one scenario and returns frame costs (ms).
(function () {
  const L = window.ChartistLite;
  const I = window.ChartistLiteIndicators;
  let chart = null;
  let candles = null;
  let bars = [];
  let drawings = null;
  let live = null;
  let liveTick = null;
  let liveClock = 0;

  function makeBars(n) {
    const out = [];
    let c = 100;
    let s = 7;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      const o = c;
      c = Math.max(1, c * (1 + (rand() - 0.495) * 0.01));
      out.push({ time: 1600000000 + i * 60, open: o, high: Math.max(o, c) * (1 + rand() * 0.002), low: Math.min(o, c) * (1 - rand() * 0.002), close: c });
    }
    return out;
  }

  window.__setup = async (kind, n) => {
    if (chart) { drawings && drawings.destroy(); live && live.disconnect(); chart.remove(); drawings = null; live = null; }
    bars = makeBars(n);
    chart = L.createChart('c', { timeScale: { timeZone: 'America/New_York' } });
    candles = chart.addSeries(L.CandlestickSeries, { title: 'BENCH' });
    candles.setData(bars);
    if (kind === 'indicators') {
      chart.addSeries(L.LineSeries, { title: 'SMA 20', lastValueVisible: false, priceLineVisible: false }).setData(I.sma(bars, 20));
      const bb = I.bollinger(bars, { period: 20, mult: 2 });
      chart.addSeries(L.LineSeries, { title: 'BB upper', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(bb.upper);
      chart.addSeries(L.LineSeries, { title: 'BB lower', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(bb.lower);
      chart.addSeries(L.LineSeries, { title: 'RSI 14' }, 1).setData(I.rsi(bars, 14));
      const m = I.macd(bars, { fast: 12, slow: 26, signal: 9 });
      chart.addSeries(L.HistogramSeries, { title: 'Histogram' }, 2).setData(m.histogram);
      chart.addSeries(L.LineSeries, { title: 'MACD' }, 2).setData(m.macd);
      chart.addSeries(L.LineSeries, { title: 'Signal' }, 2).setData(m.signal);
    }
    if (kind === 'drawings') {
      const D = window.ChartistLiteDrawings;
      if (!D) return false;
      drawings = D.createDrawingTools(chart, candles, { toolbar: false });
      const last = bars.length - 1;
      const t = i => bars[Math.max(0, Math.min(last, i))].time;
      const p = i => bars[Math.max(0, Math.min(last, i))].close;
      const tools = ['trend', 'ray', 'extended', 'horizontal', 'horizontalRay', 'vertical', 'rectangle', 'channel', 'fib', 'measure', 'long', 'short', 'arrow', 'text'];
      for (let k = 0; k < 20; k++) {
        const tool = tools[k % tools.length];
        const a = last - 140 + k * 6;
        const b = a + 12;
        const pts = tool === 'channel' ? [{ time: t(a), price: p(a) }, { time: t(b), price: p(b) }, { time: t(a), price: p(a) * 1.01 }]
          : [{ time: t(a), price: p(a) }, { time: t(b), price: p(b) * 1.004 }];
        drawings.add({ tool, points: pts, text: tool === 'text' ? 'Note' : undefined });
      }
    }
    if (kind === 'live') {
      const LV = window.ChartistLiteLive;
      if (!LV) return false;
      // The live path end to end except the network: a provider that serves the generated bars as history and
      // feeds Coinbase "match" messages (as JSON text, parsed by the real parser) into connectLive.
      const provider = {
        id: 'bench', intervals: ['1m'], canPageBack: false,
        history: async (_s, _i, range) => bars.slice(-range.limit).map(b => ({ ...b, volume: 1 })),
        subscribe: (_s, _i, on) => {
          liveTick = text => { const t = LV.parseCoinbaseMessage(JSON.parse(text)); if (t) on.tick(t); };
          on.open();
          return () => { liveTick = null; };
        },
      };
      live = LV.connectLive(candles, { provider, interval: '1m', history: Math.min(n, 5000), chart });
      await new Promise(r => setTimeout(r, 0));
      liveClock = bars[bars.length - 1].time;
      if (live.status() !== 'live') return false;
    }
    chart.paint();
    window.__flush();
    return true;
  };

  const root = () => chart.element();
  const fire = (type, x, y, extra) => {
    const r = root().getBoundingClientRect();
    const init = Object.assign({ bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, pointerId: 1, pointerType: 'mouse', isPrimary: true }, extra || {});
    root().dispatchEvent(type === 'wheel' ? new WheelEvent('wheel', init) : new PointerEvent(type, init));
  };

  const canvases = () => [...document.querySelectorAll('#c canvas')];
  let rasterMs = [];

  function frame(step) {
    const t0 = performance.now();
    step();
    window.__flush();
    void document.body.offsetHeight; // style + layout of any DOM the frame wrote (the legend) is our cost too
    const cost = performance.now() - t0;
    // Make the canvases rasterise now, as a presented frame would (a one-pixel read forces it). Without this the
    // recordings of every frame in the loop pile up and one late frame pays for all of them. Timed apart: headless
    // Chromium has no GPU, so this is CPU rasterisation, reported for information and not judged.
    const r0 = performance.now();
    for (const c of canvases()) c.getContext('2d').getImageData(0, 0, 1, 1);
    rasterMs.push(performance.now() - r0);
    return cost;
  }
  window.__raster = () => { const r = rasterMs; rasterMs = []; return r; };

  window.__run = (scenario, frames, warm) => {
    const costs = [];
    const W = chart.timeScale().width();
    const H = chart.panes()[0].getHeight();
    let k = 0;
    const tick = () => {
      const lastBar = bars[bars.length - 1];
      const close = lastBar.close * (1 + Math.sin(k) * 0.001);
      candles.update(Object.assign({}, lastBar, { close, high: Math.max(lastBar.high, close), low: Math.min(lastBar.low, close) }));
    };
    let step;
    if (scenario === 'crosshair') step = () => fire('pointermove', 20 + ((k * 7) % (W - 40)), 40 + ((k * 3) % (H - 80)));
    else if (scenario === 'pan') {
      fire('pointerdown', W / 2, H / 2, { button: 0, buttons: 1 });
      let x = W / 2;
      step = () => { x += (Math.floor(k / 60) % 2 ? -4 : 4); fire('pointermove', x, H / 2, { buttons: 1 }); };
    } else if (scenario === 'zoom') step = () => fire('wheel', W * 0.7, H / 2, { deltaY: Math.floor(k / 30) % 2 ? 40 : -40, ctrlKey: true });
    else if (scenario === 'tick') step = tick;
    else if (scenario === 'trades') {
      window.__tradesFrom = candles.data().length;
      // 20 trades a frame (a busy BTC burst; Coinbase averages a few a second), a new minute every 60 frames.
      let id = 1;
      step = () => {
        for (let j = 0; j < 20; j++) {
          liveClock += 0.05;
          const price = 100 + Math.sin(liveClock) * 2;
          liveTick(JSON.stringify({ type: 'match', trade_id: id++, price: String(price), size: '0.01', time: new Date(liveClock * 1000).toISOString() }));
        }
      };
    }
    else if (scenario === 'fit') { chart.timeScale().fitContent(); window.__flush(); step = tick; }
    else if (scenario === 'drag') {
      // Drag one drawing (a horizontal line at the middle) up and down.
      const d = drawings.add({ tool: 'horizontal', points: [{ time: bars[bars.length - 1].time, price: candles.coordinateToPrice(H / 2) }] });
      window.__dragFrom = d.points[0].price;
      drawings.select(d.id);
      chart.paint(); window.__flush();
      fire('pointerdown', W / 3, H / 2, { button: 0, buttons: 1 });
      let y = H / 2;
      step = () => { y += (Math.floor(k / 40) % 2 ? -2 : 2); fire('pointermove', W / 3 + (k % 5), y, { buttons: 1 }); };
    }
    for (k = 0; k < frames + warm; k++) {
      const c = frame(step);
      if (k >= warm) costs.push(c);
    }
    if (scenario === 'pan' || scenario === 'drag') fire('pointerup', W / 2, H / 2, { button: 0, buttons: 0 });
    if (scenario === 'trades') window.__tradesGrew = candles.data().length > window.__tradesFrom;
    if (scenario === 'drag') {
      // The drag must have moved the line, or the scenario measured nothing.
      const d = drawings.drawings().find(x => x.tool === 'horizontal' && x.id === drawings.selected()?.id);
      window.__dragMoved = !!d && Math.abs(d.points[0].price - window.__dragFrom) > 0;
    }
    window.__flush();
    chart.timeScale().resetTimeScale();
    window.__flush();
    return costs;
  };
})();
