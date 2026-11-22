// Screenshots of examples/chart-types.html (every chart type on the same data, plus the big chart with its type
// switcher) in light and dark at device scale 2; fails on any console error or on a chart type that draws nothing.
// Then the brick (ordinal) time axis on examples/renko-axis.html: the labels of a constructed series equal the
// expected strings (the host's "Jun 2010, Aug 2020, 2021, Mar 2022"), the crosshair, its tag and inspect mode give a
// brick's true source date (the third brick of one bar included), no label is cut or overlaps at any zoom, spans and
// ranges select bricks by source date, markers / price lines / takeScreenshot work, and docs/screenshots/renko-axis-
// {light,dark}.png are shot. Last, examples/renko-live.html: ticks through createRenko + applyDelta append (and roll
// back) bricks without the axis jumping.
// Needs Playwright importable on this machine (it is NOT a dev dependency): `npm run build && node scripts/screenshots-chart-types.cjs`.
// If dist/chartist-lite-transforms.iife.min.js is missing (a build without the transforms entry) it is bundled here
// with the package's esbuild. CT_EXTRA=<dir> also writes one big-chart shot per chart type there.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const url = 'file://' + path.join(root, 'examples', 'chart-types.html');
const extra = process.env.CT_EXTRA || '';

async function ensureBundles() {
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const need = [
    ['chartist-lite.iife.min.js', 'src/index.ts', 'ChartistLite'],
    ['chartist-lite-transforms.iife.min.js', 'src/transforms/index.ts', 'ChartistLiteTransforms'],
  ].filter(([f]) => !fs.existsSync(path.join(dist, f)));
  if (!need.length) return;
  const { build } = require(path.join(root, 'node_modules', 'esbuild'));
  for (const [file, entry, globalName] of need) {
    await build({
      absWorkingDir: root, entryPoints: [entry], outfile: path.join('dist', file), bundle: true, format: 'iife', globalName,
      minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning',
    });
    console.log('bundled dist/' + file);
  }
}

(async () => {
  await ensureBundles();
  fs.mkdirSync(out, { recursive: true });
  if (extra) fs.mkdirSync(extra, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  await page.waitForTimeout(400);

  const ids = await page.evaluate(() => window.__types.ids);
  if (ids.length !== 16) problems.push(`expected 16 chart types, the page has ${ids.length}`);

  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => window.__types.setTheme(t), theme);
    await page.evaluate(() => window.__types.apply());
    await page.waitForTimeout(200);
    const drawn = await page.evaluate(() => window.__types.drawn());
    for (const d of drawn) if (!(d.rows > 0) || d.marked < 30) problems.push(`${theme}: chart "${d.id}" drew ${d.marked} marked pixels from ${d.rows} rows`);

    // Every type on the big chart, with its default inputs, then a few inputs changed.
    if (theme === 'light') {
      for (const id of ids) {
        await page.evaluate(i => window.__types.selectBig(i), id);
        await page.waitForTimeout(80);
        const d = (await page.evaluate(() => window.__types.drawn())).pop();
        if (!(d.rows > 0) || d.marked < 30) problems.push(`big chart "${id}" drew ${d.marked} marked pixels from ${d.rows} rows`);
        if (extra) await page.locator('#big').screenshot({ path: path.join(extra, `big-${id}-${theme}.png`) });
      }
      const changed = await page.evaluate(() => {
        const t = window.__types;
        const res = {};
        const set = (id, key, v) => { t.settings[id][key] = v; t.selectBig(id); t.apply(); const a = t.states[t.states.length - 1].applied; return a.info; };
        res.renko = set('renko', 'brick', 1.5);
        res.kagi = set('kagi', 'reversal', 2);
        res.pf = set('pointFigure', 'box', 1);
        res.range = set('rangeBars', 'range', 2);
        res.lb = set('lineBreak', 'lines', 2);
        return res;
      });
      console.log(JSON.stringify(changed));
      if (changed.renko.brick !== 1.5 || changed.kagi.reversal !== 2 || changed.pf.box !== 1 || changed.range.range !== 2 || changed.lb.lines !== 2) problems.push('inputs did not reach the transforms');
      await page.evaluate(() => { const t = window.__types; for (const [id, k, v] of [['renko', 'brick', 0], ['kagi', 'reversal', 1.5], ['pointFigure', 'box', 0], ['rangeBars', 'range', 0], ['lineBreak', 'lines', 3]]) t.settings[id][k] = v; t.selectBig('candles'); });
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: path.join(out, `chart-types-${theme}.png`), fullPage: true });
  }

  await page.close();
  await brickAxis(browser, errors, problems);
  await liveBricks(browser, errors, problems);

  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log('no console errors; every chart type drew; brick axis checks passed');
})().catch(e => { console.error(e); process.exit(1); });

