// Market data providers for the live entry: one small interface, and built-ins for three public, keyless, CORS-enabled
// exchange APIs. The parsers are pure and tested against real samples captured from the live endpoints on 2026-11-21
// (`src/live/__fixtures__/`); see docs/guide/live-data.md for what was verified and how. Every symbol is checked against
// a strict pattern after it is mapped to the exchange's form and is URL-encoded, so no input can reach another path or
// query parameter.

export type LiveInterval = '1m' | '5m' | '15m' | '1h' | '6h' | '1d';

export const INTERVAL_SECONDS: Readonly<Record<LiveInterval, number>> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1d': 86400 };

/** One bar: `time` is the bucket start in UNIX seconds. */
export interface LiveBar { time: number; open: number; high: number; low: number; close: number; volume: number }

/** What a provider's stream delivers: a trade, or a whole bar (an exchange that streams candles). */
export type LiveTick =
  | { kind: 'trade'; time: number; price: number; size: number; id?: string | number; replay?: boolean }
  | { kind: 'bar'; bar: LiveBar; closed: boolean };

export interface HistoryRange {
  /** Bars wanted (the provider may return fewer). */
  limit: number;
  /** Return bars that START before this time (UNIX seconds); absent: the newest bars. */
  before?: number;
}

/** What a provider needs from the browser; injected so tests (and servers) can supply their own. */
export interface ProviderDeps {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  signal: AbortSignal;
}

export interface StreamHandlers {
  tick(t: LiveTick): void;
  /** Any message arrived (heartbeats included): the stream is alive. Optional for providers of your own. */
  alive?(): void;
  /** The stream is open and subscribed. */
  open(): void;
  /** The stream ended (not by `close()`): the caller reconnects. */
  closed(reason: string): void;
}

/**
 * A source of bars. `history` returns bars in ascending time; `subscribe` opens a stream and returns a function that
 * closes it (and must not call `closed` afterwards). Write one for any market: implement these, pass the object as
 * `provider`.
 */
export interface LiveProvider {
  id: string;
  /** Name for people ('Coinbase'); `id` when absent. */
  label?: string;
  /** The quote currency the exchange really prices `symbol` in ('USD', or 'USDT' on Binance); absent: unknown. */
  quote?(symbol: string): string | null;
  /** Intervals it can serve; others make `connectLive` try the next provider. */
  intervals: readonly LiveInterval[];
  /** Whether `history` can page back (`before`); false disables older-history loading. */
  canPageBack: boolean;
  history(symbol: string, interval: LiveInterval, range: HistoryRange, deps: ProviderDeps): Promise<LiveBar[]>;
  subscribe(symbol: string, interval: LiveInterval, on: StreamHandlers, deps: Omit<ProviderDeps, 'signal'>): () => void;
}

/** BASE-QUOTE (as used here: 'BTC-USD') split; anything else returns null. */
function split(symbol: string): [string, string] | null {
  const m = /^([A-Za-z0-9]+)[-/_]([A-Za-z0-9]+)$/.exec(symbol.trim());
  return m ? [m[1].toUpperCase(), m[2].toUpperCase()] : null;
}

/**
 * An error of a request or a symbol, with what the reconnect logic needs to know: `status` (HTTP status, 0 when none)
 * and `permanent` (retrying cannot help: a 4xx other than 408 / 429, an unknown symbol, a malformed symbol).
 */
export class LiveError extends Error {
  status: number;
  permanent: boolean;
  constructor(message: string, status = 0, permanent = false) {
    super(message);
    this.name = 'LiveError';
    this.status = status;
    this.permanent = permanent;
  }
}

/** The mapped symbol, when it matches `pattern`; otherwise a permanent LiveError (never sent anywhere). */
function checked(provider: string, mapped: string, pattern: RegExp): string {
  if (!pattern.test(mapped)) throw new LiveError(`${provider}: "${mapped.slice(0, 40)}" is not a valid symbol`, 0, true);
  return mapped;
}
const PAIR_DASH = /^[A-Z0-9]{1,15}-[A-Z0-9]{1,15}$/;
const PAIR_SLASH = /^[A-Z0-9]{1,15}\/[A-Z0-9]{1,15}$/;
const PAIR_JOINED = /^[A-Z0-9]{2,30}$/;

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN);
const okBar = (b: LiveBar): boolean => [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite);

