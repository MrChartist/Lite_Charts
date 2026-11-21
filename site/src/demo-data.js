// Deterministic demo data, shared by the build (static fallback text and inline element data) and by the page script.
// Seeded random walks, not market data: nothing here stands for a real instrument or company.

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const r2 = (n) => +n.toFixed(2);

/** Daily bars on business days from 2 January 2024, as 'YYYY-MM-DD'. */
export function makeBars(count, seed = 7, startClose = 100) {
  const rand = rng(seed);
  const bars = [];
  let close = startClose;
  let day = Date.UTC(2024, 0, 2) / 1000;
  while (bars.length < count) {
    const wd = new Date(day * 1000).getUTCDay();
    if (wd !== 0 && wd !== 6) {
      const open = close;
      close = Math.max(1, open * (1 + (rand() - 0.49) * 0.04));
      const high = Math.max(open, close) * (1 + rand() * 0.012);
      const low = Math.min(open, close) * (1 - rand() * 0.012);
      bars.push({
        time: new Date(day * 1000).toISOString().slice(0, 10),
        open: r2(open), high: r2(high), low: r2(low), close: r2(close),
        volume: Math.round(800 + rand() * 1200),
      });
    }
    day += 86400;
  }
  return bars;
}

/** Five-minute bars, five sessions, UNIX seconds. A session runs 09:15 to 15:30 in UTC+5:30 (03:45 UTC onward). */
export function makeIntraday(sessions = 5, seed = 37) {
  const rand = rng(seed);
  const bars = [];
  let close = 1500;
  for (let d = 0; d < sessions; d++) {
    const start = Date.UTC(2024, 2, 4 + d, 3, 45) / 1000;
    for (let i = 0; i < 75; i++) {
      const open = close;
      close = Math.max(1, open * (1 + (rand() - 0.49) * 0.006));
      const high = Math.max(open, close) * (1 + rand() * 0.002);
      const low = Math.min(open, close) * (1 - rand() * 0.002);
      bars.push({ time: start + i * 300, open: r2(open), high: r2(high), low: r2(low), close: r2(close), volume: Math.round(900 + rand() * 1500) });
    }
  }
  return bars;
}

/** Simple moving average rows, `{ time }` alone while the window fills (used where the indicators script is not loaded). */
export function simpleAverage(bars, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= n) sum -= bars[i - n].close;
    out.push(i >= n - 1 ? { time: bars[i].time, value: r2(sum / n) } : { time: bars[i].time });
  }
  return out;
}

/** A second, calmer walk on the same days as makeBars (a stand-in benchmark), as { time, value }. */
export function makeBenchmark(bars, seed = 23, start = 250) {
  const rand = rng(seed);
  let v = start;
  return bars.map((b) => { v = Math.max(1, v * (1 + (rand() - 0.485) * 0.018)); return { time: b.time, value: r2(v) }; });
}
