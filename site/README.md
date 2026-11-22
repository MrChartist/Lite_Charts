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