async function getJSON(url: string, deps: ProviderDeps): Promise<unknown> {
  const res = await deps.fetch(url, { signal: deps.signal, credentials: 'omit', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const st = Number(res.status) || 0;
    throw new LiveError(`HTTP ${st} from ${new URL(url).host}`, st, st >= 400 && st < 500 && st !== 408 && st !== 429);
  }
  return res.json();
}

function socket(url: string, deps: Omit<ProviderDeps, 'signal'>, on: StreamHandlers, onOpen: (ws: WebSocket) => void, onMessage: (data: unknown) => void): () => void {
  let closedByUs = false;
  let ws: WebSocket;
  try { ws = new deps.WebSocket(url); } catch (e) { queueMicrotask(() => on.closed(String(e))); return () => undefined; }
  ws.onopen = () => { try { onOpen(ws); } catch { /* ignore */ } };
  ws.onmessage = ev => {
    try { on.alive?.(); } catch { /* ignore */ }
    let data: unknown;
    try { data = JSON.parse(String(ev.data)); } catch { return; }
    try { onMessage(data); } catch { /* a bad message is skipped */ }
  };
  ws.onerror = () => undefined;
  ws.onclose = ev => { if (!closedByUs) on.closed(`closed ${(ev as CloseEvent).code ?? ''}`); };
  return () => {
    closedByUs = true;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try { ws.close(); } catch { /* already closed */ }
  };
}

// ── Coinbase Exchange ──
// REST GET /products/{id}/candles?granularity&start&end: rows [time, low, high, open, close, volume], newest first, at
// most 300. WS wss://ws-feed.exchange.coinbase.com, channel "matches": {type: "match" | "last_match", trade_id, price,
// size, time (ISO)}. On subscribe the feed first replays the latest trade as "last_match"; it is marked `replay` so its
// size is not counted again into the bar that history already holds.

export function parseCoinbaseCandles(rows: unknown): LiveBar[] {
  if (!Array.isArray(rows)) throw new Error('Coinbase: unexpected candles response');
  const out: LiveBar[] = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const b = { time: num(r[0]), low: num(r[1]), high: num(r[2]), open: num(r[3]), close: num(r[4]), volume: num(r[5]) || 0 };
    if (okBar(b)) out.push(b);
  }
  return out.sort((a, b) => a.time - b.time);
}

export function parseCoinbaseMessage(m: unknown): LiveTick | null {
  const o = m as Record<string, unknown> | null;
  if (!o || (o.type !== 'match' && o.type !== 'last_match')) return null;
  const time = Date.parse(String(o.time)) / 1000;
  const price = num(o.price);
  const size = num(o.size);
  if (!Number.isFinite(time) || !Number.isFinite(price)) return null;
  const tick: LiveTick = { kind: 'trade', time, price, size: Number.isFinite(size) ? size : 0, id: o.trade_id as number };
  if (o.type === 'last_match') tick.replay = true;
  return tick;
}

