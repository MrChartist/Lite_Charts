---
title: How it compares
description: Chartist Lite next to TradingView Lightweight Charts and OpenAlgo Charts, using only figures each project publishes about itself, each with its source and date.
order: 12
related: coming-from-lightweight-charts, indicator-catalogue, api-reference
group: reference
task: See how it compares, with sources
summary: Only figures each project publishes about itself, each with its source and the date it was read, including where the others are ahead.
---

# How it compares

Two open-source chart libraries are often named next to this one. This page sets them side by side using only what each project says about itself on its own page, with the source and the date it was read, and our own figures with the command that measures them. Where a project does not state something, the cell says "not stated". It is not a judgement of either project.

## Side by side

| | Chartist Lite | TradingView Lightweight Charts | OpenAlgo Charts |
|---|---|---|---|
| Version | 0.1.0 [C1](#sources) | not stated on the page [S1](#sources) | 2.7.3 [S2](#sources) |
| Licence | Apache-2.0 [C1](#sources) | Apache 2.0 [S1](#sources) | Apache-2.0 [S2](#sources) |
| Runtime dependencies | 0 [C1](#sources) | not stated on the page [S1](#sources) | zero [S2](#sources) |
| Size of the chart | core {{size.core.gzip}} KB gzip, {{size.core.brotli}} KB brotli [C2](#sources) | "35 KB", compression not stated [S1](#sources) | core 141.88 kB brotli [S2](#sources) |
| A full workspace in one file | {{size.terminal.brotli}} KB brotli (terminal build) [C2](#sources) | not stated [S1](#sources) | 380.39 kB brotli (one createWidget call) [S2](#sources) |
| Chart types | {{chartTypes}} [C3](#sources) | candles, line, bars, area, baseline, histogram, plus custom chart types [S1](#sources) | 13 [S2](#sources) |
| Built-in indicators | {{indicators}} [C3](#sources) | not stated [S1](#sources) | 112 [S2](#sources) |
| Drawing tools | {{drawingTools}} [C3](#sources) | not stated [S1](#sources) | 90 [S2](#sources) |
| Order flow and profiles | none | not stated [S1](#sources) | footprint, volume profile, TPO and market profile [S2](#sources) |
| Trading on the chart | none | not stated [S1](#sources) | order tickets, position lines, a depth ladder [S2](#sources) |
| Bar replay | yes, in the extras [C3](#sources) | not stated [S1](#sources) | yes [S2](#sources) |
| Install with npm | not yet: build from the repository [C1](#sources) | not stated on the page; it offers "Get the library" [S1](#sources) | `npm i openalgo-charts` [S2](#sources) |
| Measured frame cost | worst p95 {{perf.worst}} ms of {{perf.budget}} ms over {{perf.scenarios}} scenarios [C4](#sources) | not stated [S1](#sources) | not stated [S2](#sources) |
| An HTML tag with no code | `<chartist-chart>`, `<chartist-terminal>` [C3](#sources) | not stated [S1](#sources) | not stated [S2](#sources) |
| Accessibility | keyboard inspect mode read aloud through a live region; not yet run with a screen reader [C5](#sources) | "Accessible by design" [S1](#sources) | not stated [S2](#sources) |
| Strict CSP, `style-src 'self'` | works, checked in Chromium [C5](#sources) | not stated [S1](#sources) | not stated [S2](#sources) |
| Time zones | any IANA zone, an axis with no session gaps [C3](#sources) | not stated [S1](#sources) | IST by default, any market by naming its zone [S2](#sources) |
| Phones | touch checked in emulation only [C5](#sources) | "Interactive, responsive, and mobile-ready" [S1](#sources) | "Works on a phone" [S2](#sources) |
| Stated use | new; no production use stated [C1](#sources) | TradingView says its charts are used by over 40000 companies and 100000000 traders [S1](#sources) | not stated [S2](#sources) |

Sizes are not measured the same way: ours bundle each entry with esbuild and compress it with Node's zlib; the other figures are each project's own, from its own build. Treat them as each project's statement, not as a benchmark.

## Where the others are ahead

- **More indicators and drawing tools.** OpenAlgo Charts states 112 indicators and 90 drawing tools; Chartist Lite has {{indicators}} and {{drawingTools}}.
- **Order flow and trading.** OpenAlgo Charts states footprint charts, volume profile, TPO and market profile, and order tickets, position lines and a depth ladder. Chartist Lite has none of these.
- **Installing today.** OpenAlgo Charts installs with `npm i openalgo-charts`, and the Lightweight Charts page offers the library for download. Chartist Lite is not on npm yet.
- **Years of use.** The Lightweight Charts page says TradingView charts are used by over 40000 companies and 100000000 traders. Chartist Lite is new, at version 0.1.0.

## Where Chartist Lite is ahead

- **Size.** A {{size.core.gzip}} KB gzip core ({{size.core.brotli}} KB brotli), and the whole terminal in {{size.terminal.brotli}} KB brotli. Every part is its own entry, so a page loads only what it draws.
- **A measured frame budget.** Every gesture we measure stays within a 120 Hz frame in headless Chromium, and the figures are published: see [Performance](../PERFORMANCE.md).
- **No-code tags.** `<chartist-chart>` and `<chartist-terminal>` put a chart, or the whole workspace, on a page with no JavaScript of your own.
- **Keyboard and screen reader.** The chart takes focus, steps through bars and announces each one.
- **Strict pages.** It works under a `style-src 'self'` policy, with hostile page CSS and on right-to-left pages.
- **Exchange time zones.** Labels in any IANA zone with no gaps for nights and weekends.

## Sources

| | Source | Read |
|---|---|---|
| S1 | TradingView Lightweight Charts page, https://www.tradingview.com/lightweight-charts/ | 2026-11-22 |
| S2 | OpenAlgo Charts page, https://openalgo.in/charts | 2026-11-22 |
| C1 | This package's `package.json` and `CHANGELOG.md` | at build time |
| C2 | Measured by this site's build (`npm run site`) with esbuild and Node's zlib; `npm run size` prints the gzip figures | at build time |
| C3 | Read from the source by this site's build: the indicator catalogue, `CHART_TYPES` and the drawing tools | at build time |
| C4 | `docs/performance.json`, written by `npm run bench` | the bench run |
| C5 | This package's own checks; see [What was tested](embedding.md#what-was-tested) and [Accessibility](accessibility.md) | 2026-11-22 |

Lightweight Charts and TradingView are trademarks of TradingView, Inc.; OpenAlgo is the name of its project. All trademarks belong to their owners. Chartist Lite is not affiliated with, endorsed by or derived from either project. Each project's own page is the authority on its figures; if one has changed since the date above, that page is right and this one is out of date.

---

All documents: [docs/README.md](../README.md). The package front door: [README](../../README.md).
