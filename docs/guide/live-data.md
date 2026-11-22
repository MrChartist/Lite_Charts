---
title: Live data
description: Live prices for Chartist Lite from Coinbase, Binance and Kraken: connectLive, the one-tag element, statuses, your own provider, React, strict CSP and privacy.
order: 6.7
related: embedding, time-and-time-zones, api-reference
group: build
task: Stream live prices
summary: History and a live stream from public exchange feeds, in one call or one tag, with your own provider when you need one.
---

# Live data

The optional `live` entry fills a series with history and then streams live prices into it from a public exchange feed: Coinbase, Binance or Kraken, with no API key and no server. The core never imports it and makes no network requests; this entry connects only when you call `connectLive`, and then the visitor's browser talks to the exchange directly.

> [!NOTE]
> Every live chart on this page is off until you press Connect. Until then the page asks no exchange for anything. The prices come straight from the exchange to your browser, and are indicative, not advice.

## Connect a series

```js live height=420 connect
import { createChart, CandlestickSeries, HistogramSeries } from 'lite-charts';
import { connectLive } from 'lite-charts/live';

const chart = createChart('chart', { timeScale: { timeZone: 'local' } });
const candles = chart.addSeries(CandlestickSeries, { title: 'BTC-USD' });
const volume = chart.addSeries(HistogramSeries, {
  title: 'Volume', priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false,
  priceFormat: { precision: 4, minMove: 0.0001 },
});
chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

const live = connectLive(candles, { symbol: 'BTC-USD', interval: '1m', provider: 'coinbase', volumeSeries: volume, chart });
```

`connectLive(series, options)` loads history over REST (500 bars unless you say otherwise), puts it in the series with `setData`, opens the exchange's WebSocket stream and folds what arrives into bars. However fast trades come, the changed bars go to `series.update()` once per animation frame. A candlestick or bar series gets open, high, low and close; any other series gets the close as its value, so a line works too.

It returns a handle, and `live.disconnect()` closes the socket, aborts requests, clears its timers and removes its listeners. It never throws into your page: failures go to `onStatus` and `onError`, and the feed carries on.

With a script tag, load `chartist-lite-live.iife.min.js` next to the core file and use the global `ChartistLiteLive`, as in `ChartistLiteLive.connectLive(candles, { symbol: 'BTC-USD' })`.

### Options

| Option | Values | Default |
|---|---|---|
| `symbol` | `'BTC-USD'`, `'ETH-USD'`, `'SOL-USD'` or any BASE-QUOTE pair, mapped for each exchange; anything else is passed through as written | `'BTC-USD'` |
| `interval` | `'1m'`, `'5m'`, `'15m'`, `'1h'`, `'6h'`, `'1d'` | `'1m'` |
| `provider` | `'coinbase'`, `'binance'` or `'kraken'`: tried first, then the other two if its history fails. Or a provider object, used alone | `'coinbase'` |
| `volumeSeries` | A histogram (or any single-value series) that gets each bar's volume | none |
| `chart` | The chart: older history loads when the view reaches the left edge | none |
| `history` | Bars loaded at start and per older page, 10 to 5000 | `500` |
| `onStatus(status, info)` | Called when the status changes, with `info()` (below) | none |
| `onError(error)` | Called with each failure; the feed carries on | none |
| `onBars(kind, bars)` | `'history'` after history loads, `'update'` after each frame's updates, with the bars that changed | none |
| `guard` | The bad-print guard: `{ maxJump, futureSeconds }` to tune it; `false` keeps only the rules that cannot drop a real print (finite, positive prices, no far-future time) | `{ maxJump: 20, futureSeconds: 900 }` |
| `fetch`, `WebSocket`, `env` | Replacements for tests and other environments (frames, timers, clock, document, window) | the browser's |

Each exchange caps one load: Coinbase gives 300 bars a call and the entry makes at most five calls (1500 bars), Binance up to 1000, Kraken its newest 720.

### Statuses

