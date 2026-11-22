// Frame-cost bench (`npm run bench`): can every gesture paint inside one 120 Hz frame (8.33 ms), and a 144 Hz one
// (6.94 ms)? On the production build (dist/, minified) in Playwright's Chromium, it measures the COST of each frame:
// the input handlers for that frame, every requestAnimationFrame callback the chart queued, and the style and layout
// of the DOM it wrote (the legend), timed in the page. Headless Chromium runs requestAnimationFrame at about 60 Hz and
// has no GPU, so this is not a frame rate and not a 120 Hz panel; canvas rasterisation and compositing are not in the
// number (they run after the frame's script, on the GPU on real hardware). Numbers move with the machine: compare runs
// on one machine. Writes docs/performance.json and docs/PERFORMANCE.md; exit 1 when any p95 is over 8.33 ms.
//
//   npm run bench                       full matrix (needs `npm run build` first; npm run bench builds)
//   node scripts/bench.cjs --quick      1k and 100k bars, DPR 1 only
const { chromium } = require('playwright');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const quick = process.argv.includes('--quick');
const BUDGET_120 = 8.33;
const BUDGET_144 = 6.94;
const FRAMES = 200;
const WARM = 20;
const SIZES = quick ? [1000, 100000] : [1000, 10000, 100000];
const DPRS = quick ? [1] : [1, 2];
const CHARTS = ['plain', 'indicators', 'drawings', 'live', 'widget'];
const SCENARIOS = { plain: ['crosshair', 'pan', 'zoom', 'tick', 'fit'], indicators: ['crosshair', 'pan', 'zoom', 'tick', 'fit'], drawings: ['crosshair', 'pan', 'zoom', 'tick', 'fit', 'drag'], live: ['crosshair', 'trades'], widget: ['crosshair', 'pan', 'zoom', 'tick'] };
/** The widget is measured at 10k bars (its scenario: three indicators, pan and crosshair). */
const SIZES_FOR = { widget: [10000] };

const stat = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), worst: +s[s.length - 1].toFixed(3) };
};

(async () => {
  for (const f of ['chartist-lite.iife.min.js', 'chartist-lite-indicators.iife.min.js']) {
    if (!fs.existsSync(path.join(root, 'dist', f))) throw new Error(`run \`npm run build\` first (dist/${f} is missing)`);
  }
  const browser = await chromium.launch();
  const machine = {
    cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, memoryGB: +(os.totalmem() / 2 ** 30).toFixed(1),
    platform: `${os.platform()} ${os.release()}`, chromium: browser.version(), node: process.version, date: new Date().toISOString(),
    headless: true, gpu: 'none (headless; canvas rasterised on the CPU outside the measured frame)',
  };
  const results = [];
  const errors = [];
  for (const dpr of DPRS) {
    const page = await browser.newPage({ viewport: { width: 1240, height: 640 }, deviceScaleFactor: dpr });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push(m.text()); });
    await page.goto('file://' + path.join(root, 'scripts', 'bench-page.html'));
    for (const chart of CHARTS) {
      for (const bars of SIZES_FOR[chart] ?? SIZES) {
        const ok = await page.evaluate(([k, n]) => window.__setup(k, n), [chart, bars]);
        if (!ok) { results.push({ chart, bars, dpr, skipped: `${chart} entry not built` }); continue; }
        for (const scenario of SCENARIOS[chart]) {
          await page.evaluate(() => window.__raster());
          const costs = await page.evaluate(([s, f, w]) => window.__run(s, f, w), [scenario, FRAMES, WARM]);
          if (scenario === 'trades' && !(await page.evaluate(() => window.__tradesGrew))) errors.push(`trades scenario added no bars (${chart}, ${bars}, DPR ${dpr})`);
          if (scenario === 'drag' && !(await page.evaluate(() => window.__dragMoved))) errors.push(`drag scenario did not move the drawing (${chart}, ${bars}, DPR ${dpr})`);
          const raster = stat((await page.evaluate(() => window.__raster())).slice(WARM));
          const st = stat(costs);
          const row = { chart, scenario, bars, dpr, frames: costs.length, ...st, rasterMedianCpu: raster.median, rasterP95Cpu: raster.p95, within120: st.p95 <= BUDGET_120, within144: st.p95 <= BUDGET_144 };
          results.push(row);
          console.log(`${row.within120 ? 'ok  ' : 'OVER'} ${chart.padEnd(10)} ${scenario.padEnd(9)} ${String(bars).padStart(6)} bars  DPR ${dpr}   median ${st.median.toFixed(2).padStart(5)}  p95 ${st.p95.toFixed(2).padStart(5)}  worst ${st.worst.toFixed(2).padStart(6)} ms   (raster cpu p95 ${raster.p95.toFixed(2)})`);
        }
      }
    }
    await page.close();
  }
  await browser.close();
  const measured = results.filter(r => !r.skipped);
  const over = measured.filter(r => !r.within120);
  const doc = {
    what: 'Frame COST per gesture step in headless Chromium: input handlers + requestAnimationFrame callbacks + style/layout of DOM the frame wrote. Not a frame rate, not measured on a 120 Hz panel, no GPU (rasterisation not included).',
    budgets: { hz120: BUDGET_120, hz144: BUDGET_144 }, framesPerScenario: FRAMES, warmupFrames: WARM, viewport: '1240 x 640 CSS px (chart 1200 x 600)',
    machine, quick, results, summary: { scenarios: measured.length, over120: over.length, over144: measured.filter(r => !r.within144).length, worstP95: Math.max(...measured.map(r => r.p95)) },
    errors,
  };
  if (!quick) {
    fs.writeFileSync(path.join(root, 'docs', 'performance.json'), JSON.stringify(doc, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'docs', 'PERFORMANCE.md'), markdown(doc));
  }
  console.log(`\n${measured.length} scenarios; p95 over 8.33 ms: ${over.length}; over 6.94 ms: ${doc.summary.over144}; worst p95 ${doc.summary.worstP95} ms`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  if (over.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });

function markdown(doc) {
  const m = doc.machine;
  const rows = doc.results.filter(r => !r.skipped);
  const head = '| Chart | Gesture | Bars | DPR | Median ms | p95 ms | Worst ms | 120 Hz | 144 Hz | CPU raster p95 ms (info) |\n|---|---|---|---|---|---|---|---|---|---|\n';
  const body = rows.map(r => `| ${r.chart} | ${r.scenario} | ${r.bars} | ${r.dpr} | ${r.median.toFixed(2)} | ${r.p95.toFixed(2)} | ${r.worst.toFixed(2)} | ${r.within120 ? 'yes' : 'NO'} | ${r.within144 ? 'yes' : 'NO'} | ${r.rasterP95Cpu.toFixed(2)} |`).join('\n');
  const worst = (filter) => { const xs = rows.filter(filter); return xs.length ? Math.max(...xs.map(r => r.p95)).toFixed(2) : 'n/a'; };
  return `# Performance: frame cost against 120 Hz and 144 Hz

Generated by \`npm run bench\` (\`scripts/bench.cjs\`) on ${m.date.slice(0, 10)}. Raw numbers: \`docs/performance.json\`.

## Headline

A 120 Hz display gives each frame 8.33 ms, a 144 Hz display 6.94 ms. In this run the highest p95 frame cost of any
gesture was **${doc.summary.worstP95.toFixed(2)} ms**; ${doc.summary.over120} of ${doc.summary.scenarios} scenarios had a p95 over 8.33 ms and
${doc.summary.over144} over 6.94 ms.

| Worst p95 (ms) | 1k bars | 10k bars | 100k bars |
|---|---|---|---|
| Crosshair | ${worst(r => r.scenario === 'crosshair' && r.bars === 1000)} | ${worst(r => r.scenario === 'crosshair' && r.bars === 10000)} | ${worst(r => r.scenario === 'crosshair' && r.bars === 100000)} |
| Pan | ${worst(r => r.scenario === 'pan' && r.bars === 1000)} | ${worst(r => r.scenario === 'pan' && r.bars === 10000)} | ${worst(r => r.scenario === 'pan' && r.bars === 100000)} |
| Wheel zoom | ${worst(r => r.scenario === 'zoom' && r.bars === 1000)} | ${worst(r => r.scenario === 'zoom' && r.bars === 10000)} | ${worst(r => r.scenario === 'zoom' && r.bars === 100000)} |
| Live tick | ${worst(r => r.scenario === 'tick' && r.bars === 1000)} | ${worst(r => r.scenario === 'tick' && r.bars === 10000)} | ${worst(r => r.scenario === 'tick' && r.bars === 100000)} |
| Live tick, whole series in view | ${worst(r => r.scenario === 'fit' && r.bars === 1000)} | ${worst(r => r.scenario === 'fit' && r.bars === 10000)} | ${worst(r => r.scenario === 'fit' && r.bars === 100000)} |
| Drag a drawing | ${worst(r => r.scenario === 'drag' && r.bars === 1000)} | ${worst(r => r.scenario === 'drag' && r.bars === 10000)} | ${worst(r => r.scenario === 'drag' && r.bars === 100000)} |
| Live trades (20 a frame) | ${worst(r => r.scenario === 'trades' && r.bars === 1000)} | ${worst(r => r.scenario === 'trades' && r.bars === 10000)} | ${worst(r => r.scenario === 'trades' && r.bars === 100000)} |

(Worst p95 over the three charts and both pixel ratios.)

## What was measured, and what was not

- **Measured:** the COST of one frame of our code on the main thread: the input handlers for that gesture step, every
  \`requestAnimationFrame\` callback the chart queued (layout of scales and ticks, autoscale, series and overlay canvas
  drawing calls), and the browser's style and layout of DOM the frame wrote (the legend). The bench runs the queued
  callbacks itself, so no frame waits for vsync. ${doc.framesPerScenario} frames per scenario after ${doc.warmupFrames} warm-up frames;
  median, p95 and worst.
- **CPU raster (information only):** after each frame the bench forces the canvases to rasterise (a one-pixel read)
  and times that apart. Headless Chromium has no GPU, so this is software rasterisation on the CPU; on real hardware it
  runs on the GPU, off the main thread. It is not judged, but a draw that makes it large is worth watching.
- **Not measured:** a real 120 Hz or 144 Hz panel (headless Chromium runs \`requestAnimationFrame\` at about 60 Hz), the
  GPU (headless has none), canvas rasterisation and compositing (they run after the frame's script; on real hardware on
  the GPU), and input latency. Treat these numbers as budgets for our own work per frame, measured on one machine.
- **Charts:** widget (the whole \`createWidget\` workspace at 10k bars: top bar, range bar, legend rows, volume, SMA and
  Bollinger with its band fill on price, RSI in a pane), plain (candles), indicators (candles with SMA 20 and two Bollinger lines, an RSI pane and a MACD pane with
  histogram and two lines: three indicators, two extra panes), drawings (candles with 20 drawings of every tool).
- **Gestures:** crosshair (pointer moves), pan (a held drag), wheel zoom (ctrl + wheel, in and out), live tick
  (\`update()\` of the last bar at the opening zoom), live tick with the whole series in view (\`fitContent()\` first, the
  most bars a frame can hold), drag a drawing (selected horizontal line), live trades (the live entry end to end except
  the network: 20 Coinbase trade messages a frame parsed, folded into bars and painted once per frame; a live chart
  holds at most 5000 bars of history, so its 10k and 100k rows load 5000).
- **Data:** ${SIZES.join(' / ')} one-minute bars, time zone America/New_York. Chart 1200 x 600 CSS px.

## Why the engine can use every refresh

- Every change is applied at once and painted by the next \`requestAnimationFrame\`; several changes in one frame are
  coalesced into one paint. There is no timer, throttle or 60 Hz cap in input, kinetic scroll or the crosshair fade.
- Kinetic scroll and the crosshair fade are time-based (elapsed milliseconds), so they run the same at 60, 120 or 144 Hz.
- Pointer moves update the view state only; the latest position is painted once per frame (no coalesced-event replay).
- Pointer listeners are passive; only wheel, double-click and keydown listeners can cancel the event.
- A crosshair move repaints only the overlay canvas; series are not redrawn.

## Machine

| | |
|---|---|
| CPU | ${m.cpu} (${m.cores} cores) |
| Memory | ${m.memoryGB} GB |
| OS | ${m.platform} |
| Chromium | ${m.chromium} (Playwright, headless) |
| Node | ${m.node} |
| Date | ${m.date} |

## All scenarios

${head}${body}
`;
}
