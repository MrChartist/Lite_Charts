// Live data: parsers against real captured samples, bar building, and connectLive with a fake fetch, WebSocket and
// environment (animation frames and timers run by hand), so every path runs without a network.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BarBuilder, backoffMs, plausibleBar, plausibleTick } from '../live/bars';
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
  const timerAt = new Map<number, number>();
  const clock = { t: Date.now() };
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
    setTimeout: (cb, ms) => { timers.set(++tid, cb); timerAt.set(tid, clock.t + ms); return tid; },
    clearTimeout: id => { timers.delete(id as number); timerAt.delete(id as number); },
    random: () => 0.5,
    now: () => clock.t,
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
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const frame = () => { const f = frames.splice(0); for (const cb of f) cb(); };
  const runTimers = () => { const t = [...timers.values()]; timers.clear(); timerAt.clear(); for (const cb of t) cb(); };
  /** Move the clock on by `ms`, firing due timers in time order (with microtasks settled between them). */
  const advance = async (ms: number) => {
    const end = clock.t + ms;
    for (;;) {
      let best: number | null = null;
      for (const [id, at] of timerAt) if (at <= end && (best === null || at < (timerAt.get(best) as number))) best = id;
      if (best === null) break;
      clock.t = Math.max(clock.t, timerAt.get(best) as number);
      const cb = timers.get(best) as () => void;
      timers.delete(best); timerAt.delete(best);
      cb();
      await settle();
    }
    clock.t = end;
    await settle();
  };
  return { fetchFn, env, series, updates, sets, statuses, errors, calls, settle, frame, runTimers, advance, timers, frames, listeners, doc, now, clock };
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
    // Within 10 s of the last history load, the reconnect subscribes again without reloading history.
    let before = w.calls.length;
    w.runTimers();
    await w.settle();
    expect(w.calls.length).toBe(before);
    expect(FakeWS.all.length).toBe(2);
    FakeWS.all[1].drop();
    w.clock.t += 11_000;
    before = w.calls.length;
    w.runTimers();
    await w.settle();
    expect(w.calls.length).toBeGreaterThan(before);
    expect(w.sets.length).toBe(1); // backfill updates, no reset
    expect(FakeWS.all.length).toBe(3);
    FakeWS.all[2].open();
    expect(live.status()).toBe('live');
    live.setInterval('5m');
    await w.settle();
    expect(FakeWS.all[2].closed).toBe(true);
    expect(w.calls[w.calls.length - 1]).toContain('granularity=300');
    // The old bars are cleared at once (setData([])), then the new history is set.
    expect(w.sets.slice(-2)[0]).toBe(0);
    expect(w.sets.length).toBe(3);
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

