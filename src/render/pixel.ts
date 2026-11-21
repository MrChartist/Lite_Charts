// Device-pixel helpers: everything the chart strokes or fills is placed on whole device pixels, so lines stay
// one crisp pixel at any device pixel ratio (1, 1.25, 1.5, 2, 3...). Ported from the host engine's crisp-line and
// candle-geometry rules (PROVENANCE.md).

/** A CSS length in whole device pixels, never under one. */
export function deviceWidth(cssWidth: number, ratio: number): number {
  return Math.max(1, Math.round(cssWidth * ratio));
}

/**
 * The device coordinate where a stroke `width` device px wide must be centred to cover whole pixels: a pixel centre
 * (x.5) for an odd width, a pixel edge for an even one.
 */
export function crispCoord(cssValue: number, width: number, ratio: number): number {
  const d = cssValue * ratio;
  return width % 2 === 1 ? Math.floor(d) + 0.5 : Math.round(d);
}

/** The hairline a screen asks for: one CSS pixel where the ratio is whole, else the whole part of it. */
export function hairline(ratio: number): number {
  return Number.isFinite(ratio) && ratio >= 2 ? Math.floor(ratio) : 1;
}

/** Below this spacing (device px) candles are drawn as aggregated one-pixel columns. */
export const COLUMN_MODE_BELOW = 3;

export interface CandleLayout {
  mode: 'bars' | 'columns';
  /** Body width, whole device px, same parity as the wick so the wick sits on the exact centre. */
  body: number;
  /** Wick thickness, whole device px. */
  wick: number;
}

/** Body and wick widths for a bar spacing in device px. */
export function candleLayout(spacingDev: number, ratio: number): CandleLayout {
  const s = Number.isFinite(spacingDev) && spacingDev > 0 ? spacingDev : 0;
  if (s < COLUMN_MODE_BELOW) return { mode: 'columns', body: 1, wick: 1 };
  const gap = Math.max(1, Math.round(s * 0.22));
  let body = Math.max(1, Math.floor(s) - gap);
  const wick = Math.max(1, Math.min(hairline(ratio), Math.floor(body / 3)));
  if ((body - wick) % 2 !== 0) body -= 1;
  return { mode: 'bars', body: Math.max(1, body), wick };
}

/** [top, height) in whole device px for device y values a and b (any order); height at least 1. */
export function snapSpan(aDev: number, bDev: number): { top: number; h: number } {
  const top = Math.round(Math.min(aDev, bDev));
  return { top, h: Math.max(1, Math.round(Math.max(aDev, bDev)) - top) };
}