const check = (problems, ok, what, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
  if (!ok) problems.push(what);
};

/** In the page: labels of `chart` that are cut by an edge or closer than 12 px to a neighbour (none expected). */
function badLabels(chart) {
  const w = chart.timeScale().width();
  const t = chart.timeTicks;
  const bad = [];
  for (let i = 0; i < t.length; i++) {
    const l = t[i].textX - t[i].width / 2, r = t[i].textX + t[i].width / 2;
    if (l < 0 || r > w) bad.push(`cut ${t[i].text}`);
    if (i && l - (t[i - 1].textX + t[i - 1].width / 2) < 12 - 1e-6) bad.push(`overlap ${t[i - 1].text}|${t[i].text}`);
    if (!Number.isInteger(t[i].index)) bad.push(`off a brick ${t[i].text}`);
  }
  return bad;
}

async function brickAxis(browser, errors, problems) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[renko-axis ${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[renko-axis pageerror] ${e.message}`));
  await page.goto('file://' + path.join(root, 'examples', 'renko-axis.html'));
  await page.waitForTimeout(400);
  await page.evaluate(`window.__badLabels = ${badLabels.toString()}`);

  // 1. A constructed series: the host README's example. Bricks dated 2010, a ten-year gap, 2020, 2021, 2022.
  const probe = await page.evaluate(() => {
    const A = window.__axis;
    const days = ['2010-06-14', '2010-06-15', '2010-09-02', '2020-08-18', '2020-08-19', '2021-01-04', '2022-03-09', '2022-03-10'];
    const rows = days.map((time, i) => ({ time, open: 10 + i, high: 11 + i, low: 10 + i, close: 11 + i }));
    const { chart } = A.makeProbe(rows);
    return { ordinal: chart.timeScale().isOrdinal(), all: chart.timeTicks.map(t => t.text), years: chart.timeTicks.filter(t => t.level === 4).map(t => t.text), bad: window.__badLabels(chart) };
  });
  check(problems, probe.ordinal, 'probe chart is on the ordinal axis');
  check(problems, JSON.stringify(probe.years) === JSON.stringify(['Jun 2010', 'Aug 2020', '2021', 'Mar 2022']), 'year labels name their month unless the brick is in January (Jun 2010, Aug 2020, 2021, Mar 2022)', probe.years);
  check(problems, JSON.stringify(probe.all) === JSON.stringify(['Jun 2010', '15', 'Sep', 'Aug 2020', '19', '2021', 'Mar 2022', '10']), 'every label of the constructed series', probe.all);
  check(problems, probe.bad.length === 0, 'probe: no label cut or overlapping', probe.bad);

  // 2. Several bricks from one bar: the crosshair, its tag, the event and inspect mode give the true date.
  const cross = await page.evaluate(async () => {
    const A = window.__axis;
    const days = ['2024-03-14', '2024-03-15', '2024-03-15', '2024-03-15', '2024-03-15', '2024-03-19', '2024-04-02', '2024-04-02', '2024-05-21'];
    const rows = days.map((time, i) => ({ time, open: 10 + i, high: 11 + i, low: 10 + i, close: 11 + i }));
    const { chart, series } = A.makeProbe(rows);
    let seen = null;
    chart.subscribeCrosshairMove(p => { seen = p; });
    const ts = chart.timeScale();
    const el = chart.element();
    const r = el.getBoundingClientRect();
    const x = ts.logicalToCoordinate(3);
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + x, clientY: r.top + 100, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const row = seen && seen.seriesData.get(series);
    const out = { time: seen && seen.time, logical: seen && seen.logical, close: row && row.close, stamp: chart.stampText(3), coordTime: ts.coordinateToTime(x), firstOfTime: ts.timeToLogical('2024-03-15'), v3: ts.timeToLogical(ts.logicalToTime(3)) };
    // Keyboard inspect mode reads the bar under the crosshair, then steps one brick at a time.
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const liveRegion = [...el.querySelectorAll('[aria-live]')].pop();
    out.spoken = liveRegion.textContent;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    out.spoken2 = liveRegion.textContent;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    // Markers and price lines on a repeated time, and a screenshot.
    A.L.createSeriesMarkers(series, [{ time: '2024-03-15', position: 'aboveBar', shape: 'arrowDown', text: 'M' }]);
    A.L.createPriceLine(series, { price: 14.5, title: 'level' });
    chart.paint();
    const shot = chart.takeScreenshot();
    out.shot = [shot.width, shot.height];
    out.range = (ts.setVisibleRange({ from: '2024-03-15', to: '2024-04-02' }), chart.paint(), ts.getVisibleLogicalRange());
    out.visible = ts.getVisibleRange();
    return out;
  });
  check(problems, cross.time === '2024-03-15' && cross.logical === 3 && cross.close === 14, 'crosshair on the third brick of one bar: event time and row are that brick and its true date', cross);
  check(problems, cross.stamp === 'Fri 15 Mar 2024' && cross.coordTime === '2024-03-15', 'crosshair tag and coordinateToTime show the true source date', { stamp: cross.stamp, coordTime: cross.coordTime });
  check(problems, cross.firstOfTime === 1 && Math.abs(cross.v3 - 3) < 1e-9, 'timeToLogical: a repeated time is its first brick; logicalToTime / timeToLogical round-trip a later brick', { first: cross.firstOfTime, v3: cross.v3 });
  check(problems, cross.spoken.startsWith('Fri 15 Mar 2024; PROBE: open 13.00') && cross.spoken2.startsWith('Tue 19 Mar 2024; PROBE: open 15.00'), 'inspect mode speaks the brick\'s true date and its own values', [cross.spoken, cross.spoken2]);
  check(problems, cross.shot[0] === 1800 && cross.shot[1] === 640, 'takeScreenshot on a brick chart', cross.shot);
  // Eight bricks are wider than the widest bar spacing allows, so the view keeps its right end (both 2 Apr bricks).
  check(problems, cross.range.from <= 1 + 1e-9 && Math.abs(cross.range.to - 7) < 1e-9, 'setVisibleRange on a short series: ends on the last brick of the range\'s last date', cross.range);

  // 3. The big chart: no label cut or overlapping, fitted, zoomed in and panned; spans pick bricks by source date.
  const big = await page.evaluate(async () => {
    const A = window.__axis;
    const c = A.big;
    const ts = c.timeScale();
    const frame = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const out = { bad: [], labels: [] };
    const look = async (what) => { await frame(); out.bad.push(...window.__badLabels(c).map(b => `${what}: ${b}`)); out.labels.push(`${what}: ${c.timeTicks.map(t => t.text).join(', ')}`); };
    ts.fitContent(); await look('fit');
    for (const n of [120, 60, 25]) { const last = A.applied.data.length - 1; ts.setVisibleLogicalRange({ from: last - n, to: last + 2 }); await look(`last ${n}`); }
    ts.setVisibleLogicalRange({ from: 30, to: 90 }); await look('30..90');
    // setVisibleRange: from the first brick dated `from` to the LAST brick dated `to` (repeated times included), on
    // a probe of 300 bricks where every seventh day made three.
    {
      const rows = [];
      for (let d = 0; rows.length < 300; d++) {
        const time = new Date(Date.UTC(2021, 0, 4) + d * 86400000).toISOString().slice(0, 10);
        for (let k = 0; k < (d % 7 === 3 ? 3 : 1); k++) rows.push({ time, open: 10, high: 11, low: 10, close: 11 });
      }
      const p = A.makeProbe(rows).chart;
      const fromT = rows[100].time;
      const rep = rows.findIndex((r, i) => i > 150 && rows[i + 1] && rows[i + 1].time === r.time);
      p.timeScale().setVisibleRange({ from: fromT, to: rows[rep].time }); p.paint();
      const vr = p.timeScale().getVisibleLogicalRange();
      out.range = { from: vr.from, to: vr.to, wantFrom: rows.findIndex(r => r.time === fromT), wantTo: rep + 2, rep };
    }
    ts.setVisibleSpan('3Y'); await frame();
    const r = ts.getVisibleLogicalRange();
    const data = A.applied.data;
    const first = Math.ceil(r.from);
    const lastDay = data[data.length - 1].time;
    const start = (Number(lastDay.slice(0, 4)) - 3) + lastDay.slice(4);
    out.span = { first, firstTime: data[first].time, before: data[first - 1] && data[first - 1].time, start };
    ts.fitContent(); await frame();
    return out;
  });
  check(problems, big.bad.length === 0, 'large Renko chart: no label cut or overlapping (fit, zoomed in, panned)', big.bad);
  console.log(big.labels.join('\n'));
  check(problems, Math.abs(big.range.from - big.range.wantFrom) < 1e-6 && Math.abs(big.range.to - big.range.wantTo) < 1e-6 && big.range.wantTo > big.range.rep, 'setVisibleRange: from the first brick dated `from` to the last brick dated `to` (a repeated date)', big.range);
  check(problems, big.span.firstTime >= big.span.start && (!big.span.before || big.span.before < big.span.start), 'setVisibleSpan(\'3Y\'): the first brick shown is the first whose source date is in the span', big.span);

  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => window.__axis.setTheme(t), theme);
    await page.waitForTimeout(150);
    await page.locator('#big').screenshot({ path: path.join(out, `renko-axis-${theme}.png`) });
  }
  await page.close();
}

async function liveBricks(browser, errors, problems) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 620 } });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[renko-live ${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[renko-live pageerror] ${e.message}`));
  await page.goto('file://' + path.join(root, 'examples', 'renko-live.html?manual'));
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    const R = window.__renkoLive;
    const c = R.chart;
    const ts = c.timeScale();
    const frame = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const snap = () => c.timeTicks.map(t => ({ i: t.index, x: t.x, text: t.text }));
    const out = { ordinal: ts.isOrdinal() };
    // Scrolled back into history: new bricks must not move the view or its labels at all.
    ts.setVisibleLogicalRange({ from: 100, to: 220 });
    await frame();
    const a = snap();
    let added = 0, removed = 0;
    for (let k = 0; k < 300; k++) { const d = R.tick(); added += d.rows.length; removed += d.removed; }
    await frame();
    const b = snap();
    out.back = { same: JSON.stringify(a) === JSON.stringify(b), added, removed, labels: a.length };
    // At the live edge: the view follows; every label still in view keeps its text and moves left by whole bricks.
    ts.scrollToRealTime();
    await frame();
    const n0 = R.main.data().length;
    const before = snap();
    const sp = ts.logicalToCoordinate(1) - ts.logicalToCoordinate(0);
    let grew = 0;
    for (let k = 0; k < 400 && !grew; k++) { R.tick(); grew = R.main.data().length - n0; }
    await frame();
    const after = snap();
    const moved = [];
    for (const t of after) {
      const p = before.find(x => x.i === t.i);
      if (p) moved.push({ text: t.text === p.text, dx: +(((p.x - t.x) / sp)).toFixed(6) });
    }
    out.edge = { grew, kept: moved.length, sameText: moved.every(m => m.text), shifts: [...new Set(moved.map(m => m.dx))] };
    out.rows = { main: R.main.data().length, vol: R.vol.data().length, inc: R.inc.rows.length, equal: JSON.stringify(R.main.data().map(x => [x.time, x.open, x.close])) === JSON.stringify(R.inc.rows.map(x => [x.time, x.open, x.close])) };
    return out;
  });
  check(problems, r.ordinal, 'live Renko: ordinal axis');
  check(problems, r.back.same && r.back.added > 0 && r.back.labels > 3, 'live Renko scrolled back: bricks append (and roll back) without the axis moving', r.back);
  check(problems, r.edge.grew > 0 && r.edge.kept > 3 && r.edge.sameText && r.edge.shifts.length === 1 && r.edge.shifts[0] === r.edge.grew, 'live Renko at the edge: labels keep their text and shift by exactly the new bricks', r.edge);
  check(problems, r.rows.equal && r.rows.main === r.rows.vol && r.rows.main === r.rows.inc, 'live Renko: the chart holds exactly the incremental transform\'s bricks (and the volume rows line up)', r.rows);
  await page.close();
}
