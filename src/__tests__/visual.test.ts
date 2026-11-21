// The default look (2026-11-21 polish): contrast of every text colour, candle gaps, legend text.
import { describe, expect, it } from 'vitest';
import { describeRow, isOhlc, withOpacity } from '../chart/legend';
import { formatPrice, MINUS_SIGN } from '../core/format';
import { darkTheme, lightTheme, parseColor, type ThemeColors } from '../core/theme';
import { candleLayout } from '../render/pixel';

function lum(hex: string): number {
  const rgb = parseColor(hex) as [number, number, number];
  const ch = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
}
const contrast = (a: string, b: string): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe('theme contrast', () => {
  for (const [name, t] of [['light', lightTheme], ['dark', darkTheme]] as [string, ThemeColors][]) {
    it(`${name}: text, muted text and direction text are at least 4.5:1, tags too`, () => {
      for (const k of ['text', 'mutedText', 'upText', 'downText'] as const) expect(contrast(t[k], t.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.tagText, t.tagBackground)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: up and down marks stand out from the background (3:1, graphics)`, () => {
      expect(contrast(t.up, t.background)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.down, t.background)).toBeGreaterThanOrEqual(3);
    });
  }
  it('no purple in either theme', () => {
    for (const t of [lightTheme, darkTheme]) for (const v of Object.values(t)) {
      const rgb = parseColor(v);
      if (!rgb) continue;
      const [r, g, b] = rgb;
      expect(r > 120 && b > 120 && g < Math.min(r, b) * 0.7).toBe(false);
    }
  });
});

describe('candle geometry', () => {
  it('at least one device pixel between neighbouring bodies at every spacing from 3 to 40', () => {
    for (let s = 3; s <= 40; s += 0.25) {
      for (const ratio of [1, 1.5, 2, 3]) {
        const l = candleLayout(s, ratio);
        expect(l.mode).toBe('bars');
        expect(Math.floor(s) - l.body).toBeGreaterThanOrEqual(1);
        expect((l.body - l.wick) % 2).toBe(0);
      }
    }
  });
  it('bodies take about two thirds of the spacing', () => {
    const l = candleLayout(20, 1);
    expect(l.body / 20).toBeGreaterThan(0.6);
    expect(l.body / 20).toBeLessThan(0.75);
  });
});

describe('legend text', () => {
  const fmt = (v: number): string => formatPrice(v, 2);
  it('OHLC with the change from the previous close, sign and arrow', () => {
    const d = describeRow({ open: 10, high: 12, low: 9, close: 11 }, { open: 9, high: 10, low: 8, close: 10 }, fmt, () => NaN);
    expect(d.values).toBe('O 10.00  H 12.00  L 9.00  C 11.00');
    expect(d.change).toEqual({ text: '▲ +1.00 (+10.00%)', dir: 1 });
    const down = describeRow({ open: 10, high: 10, low: 8, close: 9 }, null, fmt, () => NaN);
    expect(down.change).toEqual({ text: `▼ ${MINUS_SIGN}1.00 (${MINUS_SIGN}10.00%)`, dir: -1 });
    const flat = describeRow({ open: 10, high: 10, low: 10, close: 10 }, null, fmt, () => NaN);
    expect(flat.change).toEqual({ text: '0.00 (0.00%)', dir: 0 });
  });
  it('one value for single-value rows; nothing for a missing row', () => {
    expect(describeRow({ value: 62.19 }, null, fmt, r => r.value as number)).toEqual({ values: '62.19', change: null });
    expect(describeRow(null, null, fmt, () => 1)).toEqual({ values: '', change: null });
    expect(isOhlc({ open: 1, high: 1, low: 1, close: 1 })).toBe(true);
    expect(isOhlc({ value: 1 })).toBe(false);
  });
  it('withOpacity', () => {
    expect(withOpacity('#141414', 0.5)).toBe('rgba(20, 20, 20, 0.5)');
    expect(withOpacity('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(withOpacity('rgb(1, 2, 3)', 0.2)).toBe('rgba(1, 2, 3, 0.2)');
    expect(withOpacity('tomato', 0.2)).toBe('tomato');
  });
});
