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

The live Bitcoin demos (the hero's Live BTC toggle, the home chapter, the examples card and the Live data guide) are off
until a reader presses them; then the reader's browser connects to the exchange directly. To keep them working under a
policy, add `connect-src 'self' https://api.exchange.coinbase.com wss://ws-feed.exchange.coinbase.com`, plus
`https://data-api.binance.vision wss://data-stream.binance.vision https://api.kraken.com wss://ws.kraken.com` for the
element's fallback to Binance and Kraken. Without them those demos fall back quietly; nothing else changes.

## Live demos and the check

`node site/check.cjs` needs no network. It blocks every other host and asserts that no page requests one while it
opens. Then it stubs `fetch` and `WebSocket` inside the page (`liveStub` in `check.cjs`) and checks that the hero's
toggle is off by default, connects on a click, reads Live, moves its last bar on a stubbed trade and falls back to the
demo data when the stub fails; the same for the home chapter's element (including its fallback to Binance and Kraken)
and the guide's interval switch. With `SITE_SHOTS=1` it also tries one real connection for
`docs/screenshots/site-live-dark.png`, and skips it when the exchange cannot be reached.
