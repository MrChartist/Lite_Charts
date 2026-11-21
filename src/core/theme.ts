// Built-in themes. A calm palette after Apple's system colours: green and red for up and down (the higher-contrast
// variants where text sits on them), blue for lines, no purple. Plain data, safe to import anywhere.

export interface ThemeColors {
  background: string;
  /** Axis text. */
  text: string;
  /** Secondary text (the attribution link). */
  mutedText: string;
  grid: string;
  /** Line between stacked panes. */
  paneSeparator: string;
  crosshair: string;
  /** Crosshair axis tags: fill and text. */
  tagBackground: string;
  tagText: string;
  up: string;
  down: string;
  /** Default colour of a line series. */
  line: string;
  focusRing: string;
}

export const lightTheme: Readonly<ThemeColors> = {
  background: '#FFFFFF',
  text: '#3A3A3C',
  mutedText: '#6E6E73',
  grid: 'rgba(60, 60, 67, 0.08)',
  paneSeparator: 'rgba(60, 60, 67, 0.18)',
  crosshair: 'rgba(60, 60, 67, 0.55)',
  tagBackground: '#1D1D1F',
  tagText: '#FFFFFF',
  up: '#248A3D',
  down: '#D70015',
  line: '#0066CC',
  focusRing: '#0066CC',
};

export const darkTheme: Readonly<ThemeColors> = {
  background: '#141414',
  text: '#D1D1D6',
  mutedText: '#98989D',
  grid: 'rgba(235, 235, 245, 0.08)',
  paneSeparator: 'rgba(235, 235, 245, 0.2)',
  crosshair: 'rgba(235, 235, 245, 0.5)',
  tagBackground: '#F5F5F7',
  tagText: '#1D1D1F',
  up: '#30D158',
  down: '#FF453A',
  line: '#0A84FF',
  focusRing: '#0A84FF',
};

/**
 * Black or white, whichever reads better on `fill` (WCAG relative luminance). Accepts #rgb, #rrggbb and rgb()/rgba();
 * anything else gets white.
 */
export function readableTextOn(fill: string): string {
  const rgb = parseColor(fill);
  if (!rgb) return '#FFFFFF';
  const lum = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const l = 0.2126 * lum(rgb[0]) + 0.7152 * lum(rgb[1]) + 0.0722 * lum(rgb[2]);
  // Contrast against white is 1.05 / (l + 0.05); against black (l + 0.05) / 0.05. Pick the larger.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#FFFFFF' : '#000000';
}

export function parseColor(c: string): [number, number, number] | null {
  const s = c.trim();
  if (s[0] === '#') {
    const h = s.slice(1);
    if (h.length === 3 || h.length === 4) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    if (h.length === 6 || h.length === 8) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return null;
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
