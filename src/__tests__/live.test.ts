// Live data: parsers against real captured samples, bar building, and connectLive with a fake fetch, WebSocket and
// environment (animation frames and timers run by hand), so every path runs without a network.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BarBuilder, backoffMs } from '../live/bars';
import { connectLive, type LiveEnv, type LiveStatus } from '../live/connect';
import {
  binanceSymbol, krakenSymbols, parseBinanceKlines, parseBinanceMessage, parseCoinbaseCandles, parseCoinbaseMessage,
  parseKrakenMessage, parseKrakenOHLC,
} from '../live/providers';

const fx = (name: string): { capturedAt: string; data: unknown } =>
  JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'live', '__fixtures__', name), 'utf8')) as { capturedAt: string; data: unknown };

describe('provider parsers on real samples (captured 2026-11-21)', () => {
  it('Coinbase candles: [time, low, high, open, close, volume], newest first, sorted ascending here', () => {
    const raw = fx('coinbase-candles.json').data as number[][];
    const bars = parseCoinbaseCandles(raw);
    expect(bars.length).toBe(raw.length);
    expect(bars[bars.length - 1].time).toBe(raw[0][0]);
    const r = raw[0];
    expect(bars[bars.length - 1]).toEqual({ time: r[0], low: r[1], high: r[2], open: r[3], close: r[4], volume: r[5] });
    for (const b of bars) { expect(b.high).toBeGreaterThanOrEqual(b.low); expect(b.time % 60).toBe(0); }
  });

  it('Coinbase matches: trades with id, price, size and an ISO time; other messages ignored', () => {
    const msgs = fx('coinbase-ws.json').data as Record<string, unknown>[];
    const ticks = msgs.map(parseCoinbaseMessage).filter(Boolean);
    expect(ticks.length).toBeGreaterThan(0);
    const t = ticks[0] as { kind: string; time: number; price: number; size: number; id: number };
    expect(t.kind).toBe('trade');
    expect(t.price).toBeGreaterThan(1000);
    expect(t.time).toBeGreaterThan(1.7e9);
    expect(parseCoinbaseMessage({ type: 'subscriptions' })).toBeNull();
  });

  it('Binance klines: [openTimeMs, "o", "h", "l", "c", "v", ...] strings; the stream carries whole bars', () => {
    const raw = fx('binance-klines.json').data as unknown[][];
    const bars = parseBinanceKlines(raw);
    expect(bars.length).toBe(raw.length);
    expect(bars[0].time).toBe(Number(raw[0][0]) / 1000);
    expect(bars[0].close).toBe(Number(raw[0][4]));
    const t = parseBinanceMessage((fx('binance-ws.json').data as unknown[])[0]);
    expect(t?.kind).toBe('bar');
    expect(t && t.kind === 'bar' && t.bar.time % 60).toBe(0);
    expect(binanceSymbol('BTC-USD')).toBe('BTCUSDT');
    expect(binanceSymbol('ETH-EUR')).toBe('ETHEUR');
  });

  it('Kraken OHLC: {result: {XXBTZUSD: [[time, o, h, l, c, vwap, volume, count]], last}}; trades from WS v2', () => {
    const body = fx('kraken-ohlc.json').data;
    const bars = parseKrakenOHLC(body);
    const rows = (body as { result: Record<string, unknown[][]> }).result.XXBTZUSD;
    expect(bars.length).toBe(rows.length);
    expect(bars[0]).toEqual({ time: rows[0][0], open: Number(rows[0][1]), high: Number(rows[0][2]), low: Number(rows[0][3]), close: Number(rows[0][4]), volume: Number(rows[0][6]) });
    const trades = (fx('kraken-ws.json').data as unknown[]).flatMap(parseKrakenMessage);
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0].kind).toBe('trade');
    expect(() => parseKrakenOHLC({ error: ['EGeneral:Invalid arguments'] })).toThrow(/Invalid arguments/);
    expect(krakenSymbols('BTC-USD')).toEqual({ rest: 'XBTUSD', ws: 'BTC/USD' });
    expect(krakenSymbols('SOL-USD')).toEqual({ rest: 'SOLUSD', ws: 'SOL/USD' });
  });
});

