// Demo bars and the built-in crypto list. Pure (a seeded walk: the same symbol and interval give the same bars).

import type { SymbolInfo, WidgetBar } from './types';
import { intervalSeconds } from './intervals';

/** Pairs the live module streams from public exchange APIs (each checked against the providers' endpoints). */
export const CRYPTO_SYMBOLS: readonly SymbolInfo[] = [
  { symbol: 'BTC-USD', description: 'Bitcoin', exchange: 'Crypto' },
  { symbol: 'ETH-USD', description: 'Ethereum', exchange: 'Crypto' },
  { symbol: 'SOL-USD', description: 'Solana', exchange: 'Crypto' },
  { symbol: 'XRP-USD', description: 'XRP', exchange: 'Crypto' },
  { symbol: 'DOGE-USD', description: 'Dogecoin', exchange: 'Crypto' },
  { symbol: 'ADA-USD', description: 'Cardano', exchange: 'Crypto' },
  { symbol: 'LTC-USD', description: 'Litecoin', exchange: 'Crypto' },
  { symbol: 'BNB-USD', description: 'BNB', exchange: 'Crypto' },
];

const START: Record<string, number> = { BTC: 64000, ETH: 3100, SOL: 150, XRP: 0.6, DOGE: 0.15, ADA: 0.45, LTC: 80, BNB: 580 };

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** `count` bars ending at `endSec` (aligned to the interval), a calm random walk with volume. */
export function demoBars(symbol: string, interval: string, count = 600, endSec = Math.floor(Date.now() / 1000)): WidgetBar[] {
  const step = intervalSeconds(interval) || 86_400;
  let s = seedOf(`${symbol}|${interval}`) || 1;
  const rnd = (): number => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const base = START[symbol.split(/[-/]/)[0].toUpperCase()] ?? 100;
  const vol = 0.022 * Math.sqrt(step / 86_400) + 0.0012;
  const end = Math.floor(endSec / step) * step;
  const out: WidgetBar[] = [];
  let p = base;
  let drift = 0;
  for (let i = 0; i < count; i++) {
    drift = drift * 0.92 + (rnd() - 0.5) * vol * 0.18;
    const o = p;
    const c = Math.max(base * 0.05, o * (1 + drift + (rnd() + rnd() + rnd() - 1.5) * vol * 1.3));
    const hi = Math.max(o, c) * (1 + rnd() * rnd() * vol * 1.2);
    const lo = Math.min(o, c) * (1 - rnd() * rnd() * vol * 1.2);
    const dp = base < 1 ? 5 : base < 10 ? 4 : 2;
    const r = (x: number): number => Math.round(x * 10 ** dp) / 10 ** dp;
    out.push({ time: end - (count - 1 - i) * step, open: r(o), high: r(hi), low: r(lo), close: r(c), volume: Math.round((200 + rnd() * 800) * (1 + Math.abs(c - o) / o * 60)) });
    p = c;
  }
  return out;
}
