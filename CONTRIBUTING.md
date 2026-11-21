# Contributing to Chartist Lite

Thank you for helping. This guide explains how to set up the project and what we expect in a change.

## Set up

```bash
npm install
npm run build
npm test
npm run size
```

- `npm install` installs the development tools. The library itself has no runtime dependencies.
- `npm run build` builds the package.
- `npm test` runs the test suite.
- `npm run size` checks the size of the bundle.

## Rules

- **Zero runtime dependencies.** The package must not add any dependency that ships to users.
- **No import leaves the package.** Source files may import only other files in this package.
- **No code copied from other charting libraries.** Write each part yourself. If you port an algorithm from a published idea, add one line for it in `PROVENANCE.md`.
- **Keep the bundle small.** Check `npm run size` before you open a pull request. Explain any growth.
- **Tests for pure logic.** Calculations, scales, and data handling need tests.
- **Screenshots for visual changes.** Attach a light and a dark theme screenshot for any change that alters how a chart looks.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/), for example:

- `feat: add area series`
- `fix: correct axis label position`
- `docs: explain the series options`

## Licence

By contributing, you agree that your contributions are licensed under the Apache License 2.0, the same licence as the project (see `LICENSE`).