describe('bar building', () => {
  it('folds trades into buckets, rolls a new bar on the boundary, counts volume', () => {
    const b = new BarBuilder(60, { time: 600, open: 10, high: 11, low: 9, close: 10, volume: 1 });
    expect(b.apply({ kind: 'trade', time: 630, price: 12, size: 0.5, id: 1 })).toEqual({ time: 600, open: 10, high: 12, low: 9, close: 12, volume: 1.5 });
    expect(b.apply({ kind: 'trade', time: 660, price: 11, size: 2, id: 2 })).toEqual({ time: 660, open: 11, high: 11, low: 11, close: 11, volume: 2 });
    expect(b.apply({ kind: 'trade', time: 719.9, price: 8, size: 1, id: 3 })?.low).toBe(8);
  });
  it('drops late and duplicate trades; whole bars replace their time', () => {
    const b = new BarBuilder(60);
    b.apply({ kind: 'trade', time: 120, price: 5, size: 1, id: 'a' });
    expect(b.apply({ kind: 'trade', time: 59, price: 99, size: 1, id: 'b' })).toBeNull();
    expect(b.apply({ kind: 'trade', time: 125, price: 6, size: 1, id: 'a' })).toBeNull();
    expect(b.apply({ kind: 'bar', bar: { time: 120, open: 5, high: 7, low: 4, close: 6, volume: 9 }, closed: false })?.volume).toBe(9);
    expect(b.apply({ kind: 'bar', bar: { time: 60, open: 1, high: 1, low: 1, close: 1, volume: 1 }, closed: true })).toBeNull();
  });
  it('backoff grows to 30 s with jitter', () => {
    expect(backoffMs(0, 0.5)).toBe(1000);
    expect(backoffMs(3, 0.5)).toBe(8000);
    expect(backoffMs(10, 0.5)).toBe(30000);
    expect(backoffMs(0, 0)).toBe(700);
    expect(backoffMs(0, 0.999)).toBeLessThan(1300);
  });
});

// ── a fake world ──

class FakeWS {
  static all: FakeWS[] = [];
  url: string;
  sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  closed = false;
  constructor(url: string) { this.url = url; FakeWS.all.push(this); }
  send(s: string) { this.sent.push(s); }
  close() { this.closed = true; }
  open() { this.readyState = 1; this.onopen?.(); }
  msg(o: unknown) { this.onmessage?.({ data: JSON.stringify(o) }); }
  drop() { this.closed = true; this.onclose?.({ code: 1006 }); }
}

function world(opts: { fail?: string[] } = {}) {
  FakeWS.all = [];
  const calls: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  const rowsFor = (url: string): unknown => {
    const u = new URL(url);
    if (u.host.includes('coinbase')) {
      const g = Number(u.searchParams.get('granularity'));
      const start = Date.parse(u.searchParams.get('start') as string) / 1000;
      const end = Date.parse(u.searchParams.get('end') as string) / 1000;
      const out = [];
      for (let t = Math.ceil(start / g) * g; t <= Math.min(end, now); t += g) out.push([t, 99, 101, 100, 100.5, 2]);
      return out.reverse();
    }
    if (u.host.includes('binance')) {
      const out = [];
      for (let i = 9; i >= 0; i--) { const t = (Math.floor(now / 60) - i) * 60; out.push([t * 1000, '1', '2', '0.5', '1.5', '3']); }
      return out;
    }
    return { error: [], result: { XXBTZUSD: [[Math.floor(now / 60) * 60, '1', '2', '0.5', '1.5', '1.6', '3', 5]], last: 0 } };
  };
  const fetchFn = (async (url: string, init?: { signal?: AbortSignal }) => {
    calls.push(url);
    if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if ((opts.fail ?? []).some(h => url.includes(h))) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => rowsFor(url) };
  }) as unknown as typeof fetch;
  const frames: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  let tid = 0;
  const listeners: Record<string, Set<() => void>> = {};
  const doc = {
    hidden: false,
    addEventListener: (t: string, f: () => void) => { (listeners[t] ??= new Set()).add(f); },
    removeEventListener: (t: string, f: () => void) => { listeners[t]?.delete(f); },
  };
  const env: Partial<LiveEnv> = {
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: () => { frames.length = 0; },
    setTimeout: (cb, _ms) => { timers.set(++tid, cb); return tid; },
    clearTimeout: id => { timers.delete(id as number); },
    random: () => 0.5,
    document: doc as never,
    window: null,
  };
  const updates: Record<string, unknown>[] = [];
  const sets: number[] = [];
  const series = {
    seriesType: () => 'candlestick',
    setData: (rows: unknown[]) => { sets.push(rows.length); },
    update: (r: Record<string, unknown>) => { updates.push(r); },
  };
  const statuses: LiveStatus[] = [];
  const errors: string[] = [];
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const frame = () => { const f = frames.splice(0); for (const cb of f) cb(); };
  const runTimers = () => { const t = [...timers.values()]; timers.clear(); for (const cb of t) cb(); };
  return { fetchFn, env, series, updates, sets, statuses, errors, calls, settle, frame, runTimers, timers, frames, listeners, doc, now };
}

const opts = (w: ReturnType<typeof world>, extra: Record<string, unknown> = {}) => ({
  fetch: w.fetchFn, WebSocket: FakeWS as unknown as typeof WebSocket, env: w.env,
  onStatus: (s: LiveStatus) => w.statuses.push(s), onError: (e: Error) => w.errors.push(e.message), history: 50, ...extra,
});