export const coinbase: LiveProvider = {
  id: 'coinbase',
  label: 'Coinbase',
  quote: s => coinbaseId(s).split('-')[1] ?? null,
  intervals: ['1m', '5m', '15m', '1h', '6h', '1d'],
  canPageBack: true,
  async history(symbol, interval, range, deps) {
    const g = INTERVAL_SECONDS[interval];
    const out: LiveBar[] = [];
    let end = range.before ?? Math.floor(Date.now() / 1000) + g;
    // At most 300 a call: page back until the limit (bounded at 5 calls).
    for (let call = 0; call < 5 && out.length < range.limit; call++) {
      const n = Math.min(300, range.limit - out.length);
      const start = end - n * g;
      const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(coinbaseId(symbol))}/candles?granularity=${g}`
        + `&start=${new Date(start * 1000).toISOString()}&end=${new Date((end - 1) * 1000).toISOString()}`;
      const page = parseCoinbaseCandles(await getJSON(url, deps)).filter(b => b.time < end);
      if (!page.length) break;
      out.unshift(...page);
      end = page[0].time;
    }
    return dedupe(out);
  },
  subscribe(symbol, _interval, on, deps) {
    const id = coinbaseId(symbol);
    return socket('wss://ws-feed.exchange.coinbase.com', deps, on,
      ws => { ws.send(JSON.stringify({ type: 'subscribe', product_ids: [id], channels: ['matches'] })); on.open(); },
      m => { const t = parseCoinbaseMessage(m); if (t) on.tick(t); });
  },
};

function coinbaseId(symbol: string): string {
  const s = split(symbol);
  return checked('Coinbase', s ? `${s[0]}-${s[1]}` : symbol.trim().toUpperCase(), PAIR_DASH);
}

// ── Binance (public market data hosts: data-api.binance.vision; api.binance.com is region-blocked in places) ──
// REST GET /api/v3/klines?symbol&interval&limit&endTime: rows [openTimeMs, "o", "h", "l", "c", "v", closeTimeMs, ...],
// oldest first, at most 1000. WS wss://data-stream.binance.vision/ws/{symbol}@kline_{interval}: {e: "kline",
// k: {t, o, h, l, c, v, x}}. Quotes are USDT, not USD.

export function parseBinanceKlines(rows: unknown): LiveBar[] {
  if (!Array.isArray(rows)) throw new Error('Binance: unexpected klines response');
  const out: LiveBar[] = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const b = { time: num(r[0]) / 1000, open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) || 0 };
    if (okBar(b)) out.push(b);
  }
  return out.sort((a, b) => a.time - b.time);
}

export function parseBinanceMessage(m: unknown): LiveTick | null {
  const o = m as { e?: string; k?: Record<string, unknown> } | null;
  if (!o || o.e !== 'kline' || !o.k) return null;
  const k = o.k;
  const bar = { time: num(k.t) / 1000, open: num(k.o), high: num(k.h), low: num(k.l), close: num(k.c), volume: num(k.v) || 0 };
  return okBar(bar) ? { kind: 'bar', bar, closed: k.x === true } : null;
}

/**
 * 'BTC-USD' -> 'BTCUSDT' (Binance quotes in USDT); other pairs joined; a joined symbol ('ETHBTC') passed through. Throws
 * a permanent LiveError for anything that is not letters and digits.
 */
export function binanceSymbol(symbol: string): string {
  const s = split(symbol);
  return checked('Binance', s ? `${s[0]}${s[1] === 'USD' ? 'USDT' : s[1]}` : symbol.trim().toUpperCase(), PAIR_JOINED);
}

export const binance: LiveProvider = {
  id: 'binance',
  label: 'Binance',
  quote: s => { const p = split(s); return p ? (p[1] === 'USD' ? 'USDT' : p[1]) : null; },
  intervals: ['1m', '5m', '15m', '1h', '6h', '1d'],
  canPageBack: true,
  async history(symbol, interval, range, deps) {
    const limit = Math.max(1, Math.min(1000, range.limit));
    const end = range.before !== undefined ? `&endTime=${range.before * 1000 - 1}` : '';
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(binanceSymbol(symbol))}&interval=${interval}&limit=${limit}${end}`;
    return parseBinanceKlines(await getJSON(url, deps));
  },
  subscribe(symbol, interval, on, deps) {
    return socket(`wss://data-stream.binance.vision/ws/${encodeURIComponent(binanceSymbol(symbol).toLowerCase())}@kline_${interval}`, deps, on,
      () => on.open(),
      m => { const t = parseBinanceMessage(m); if (t) on.tick(t); });
  },
};

// ── Kraken ──
// REST GET /0/public/OHLC?pair&interval(minutes)&since: {error: [], result: {<pair key>: [[time, "o", "h", "l", "c",
// "vwap", "volume", count], ...], last}}, oldest first, the newest 720 only (no paging back; no 6 h interval).
// WS v2 wss://ws.kraken.com/v2, {method: "subscribe", params: {channel: "trade", symbol: ["BTC/USD"]}}:
// {channel: "trade", data: [{price, qty, trade_id, timestamp (ISO)}]}.

