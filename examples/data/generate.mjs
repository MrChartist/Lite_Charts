// Writes the DEMO sample files next to this script: node examples/data/generate.mjs
// Seeded random walks, not market data: DEMO-A, DEMO-B and DEMO-C stand for no real instrument or company.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function bar(rand, open, vol) {
  const close = Math.max(1, open * (1 + (rand() - 0.49) * 0.03));
  const high = Math.max(open, close) * (1 + rand() * 0.008);
  const low = Math.min(open, close) * (1 - rand() * 0.008);
  const r = n => +n.toFixed(2);
  return { open: r(open), high: r(high), low: r(low), close: r(close), volume: Math.round(vol * (0.6 + rand() * 0.8)) };
}

// 260 business days of DEMO-A, as dates.
const rand = rng(11);
const daily = [];
let close = 250;
for (let day = Date.UTC(2024, 0, 1) / 1000; daily.length < 260; day += 86400) {
  const wd = new Date(day * 1000).getUTCDay();
  if (wd === 0 || wd === 6) continue;
  const b = bar(rand, close, 1_200_000);
  close = b.close;
  daily.push({ time: new Date(day * 1000).toISOString().slice(0, 10), ...b });
}
writeFileSync(join(here, 'demo-daily.json'), JSON.stringify(daily) + '\n');
writeFileSync(join(here, 'demo-daily.csv'),
  'time,open,high,low,close,volume\n' + daily.map(r => `${r.time},${r.open},${r.high},${r.low},${r.close},${r.volume}`).join('\n') + '\n');

// DEMO-B: one value per week, as CSV (time,value).
const randB = rng(23);
let v = 100;
const weekly = [];
for (let i = 0; i < 150; i++) {
  v = Math.max(5, v * (1 + (randB() - 0.48) * 0.05));
  weekly.push(`${new Date(Date.UTC(2022, 0, 3) + i * 7 * 86400000).toISOString().slice(0, 10)},${v.toFixed(2)}`);
}
writeFileSync(join(here, 'demo-line.csv'), 'time,value\n' + weekly.join('\n') + '\n');

// DEMO-C: five-minute bars, five sessions, UNIX seconds (09:15 to 15:25 in UTC+5:30, so 03:45 UTC onward).
const randC = rng(37);
const intraday = [];
let c = 1500;
for (let d = 0; d < 5; d++) {
  const start = Date.UTC(2024, 2, 4 + d, 3, 45) / 1000;
  for (let i = 0; i < 74; i++) {
    const b = bar(randC, c, 90_000);
    c = b.close;
    intraday.push({ time: start + i * 300, ...b });
  }
}
writeFileSync(join(here, 'demo-intraday.json'), JSON.stringify(intraday) + '\n');
console.log('wrote demo-daily.json, demo-daily.csv, demo-line.csv, demo-intraday.json');