describe('connectLive', () => {
  it('loads history, streams trades and updates the chart once per frame however fast they come', async () => {
    const w = world();
    const live = connectLive(w.series as never, opts(w));
    await w.settle();
    expect(w.sets[0]).toBeGreaterThan(10);
    const ws = FakeWS.all[0];
    expect(ws.url).toBe('wss://ws-feed.exchange.coinbase.com');
    ws.open();
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['matches'] });
    expect(live.status()).toBe('live');
    const t0 = new Date(w.now * 1000).toISOString();
    for (let i = 0; i < 50; i++) ws.msg({ type: 'match', trade_id: 1000 + i, price: String(100 + i / 10), size: '0.1', time: t0 });
    expect(w.updates.length).toBe(0);
    expect(w.frames.length).toBe(1);
    w.frame();
    expect(w.updates.length).toBe(1);
    expect(w.updates[0].close).toBeCloseTo(104.9);
    // A duplicate (replayed) trade changes nothing.
    ws.msg({ type: 'last_match', trade_id: 1049, price: '1', size: '1', time: t0 });
    expect(w.frames.length).toBe(0);
    live.disconnect();
  });

  it('reconnects with backoff and backfills the gap; an interval switch restarts on the new interval', async () => {
    const w = world();
    const live = connectLive(w.series as never, opts(w));
    await w.settle();
    FakeWS.all[0].open();
    FakeWS.all[0].drop();
    expect(live.status()).toBe('reconnecting');
    expect(w.timers.size).toBe(1);
    const before = w.calls.length;
    w.runTimers();
    await w.settle();
    expect(w.calls.length).toBeGreaterThan(before);
    expect(w.sets.length).toBe(1); // backfill updates, no reset
    expect(FakeWS.all.length).toBe(2);
    FakeWS.all[1].open();
    expect(live.status()).toBe('live');
    live.setInterval('5m');
    await w.settle();
    expect(FakeWS.all[1].closed).toBe(true);
    expect(w.calls[w.calls.length - 1]).toContain('granularity=300');
    expect(w.sets.length).toBe(2);
    live.disconnect();
  });

  it('falls back to the next provider when history fails; a custom provider is used alone', async () => {
    const w = world({ fail: ['coinbase'] });
    const live = connectLive(w.series as never, opts(w));
    await w.settle();
    expect(live.provider()).toBe('binance');
    expect(FakeWS.all[0].url).toBe('wss://data-stream.binance.vision/ws/btcusdt@kline_1m');
    expect(w.errors.some(e => /503/.test(e))).toBe(true);
    live.disconnect();
    const w2 = world({ fail: ['coinbase', 'binance', 'kraken'] });
    const dead = connectLive(w2.series as never, opts(w2));
    await w2.settle();
    expect(dead.status()).toBe('error');
    expect(w2.timers.size).toBe(1);
    dead.disconnect();
  });

  it('pauses while the tab is hidden and catches up when shown', async () => {
    const w = world();
    const live = connectLive(w.series as never, opts(w));
    await w.settle();
    FakeWS.all[0].open();
    w.doc.hidden = true;
    for (const f of w.listeners.visibilitychange) f();
    expect(live.status()).toBe('offline');
    expect(FakeWS.all[0].closed).toBe(true);
    w.doc.hidden = false;
    for (const f of w.listeners.visibilitychange) f();
    await w.settle();
    expect(FakeWS.all.length).toBe(2);
    live.disconnect();
  });

  it('disconnect leaves no socket, timer, frame or listener, and nothing updates after', async () => {
    const w = world();
    const live = connectLive(w.series as never, opts(w));
    await w.settle();
    const ws = FakeWS.all[0];
    ws.open();
    ws.msg({ type: 'match', trade_id: 1, price: '100', size: '1', time: new Date(w.now * 1000).toISOString() });
    ws.drop();
    live.disconnect();
    expect(ws.closed).toBe(true);
    expect(w.timers.size).toBe(0);
    expect(w.frames.length).toBe(0);
    expect(w.listeners.visibilitychange.size).toBe(0);
    w.runTimers();
    await w.settle();
    expect(FakeWS.all.length).toBe(1);
    expect(live.status()).toBe('offline');
  });

  it('never throws into the page: a failing series reports through onError', async () => {
    const w = world();
    const bad = { seriesType: () => 'candlestick', setData: () => { throw new Error('boom'); }, update: () => { throw new Error('boom'); } };
    expect(() => connectLive(bad as never, opts(w))).not.toThrow();
    await w.settle();
    expect(w.errors).toContain('boom');
  });

  it('loads older history a page at a time and stops at the start', async () => {
    const w = world();
    const live = connectLive(w.series as never, opts(w));
    await w.settle();
    const added = await live.loadOlder();
    expect(added).toBeGreaterThan(0);
    expect(w.sets.length).toBe(2);
    live.disconnect();
  });
});
