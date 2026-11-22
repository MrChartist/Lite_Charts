// Colours the example series and plugins share. Plain functions, no DOM.

import type { ThemeColors } from '../../../core/theme';
import { parseColor } from '../../../core/theme';

/** True when a colour is dark (perceived luminance under 50%). */
export function isDarkBackground(color: string): boolean {
  const rgb = parseColor(color);
  return !!rgb && (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 < 128;
}

/**
 * Six distinct series colours for a theme, none purple, each at least 4.5:1 against the background: amber, teal, olive, slate, rose, green (the first four carry no up / down meaning).
 */
export function seriesPalette(colors: Readonly<ThemeColors>): string[] {
  return isDarkBackground(colors.background)
    ? ['#FFB340', '#40C8E0', '#E5E54C', '#A8B3C4', '#FF6482', '#63E6BE']
    : ['#B25000', '#007A99', '#7A6A00', '#4A5568', '#C41E3A', '#00785A'];
}

/** `color` with its alpha set; unchanged when it cannot be parsed. */
export function alphaOf(color: string, alpha: number): string {
  const rgb = parseColor(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
}