| Status | When |
|---|---|
| `connecting` | The first load of history and the stream |
| `live` | The stream is open and subscribed |
| `reconnecting` | The stream closed, went quiet, or a retry with bars already shown. It waits 1 s, doubling up to 30 s, each wait varied by up to 30%, then reloads history to fill the gap |
| `offline` | The tab is hidden or the browser is offline: the stream is closed and requests are aborted until it comes back. Also after `disconnect()` |
| `error` | No exchange returned history. It tries again on the same schedule, except after three rounds in a row that fail for good (an HTTP 4xx, an unknown or malformed symbol, no bars): then it stops until you call `retry()` |

Show the status as a word with its colour, never colour alone. The demos on this page and the element do exactly that.

### Limits that keep it polite

Every history request is abandoned after 10 s (and the next exchange is tried), a socket must open within 10 s, and a stream with no message for 60 s, or three intervals when that is longer (capped at 5 minutes), is reconnected. The backoff starts over only once a trade has arrived or the socket has stayed open for 30 s, so a server that accepts and drops at once is not asked every second; history is not reloaded when the last load is under 10 s old; and no more than 30 starts happen in an hour. These are `LIVE_LIMITS`.

The bad-print guard drops only what cannot be a real print: a price further from the last close than `maxJump` times the recent range (the high-low span of the last 50 bars, never taken as under 5% of the price; 20 times by default, which with a calm range is a whole 100% of the price in one trade), a time too far in the future, or a price that is not positive. A unit mistake or a corrupt message is caught; a fast market is not.

## The element, with no code

```html live height=320 connect
<script src="chartist-lite.element-live.iife.min.js"></script>
<chartist-chart live symbol="BTC-USD" interval="1m" provider="coinbase" volume height="320"
  aria-label="Bitcoin in US dollars, one-minute candles, live"></chartist-chart>
```

`chartist-lite.element-live.iife.min.js` is the `<chartist-chart>` element with the live entry inside. The plain element build has no network code at all; a `live` tag there shows one quiet line saying it needs the element-live build.

| Attribute | Values | Default |
|---|---|---|
| `live` | present: history and a stream instead of `src` or inline data | off |
| `symbol` | as in `connectLive` | `BTC-USD` |
| `interval` | `1m`, `5m`, `15m`, `1h`, `6h`, `1d` | `1m` |
| `provider` | `coinbase`, `binance` or `kraken`; the other two are tried if its history fails | `coinbase` |
| `volume` | present: a volume histogram at the foot of the price | off |