describe('connectLive: review of 2026-11-22', () => {
  it('a server that accepts and drops at once backs off instead of retrying every second (no storm)', async () => {
    const w = world();
    const live = connectLive(w.series as never, opts(w));
    await w.settle();
    // Every socket opens and is dropped straight away, for ten simulated minutes.
    let handled = 0;
    for (let s = 0; s < 600; s++) {
      while (handled < FakeWS.all.length) { const ws = FakeWS.all[handled++]; ws.open(); ws.drop(); }
      await w.advance(1000);
    }
    const sockets = FakeWS.all.length;
    const rest = w.calls.length;
    // Backoff 1, 2, 4, 8, 16, then 30 s (+/- 30%, here exactly): about 25 sockets in 10 minutes, not 600.
    expect(sockets).toBeLessThan(30);
    // History only when the last load is 10 s old or more (each Coinbase load is 1 request for 50 bars).
    expect(rest).toBeLessThanOrEqual(sockets);
    live.disconnect();
  });

  it('the backoff resets only after a tick, or after the socket stayed open 30 s', async () => {
    const w = world();
    const live = connectLive(w.series as never, opts(w));
    await w.settle();
    const ws0 = FakeWS.all[0];
    ws0.open(); ws0.drop();
    await w.advance(1000); // attempt 0: 1 s
    FakeWS.all[1].open(); FakeWS.all[1].drop();
    await w.advance(1999);
    expect(FakeWS.all.length).toBe(2); // attempt 1: 2 s, not reset by the open
    await w.advance(1);
    expect(FakeWS.all.length).toBe(3);
    const ws2 = FakeWS.all[2];
    ws2.open();
    ws2.msg({ type: 'match', trade_id: 5, price: '100', size: '1', time: new Date(w.clock.t).toISOString() });
    ws2.drop();
    await w.advance(1000); // the tick reset it: 1 s again
    expect(FakeWS.all.length).toBe(4);
    live.disconnect();
  });

  it('a permanently bad symbol stops after three rounds with status error; retry() starts again', async () => {
    const w = world();
    const live = connectLive(w.series as never, opts(w, { symbol: 'BTCUSDT&interval=1d#' }));
    await w.settle();
    for (let i = 0; i < 20; i++) await w.advance(31_000);
    expect(live.status()).toBe('error');
    expect(w.calls.length).toBe(0); // the malformed symbol never reached any URL
    expect(w.timers.size).toBe(0);
    expect(w.errors.some(e => /stopped \(call retry\(\)/.test(e))).toBe(true);
    live.setSymbol('ETH-USD');
    await w.settle();
    expect(live.status()).not.toBe('error');
    expect(w.calls.some(u => u.includes('ETH-USD'))).toBe(true);
    live.disconnect();
  });

  it('a 4xx on every provider counts as permanent; retry() resets it', async () => {
    const w = world();
    const f404 = (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    const live = connectLive(w.series as never, opts(w, { fetch: f404 }));
    await w.settle();
    for (let i = 0; i < 10; i++) await w.advance(31_000);
    expect(live.status()).toBe('error');
    expect(w.timers.size).toBe(0);
    live.retry();
    await w.settle();
    expect(w.timers.size).toBe(1); // tried again, waiting to retry
    live.disconnect();
  });

  it('starts are capped per hour', async () => {
    const w = world({ fail: ['coinbase', 'binance', 'kraken'] }); // 503: not permanent, retried forever
    const live = connectLive(w.series as never, opts(w));
    await w.settle();
    await w.advance(3_600_000 - 5000);
    const perRound = 1 + 1 + 1;
    expect(w.calls.length).toBeLessThanOrEqual(30 * perRound);
    live.disconnect();
  });

  it('a history request that never answers times out after 10 s and the next provider is tried', async () => {
    const w = world();
    const hung = ((url: string, init?: { signal?: AbortSignal }) => {
      if (url.includes('coinbase')) { w.calls.push(url); return new Promise(() => { void init; }); }
      return w.fetchFn(url, init as never);
    }) as unknown as typeof fetch;
    const live = connectLive(w.series as never, opts(w, { fetch: hung }));
    await w.settle();
    expect(live.status()).toBe('connecting');
    await w.advance(10_000);
    expect(live.provider()).toBe('binance');
    expect(w.errors.some(e => /timed out after 10 s/.test(e))).toBe(true);
    live.disconnect();
  });

  it('a socket that never opens, and a stream that goes quiet, reconnect with status reconnecting', async () => {
    const w = world();
    const live = connectLive(w.series as never, opts(w));
    await w.settle();
    expect(FakeWS.all.length).toBe(1);
    await w.advance(10_000);
    expect(FakeWS.all[0].closed).toBe(true);
    expect(live.status()).toBe('reconnecting');
    await w.advance(1000);
    expect(FakeWS.all.length).toBe(2);
    FakeWS.all[1].open();
    expect(live.status()).toBe('live');
    // 1m interval: quiet for max(60 s, 3 minutes capped at 5) = 180 s.
    await w.advance(179_000);
    expect(FakeWS.all[1].closed).toBe(false);
    await w.advance(60_000);
    expect(FakeWS.all[1].closed).toBe(true);
    expect(w.statuses).toContain('reconnecting');
    live.disconnect();
  });

  it('drops future, non-positive and absurd ticks; one bad timestamp no longer freezes the chart', async () => {
    const w = world();
    const live = connectLive(w.series as never, opts(w));
    await w.settle();
    const ws = FakeWS.all[0];
    ws.open();
    const t = (sec: number) => new Date(w.clock.t + sec * 1000).toISOString();
    ws.msg({ type: 'match', trade_id: 1, price: '100', size: '1', time: t(0) });
    w.frame();
    const n = w.updates.length;
    ws.msg({ type: 'match', trade_id: 2, price: '9999', size: '1', time: t(86400 * 365) }); // a year ahead
    ws.msg({ type: 'match', trade_id: 3, price: '-5', size: '1', time: t(1) });
    ws.msg({ type: 'match', trade_id: 4, price: '0', size: '1', time: t(1) });
    ws.msg({ type: 'match', trade_id: 5, price: '100000', size: '1', time: t(1) }); // 1000 times the last close
    expect(w.frames.length).toBe(0);
    ws.msg({ type: 'match', trade_id: 6, price: '101', size: '1', time: t(2) });
    w.frame();
    expect(w.updates.length).toBe(n + 1);
    expect(w.updates[w.updates.length - 1].close).toBe(101);
    live.disconnect();
  });

  it('on reload, local bars newer than the newest history bar are discarded', async () => {
    const w = world();
    const live = connectLive(w.series as never, opts(w, { provider: 'binance' }));
    await w.settle();
    const ws = FakeWS.all[0];
    ws.open();
    const minute = Math.floor(w.clock.t / 60000) * 60;
    // A streamed bar one minute ahead (allowed: within one interval), then the stream drops.
    ws.msg({ e: 'kline', k: { t: (minute + 60) * 1000, o: '1', h: '2', l: '0.5', c: '1.5', v: '3', x: false } });
    w.frame();
    ws.drop();
    w.clock.t += 11_000;
    const sets = w.sets.length;
    w.runTimers();
    await w.settle();
    expect(w.sets.length).toBe(sets + 1); // a reset without the future bar
    live.disconnect();
  });

  it('symbols are validated after mapping and encoded; nothing malformed reaches a URL', async () => {
    const { binance, kraken, coinbase } = await import('../live/providers');
    const urls: string[] = [];
    const deps = {
      fetch: (async (u: string) => { urls.push(u); return { ok: true, status: 200, json: async () => [] }; }) as unknown as typeof fetch,
      WebSocket: class { constructor(u: string) { urls.push(u); } send() {} close() {} } as unknown as typeof WebSocket,
      signal: new AbortController().signal,
    };
    for (const p of [binance, kraken, coinbase]) {
      for (const bad of ['BTCUSDT&interval=1d&limit=1000#', '../../v1/x?a=', 'btcusdt@trade/ethusdt']) {
        await expect(p.history(bad, '1m', { limit: 10 }, deps)).rejects.toThrow(/not a valid symbol|not a BASE-QUOTE pair/);
        expect(() => p.subscribe(bad, '1m', { tick() {}, open() {}, closed() {} }, deps)).toThrow();
      }
    }
    expect(urls).toEqual([]);
  });

  it('Coinbase last_match replay does not add its size again to the bar history holds', () => {
    const b = new BarBuilder(60, { time: 600, open: 1, high: 2, low: 1, close: 1.5, volume: 10 });
    const replay = parseCoinbaseMessage({ type: 'last_match', trade_id: 77, price: '1.6', size: '4', time: new Date(605 * 1000).toISOString() });
    expect(replay && replay.kind === 'trade' && replay.replay).toBe(true);
    expect(b.apply(replay as never)).toMatchObject({ volume: 10, close: 1.6 });
    // A replay in a newer bucket is a trade history did not have.
    const later = parseCoinbaseMessage({ type: 'last_match', trade_id: 78, price: '1.7', size: '4', time: new Date(661 * 1000).toISOString() });
    expect(b.apply(later as never)).toMatchObject({ volume: 4 });
  });

  it('loadOlder is aborted by disconnect, and times out if the request never answers', async () => {
    const w = world();
    let olderSignal: AbortSignal | null = null;
    const env = w.env;
    const prov = {
      id: 'p', intervals: ['1m'] as const, canPageBack: true,
      history: (_s: string, _i: string, r: { before?: number }, d: { signal: AbortSignal }) => {
        if (r.before === undefined) return Promise.resolve(Array.from({ length: 10 }, (_, k) => ({ time: Math.floor(w.clock.t / 60000) * 60 - (9 - k) * 60, open: 1, high: 1, low: 1, close: 1, volume: 0 })));
        olderSignal = d.signal;
        return new Promise(() => {});
      },
      subscribe: (_s: string, _i: string, on: { open(): void }) => { on.open(); return () => {}; },
    };
    const live = connectLive(w.series as never, opts(w, { provider: prov, env }));
    await w.settle();
    const p = live.loadOlder();
    await w.settle();
    live.disconnect();
    expect((olderSignal as AbortSignal | null)?.aborted).toBe(true);
    const live2 = connectLive(w.series as never, opts(w, { provider: prov, env }));
    await w.settle();
    const p2 = live2.loadOlder();
    await w.advance(10_000);
    expect(await p2).toBe(0);
    expect(await live2.loadOlder()).toBe(0); // not stuck: it ran (and hung) again rather than returning at once
    void p;
    live2.disconnect();
  });

  it('info() names the provider and quote really in use (a silent fallback to Binance says USDT)', async () => {
    const w = world({ fail: ['coinbase'] });
    const infos: unknown[] = [];
    const live = connectLive(w.series as never, opts(w, { onStatus: (_s: LiveStatus, i: unknown) => infos.push(i) }));
    await w.settle();
    FakeWS.all[0].open();
    expect(live.info()).toEqual({ provider: 'binance', providerLabel: 'Binance', symbol: 'BTC-USD', pair: 'BTC-USDT', quote: 'USDT', interval: '1m' });
    expect(infos[infos.length - 1]).toMatchObject({ providerLabel: 'Binance', quote: 'USDT' });
    live.disconnect();
  });

  it('plausibility rules', () => {
    expect(plausibleTick({ kind: 'trade', time: 1000, price: 5, size: 1 }, 1000, 60, null)).toBe(true);
    expect(plausibleTick({ kind: 'trade', time: 1061, price: 5, size: 1 }, 1000, 60, null)).toBe(false);
    expect(plausibleTick({ kind: 'trade', time: 1000, price: 51, size: 1 }, 1000, 60, 5)).toBe(false);
    expect(plausibleTick({ kind: 'trade', time: 1000, price: 49, size: 1 }, 1000, 60, 5)).toBe(true);
    expect(plausibleTick({ kind: 'trade', time: 1000, price: 0.4, size: 1 }, 1000, 60, 5)).toBe(false);
    expect(plausibleBar({ time: 900, open: 1, high: 0.5, low: 1, close: 1, volume: 0 }, 1000, 60)).toBe(false);
    expect(plausibleBar({ time: 900, open: 1, high: 2, low: 1, close: Number.NaN, volume: 0 }, 1000, 60)).toBe(false);
  });
});
