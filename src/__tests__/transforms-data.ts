import type { TransformRow } from '../transforms';

/** Deterministic random-walk candles, one per minute. */
export function walk(n: number, seed = 7, start = 100): TransformRow[] {
  let s = seed >>> 0;
  const rand = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: TransformRow[] = [];
  let close = start;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.max(1, open * (1 + (rand() - 0.495) * 0.02));
    out.push({
      time: 1_700_000_000 + i * 60, open, high: Math.max(open, close) * (1 + rand() * 0.004), low: Math.min(open, close) * (1 - rand() * 0.004),
      close, volume: Math.floor(100 + rand() * 900),
    });
  }
  return out;
}