export function parseKrakenOHLC(body: unknown): LiveBar[] {
  const o = body as { error?: unknown[]; result?: Record<string, unknown> } | null;
  if (!o || !o.result) {
    const msg = Array.isArray(o?.error) && o.error.length ? String(o.error[0]) : 'unexpected OHLC response';
    throw new LiveError(`Kraken: ${msg}`, 0, /Unknown asset pair|Invalid arguments/i.test(msg));
  }
  const key = Object.keys(o.result).find(k => k !== 'last');
  const rows = key ? o.result[key] : null;
  if (!Array.isArray(rows)) throw new Error('Kraken: unexpected OHLC response');
  const out: LiveBar[] = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const b = { time: num(r[0]), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[6]) || 0 };
    if (okBar(b)) out.push(b);
  }
  return out.sort((a, b) => a.time - b.time);
}

export function parseKrakenMessage(m: unknown): LiveTick[] {
  const o = m as { channel?: string; data?: unknown[] } | null;
  if (!o || o.channel !== 'trade' || !Array.isArray(o.data)) return [];
  const out: LiveTick[] = [];
  for (const d of o.data as Record<string, unknown>[]) {
    const time = Date.parse(String(d.timestamp)) / 1000;
    const price = num(d.price);
    if (!Number.isFinite(time) || !Number.isFinite(price)) continue;
    out.push({ kind: 'trade', time, price, size: num(d.qty) || 0, id: d.trade_id as number });
  }
  return out;
}

const KRAKEN_MINUTES: Partial<Record<LiveInterval, number>> = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '1d': 1440 };

/** REST pair ('XBTUSD' for BTC) and WS symbol ('BTC/USD'). Throws a permanent LiveError for a symbol that is not a pair. */
export function krakenSymbols(symbol: string): { rest: string; ws: string } {
  const s = split(symbol);
  if (!s) throw new LiveError(`Kraken: "${symbol.slice(0, 40)}" is not a BASE-QUOTE pair`, 0, true);
  return { rest: checked('Kraken', `${s[0] === 'BTC' ? 'XBT' : s[0]}${s[1]}`, PAIR_JOINED), ws: checked('Kraken', `${s[0]}/${s[1]}`, PAIR_SLASH) };
}

export const kraken: LiveProvider = {
  id: 'kraken',
  label: 'Kraken',
  quote: s => split(s)?.[1] ?? null,
  intervals: ['1m', '5m', '15m', '1h', '1d'],
  canPageBack: false,
  async history(symbol, interval, range, deps) {
    if (range.before !== undefined) return [];
    const mins = KRAKEN_MINUTES[interval];
    if (!mins) throw new Error(`Kraken: no ${interval} interval`);
    const since = Math.floor(Date.now() / 1000) - Math.min(720, range.limit) * mins * 60;
    const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(krakenSymbols(symbol).rest)}&interval=${mins}&since=${since}`;
    return parseKrakenOHLC(await getJSON(url, deps)).slice(-range.limit);
  },
  subscribe(symbol, _interval, on, deps) {
    const ws = krakenSymbols(symbol).ws;
    return socket('wss://ws.kraken.com/v2', deps, on,
      s => { s.send(JSON.stringify({ method: 'subscribe', params: { channel: 'trade', symbol: [ws] } })); on.open(); },
      m => { for (const t of parseKrakenMessage(m)) on.tick(t); });
  },
};

export const PROVIDERS: Readonly<Record<'coinbase' | 'binance' | 'kraken', LiveProvider>> = { coinbase, binance, kraken };

/** Bars in ascending time with duplicate times removed (the later one wins). */
export function dedupe(bars: LiveBar[]): LiveBar[] {
  const sorted = bars.slice().sort((a, b) => a.time - b.time);
  const out: LiveBar[] = [];
  for (const b of sorted) {
    if (out.length && out[out.length - 1].time === b.time) out[out.length - 1] = b;
    else out.push(b);
  }
  return out;
}
