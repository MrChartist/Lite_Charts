# The documentation site

A static site built from `README.md`, `docs/guide/*.md` and `docs/PERFORMANCE.md`, with live charts drawn by the
package itself. No framework and no runtime dependency.

```bash
npm install
npm run build          # the package's dist/ (the site serves the real library)
npm run site           # writes site/dist/
node site/check.cjs    # checks every page in Chromium (needs Playwright importable)
```

Open `site/dist/index.html` from disk, or serve the folder. Every link is relative, so the same `site/dist` works from
`file://`, at a domain root or under any sub-path.

## Settings

`site.config.json` holds the public address (`baseUrl`), the source repository (`repoUrl`), the author and the licence.
Two environment variables override it at build time, so a CI job needs no edit:

| Variable | Used for |
|---|---|
| `SITE_BASE_URL` | Canonical links, Open Graph URLs, JSON-LD, `sitemap.xml`, `robots.txt` and the `<base>` of `404.html` |
| `SITE_REPO_URL` | The GitHub link in the header and links to files that are not site pages; the link is hidden while empty |

## Deploy

The output is plain files: `site/dist` with an `index.html`, a `404.html` and a `.nojekyll`. Build it with your
public address, then hand the folder to any static host.

| Host | One line |
|---|---|
| GitHub Pages | Push to the default branch: `.github/workflows/pages.yml` builds and deploys (Settings, Pages, Source: GitHub Actions) |
| Cloudflare Pages | Build command `npm ci && npm run build && SITE_BASE_URL=https://<project>.pages.dev npm run site`, output directory `site/dist` |
| Netlify | `npx netlify deploy --prod --dir site/dist` after building with `SITE_BASE_URL=https://<site>.netlify.app` |
| Vercel | `npx vercel deploy site/dist --prod` after building with `SITE_BASE_URL=https://<project>.vercel.app` |

The workflow takes the address from GitHub's own Pages settings (`actions/configure-pages`), so canonical links and
the sitemap are right for a project site (`https://<user>.github.io/<repo>/`) and for a custom domain.

The workflow lives in this package's own `.github/workflows/`; GitHub runs it once the package is its own repository.
Inside a larger repository, copy it to the repository's `.github/workflows/` and add
`defaults: { run: { working-directory: packages/chartist-lite } }` plus the matching artifact path.

## Content security

The pages need no `'unsafe-inline'`: the only inline `<script>` blocks are JSON-LD and the element's JSON data, which
are data, not code. A policy such as `default-src 'self'; img-src 'self' data:` works for the whole site; the live
charts load the package's script files from `assets/`.

The home page's hero is the ready-made widget (`chartist-lite.terminal.iife.min.js`, loaded after the page's load event
behind a static poster, `site/assets/img/hero-poster-*.jpg`, which the check writes in demo mode). It shows real market
data by default: the reader's browser connects to Coinbase's public feed for BTC-USD (the widget's own symbol search
offers the other pairs), labelled "Real market data · Coinbase". It stays on
demo data when the reader chose "Use demo data" (remembered in `localStorage` as `cl-hero-data`), when the browser asks
to save data (`navigator.connection.saveData` or `prefers-reduced-data`) or is offline, and falls back to it with a quiet
line when the feed fails. Every other live demo (the home chapter, the examples card and the Live data guide) stays off
until a reader presses Connect. To keep them working under a
policy, add `connect-src 'self' https://api.exchange.coinbase.com wss://ws-feed.exchange.coinbase.com`, plus
`https://data-api.binance.vision wss://data-stream.binance.vision https://api.kraken.com wss://ws.kraken.com` for the
element's fallback to Binance and Kraken. Without them those demos fall back quietly; nothing else changes.

## Live demos and the check

`node site/check.cjs` needs no network. It blocks every other host and asserts that no page requests one while it
opens. Every context stubs `fetch` and `WebSocket` for the exchanges inside the page (`liveStub` in `check.cjs`), so the
home hero's automatic connection never leaves the machine either. The check asserts that the hero widget loads lazily,
connects by itself, says "Real market data · Coinbase", moves its last bar on a stubbed trade, that "Use demo data"
disconnects and, after a reload, nothing is requested; that it falls back to the demo data when the stub fails, and does
not connect with Save-Data on; that no other page connects by itself; and, for the click-to-connect demos, the home
chapter's element (including its fallback to Binance and Kraken) and the guide's interval switch. With `SITE_SHOTS=1` it also tries one real connection for
`docs/screenshots/site-live-dark.png`, and skips it when the exchange cannot be reached.

## Numbers and generated parts

Every count and size on the site is read at build time, never typed: the indicator catalogue, `CHART_TYPES` and the
drawing tools are bundled from the source and imported by `build.mjs`; sizes are measured with esbuild and Node's zlib
(gzip and brotli); the frame figures come from `docs/performance.json`. Guides name them as tokens, such as
`{{indicators}}`, `{{drawingTools}}` or `{{size.core.gzip}}` (`tokens()` in `build.mjs` lists them); an unknown token
is a build warning. The indicator catalogue table and the drawing tools table are generated where a guide says
`@@CATALOGUE@@` or `@@DRAWING_TOOLS@@`. The feature gallery of `examples.html` comes from `src/gallery.js`: each tab's
code is compiled into the page's live script, and "Get this code" shows the same text (the check compares them).


## Look

A plain documentation look, on purpose neutral: system fonts (no web fonts at all), light by default and dark when
the system asks, a remembered toggle that wins over both, a neutral grey scale, hairline borders, radii of 8 to 12 px,
one blue for links and focus, green and red only for market direction. The charts keep the library's own default look.
`layout: wide` in a guide's front matter drops the "On this page" column for a page with a wide table.

The check asserts the look too: no font file and no `@font-face` anywhere in `site/dist`, no font request, no pink or
purple colour in `site.css`, no chapter capsule or numbered chapter labels, and a default theme that follows the
system. With `SITE_SHOTS=1` it also writes the README's hero pair (`docs/screenshots/readme-hero-{dark,light}.png`, the
widget on demo data at 1100 by 620 CSS px, device scale 2) and renders the README at GitHub's 880 px column on its light
and dark page colours for review (`site/dist/review/`, or `SITE_CHECK_SCRATCH`).