The other attributes (`type`, `theme`, `height`, `time-zone`, `loading`, `aria-label`) work as in [Embedding the chart](embedding.md#attributes); `type="line"` streams the close as a line. A dot and a word at the top right of the plot show the status. Changing `symbol` or `interval` switches the stream; changing `provider`, `type` or `volume` starts again; removing the element disconnects it. Like every element it is created when it scrolls within 200 px of the viewport, so it connects then, or at once with `loading="eager"`. It fires `chartist-ready` after the first history and `chartist-error` for each failure.

## Switch interval and symbol

```js live height=420 connect controls=market
const chart = createChart('chart', { timeScale: { timeZone: 'local' } });
const candles = chart.addSeries(CandlestickSeries, { title: 'BTC-USD' });
const live = connectLive(candles, {
  symbol: 'BTC-USD', interval: '1m', chart,
  onStatus: (status, info) => candles.applyOptions({ title: info.symbol }),
});

// The buttons under the chart call these:
//   live.setInterval('5m')     '1m' | '5m' | '15m' | '1h' | '6h' | '1d'
//   live.setSymbol('ETH-USD')
```

`setInterval(interval)` and `setSymbol(symbol)` clear the bars, load history again starting from the first exchange in line, and subscribe afresh. An unknown interval, the value already in use, or an empty symbol is ignored. `status()`, `provider()`, `symbol()` and `interval()` read the current state; `provider()` names the exchange in use after any fallback, or `null` before one answers. `info()` gives `{ provider, providerLabel, symbol, pair, quote, interval }`: on Binance, `BTC-USD` is quoted as `BTC-USDT` with `quote: 'USDT'`, so a label can say so. `retry()` starts again after the status stopped at `error`.

## Load older history

With `chart` in the options, scrolling to within 20 bars of the left edge loads one page of older bars (`history` bars) before the first one. To load a page yourself:

```js
const added = await live.loadOlder();   // the bars added; 0 when there is nothing older
```

`loadOlder()` resolves to 0 while a load is already running, at the start of the data, and when the exchange cannot page back. Coinbase and Binance page back; Kraken serves only its newest 720 bars, so a Kraken chart has no older history.

## Write your own provider

A provider is a small object. This one makes its prices up, so it needs no network and runs as soon as the page opens:

```js live height=360
import { createChart, CandlestickSeries } from 'lite-charts';
import { connectLive } from 'lite-charts/live';

let last = 100;
const walk = (p) => +(p * (1 + (Math.random() - 0.5) * 0.004)).toFixed(2);

const demoExchange = {
  id: 'demo',
  intervals: ['1m', '5m'],
  canPageBack: false,
  async history(symbol, interval, { limit }) {
    const step = interval === '5m' ? 300 : 60;
    const now = Math.floor(Date.now() / 1000 / step) * step;
    return Array.from({ length: limit }, (_, i) => {
      const open = last; last = walk(open);
      return { time: now - (limit - 1 - i) * step, open, high: Math.max(open, last) + 0.05, low: Math.min(open, last) - 0.05, close: last, volume: 1 };
    });
  },
  subscribe(symbol, interval, on) {
    const timer = setInterval(() => { last = walk(last); on.tick({ kind: 'trade', time: Date.now() / 1000, price: last, size: 1 }); }, 500);
    on.open();
    return () => clearInterval(timer);   // after this, never call on.closed
  },
};

const chart = createChart('chart', { timeScale: { timeZone: 'local' } });
const candles = chart.addSeries(CandlestickSeries, { title: 'DEMO, made up' });
connectLive(candles, { provider: demoExchange, interval: '1m', history: 120 });
```

| Member | What it does |
|---|---|
| `id` | A name, reported by `provider()` and `onStatus` |
| `intervals` | The intervals it serves; for any other, `connectLive` moves on (with a provider object, there is nothing to move on to) |
| `canPageBack` | Whether `history` takes `before`; `false` turns older-history loading off |
| `history(symbol, interval, { limit, before? }, { fetch, WebSocket, signal })` | Bars that start before `before` (UNIX seconds), or the newest bars; at most `limit`, in ascending time |
| `subscribe(symbol, interval, { tick, open, closed }, { fetch, WebSocket })` | Opens a stream and returns a function that closes it. Call `open()` once subscribed, `tick()` for each message, `closed(reason)` if the stream ends on its own; never call `closed` after your close function ran |

A bar is `{ time, open, high, low, close, volume }` with `time` the start of its interval in UNIX seconds. `tick` takes a trade, `{ kind: 'trade', time, price, size, id? }`, or a whole bar, `{ kind: 'bar', bar, closed }`. Trades fold into the bar of their interval; a trade for a bar that has already closed is dropped, and a repeated `id` counts once. A whole bar replaces the bar of its time. Use the `fetch` and `signal` you are given, so that `disconnect()` can abort your requests.

The built-in providers are exported as `coinbase`, `binance`, `kraken` and `PROVIDERS`, with their pure parsers (`parseCoinbaseCandles` and the rest) and symbol maps (`binanceSymbol`, `krakenSymbols`). Passing `provider: coinbase`, the object rather than the name, uses Coinbase alone, with no fallback.

## Use it with React

There is no hook of ours to learn. Create the chart in an effect (or in the React wrapper's `onReady`), call `connectLive` there, and return `disconnect` as the cleanup:

```jsx
import * as React from 'react';
import { createChart, CandlestickSeries } from 'lite-charts';
import { connectLive } from 'lite-charts/live';

export function LiveBitcoin({ interval = '1m' }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const chart = createChart(ref.current, { theme: 'auto', ariaLabel: 'Bitcoin, live' });
    const candles = chart.addSeries(CandlestickSeries, { title: 'BTC-USD' });
    const live = connectLive(candles, { symbol: 'BTC-USD', interval, chart });
    return () => { live.disconnect(); chart.remove(); };
  }, [interval]);
  return <div ref={ref} style={{ height: 420 }} />;
}
```

Under `StrictMode` React runs the effect twice in development; the cleanup closes the first connection, so only one stays open. To keep the chart and switch only the stream, keep the handle in a ref and call `live.setInterval()` instead of starting again.

## Strict Content-Security-Policy

A page with a `connect-src` policy must allow the exchange you use. These are the hosts the entry contacts:

| Exchange | History (REST) | Stream (WebSocket) |
|---|---|---|
| Coinbase | `https://api.exchange.coinbase.com` | `wss://ws-feed.exchange.coinbase.com` |
| Binance | `https://data-api.binance.vision` | `wss://data-stream.binance.vision` |
| Kraken | `https://api.kraken.com` | `wss://ws.kraken.com` |

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  connect-src 'self' https://api.exchange.coinbase.com wss://ws-feed.exchange.coinbase.com
```

With a provider name, the other two exchanges are tried when the first fails, and a policy that names only one blocks them. Either allow all six hosts, or pass the provider object (`provider: coinbase`) so only that exchange is ever contacted. The element-live build adds nothing else to the policy: its styles go through the CSSOM, as the plain element's do.

## Privacy

- **Off until you call it.** Importing the entry touches no DOM and opens nothing. `connectLive`, or a `<chartist-chart live>` tag, starts the connection.
- **Straight to the exchange.** The visitor's browser connects to the exchange's public API directly: no proxy, no server of yours or ours, no API key.
- **Nothing stored.** The entry writes nothing to storage. History requests are sent with `credentials: 'omit'`, so they carry no cookies; a WebSocket has no such switch, so the stream's opening request follows the browser's own cookie rules for the exchange's site. The exchange sees the visitor's IP address and the page's origin, as it would for any request a browser makes.
- **Paused when hidden.** A hidden tab or an offline browser closes the stream until the page is back.

On this site, the home page's hero chart connects to Coinbase by itself when it comes into view, labelled "Real market data · Coinbase", unless you chose "Use demo data" (remembered in your browser), your browser asks to save data, or it is offline. Every other live demo, this page's included, stays off until you press Connect, and the site check confirms that no other page asks an exchange for anything as it opens.

## Honest notes

> [!VERIFY]
> Exchange terms for commercial or redistributed use: Needs verification, and the embedder's responsibility. The exchanges' own terms of use and rate limits apply to anyone who ships the live entry; read them before you show their prices in a product.

- **Indicative prices, not advice.** They can be delayed or incomplete at times: a gap after a reconnect is filled from history, and a trade that arrives late for a bar that has closed is dropped.
- **Binance quotes in USDT.** `'BTC-USD'` becomes `BTCUSDT` there, a price in Tether, not US dollars. It is reached through Binance's public market data hosts (`binance.vision`), because `api.binance.com` is blocked in some regions.
- **Kraken has no 6h interval and limited history.** A `'6h'` chart skips Kraken, and Kraken serves only its newest 720 bars with no older pages.
- **What each exchange streams.** Coinbase and Kraken send trades, which the entry folds into bars; Binance sends whole candles for the interval.
- **What was checked.** The parsers are tested against real messages captured from each exchange on 2026-11-21, the streaming logic against a fake socket (reconnect, backfill, pause, fallback, disconnect, older pages), and a Chromium run against the real exchanges. Browsers other than Chromium, and sessions lasting many hours, have not been verified.

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
