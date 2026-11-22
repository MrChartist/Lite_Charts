import { describe, expect, it } from 'vitest';
import { alertsFromJSON, alertsToJSON, crossings, nearestLine, snapPrice, type PriceAlert } from '../plugins/extras/alerts';
import { firstVisibleRef, percentChange, percentText, rebaseFactor, scaleRows } from '../plugins/extras/compare';
import { startIndexAt, stepIndex, tickReplay, BASE_BAR_MS } from '../plugins/extras/replay';
import { describeBar, describeChange, placeFloating, placeTracking } from '../plugins/extras/tooltip';
import { bandExtent, chipLeft, dayStarts, isIntraday, pairEdges } from '../plugins/extras/bands';
import { fitFontSize, placeBlock } from '../plugins/extras/watermark';
import { newestBarHidden } from '../plugins/extras/realtime-button';
import { nextIndex, switcherColors } from '../plugins/extras/range-switcher';
import { accentFor, contrastRatio, seriesPalette } from '../plugins/extras/common';
import { darkTheme, lightTheme } from '../core/theme';

const fmt = (v: number): string => v.toFixed(2);

describe('alert crossings', () => {
  const lv = [{ id: 'a', price: 100 }, { id: 'b', price: 110 }, { id: 'c', price: 90 }];
  it('fires upward and downward crossings', () => {
    expect(crossings(95, 105, lv)).toEqual([{ id: 'a', direction: 'up' }]);
    expect(crossings(105, 95, lv)).toEqual([{ id: 'a', direction: 'down' }]);
  });
  it('a gap that jumps over several levels fires them all, in the order the price meets them', () => {
    expect(crossings(85, 120, lv)).toEqual([{ id: 'c', direction: 'up' }, { id: 'a', direction: 'up' }, { id: 'b', direction: 'up' }]);
    expect(crossings(120, 85, lv)).toEqual([{ id: 'b', direction: 'down' }, { id: 'a', direction: 'down' }, { id: 'c', direction: 'down' }]);
  });
  it('arriving exactly on a level counts; leaving a level it stood on does not', () => {
    expect(crossings(99, 100, lv)).toEqual([{ id: 'a', direction: 'up' }]);
    expect(crossings(101, 100, lv)).toEqual([{ id: 'a', direction: 'down' }]);
    expect(crossings(100, 101, lv)).toEqual([]);
    expect(crossings(100, 99, lv)).toEqual([]);
  });
  it('no move, no first price and bad numbers fire nothing', () => {
    expect(crossings(100, 100, lv)).toEqual([]);
    expect(crossings(null, 120, lv)).toEqual([]);
    expect(crossings(95, NaN, lv)).toEqual([]);
    expect(crossings(NaN, 105, lv)).toEqual([]);
    expect(crossings(95, 99.99, lv)).toEqual([]);
  });
  it('a price that touches a level and turns back fires once on the touch', () => {
    expect(crossings(98, 100, lv)).toHaveLength(1);
    expect(crossings(100, 98, lv)).toHaveLength(0);
  });
});

describe('alert helpers', () => {
  it('snaps a price to the minimum move and the precision', () => {
    expect(snapPrice(101.2349, 0.01, 2)).toBe(101.23);
    expect(snapPrice(101.236, 0.05, 2)).toBe(101.25);
    expect(snapPrice(101.2, 1, 0)).toBe(101);
    expect(snapPrice(0.1 + 0.2, 0.01, 2)).toBe(0.3);
  });
  it('finds the nearest line within the tolerance', () => {
    const lines = [{ id: 'a', y: 100 }, { id: 'b', y: 108 }];
    expect(nearestLine(lines, 103, 5)).toBe('a');
    expect(nearestLine(lines, 105, 5)).toBe('b');
    expect(nearestLine(lines, 150, 5)).toBeNull();
    expect(nearestLine([], 1, 5)).toBeNull();
  });
  it('round-trips through JSON and rejects bad input with a named reason', () => {
    const alerts: PriceAlert[] = [{ id: 'a1', price: 101.5, triggered: false }, { id: 'a2', price: 99, triggered: true }];
    const text = alertsToJSON(alerts);
    expect(alertsFromJSON(text)).toEqual(alerts);
    expect(alertsFromJSON(JSON.parse(text))).toEqual(alerts);
    expect(() => alertsFromJSON('not json')).toThrow(/valid JSON/);
    expect(() => alertsFromJSON('{}')).toThrow(/format/);
    expect(() => alertsFromJSON({ format: 'chartist-lite-alerts', version: 2, alerts: [] })).toThrow(/version/);
    expect(() => alertsFromJSON({ format: 'chartist-lite-alerts', version: 1, alerts: [{ id: 'a', price: 'x' }] })).toThrow(/price/);
    expect(() => alertsFromJSON({ format: 'chartist-lite-alerts', version: 1, alerts: [{ id: 'a', price: 1 }, { id: 'a', price: 2 }] })).toThrow(/twice/);
    expect(() => alertsFromJSON({ format: 'chartist-lite-alerts', version: 1, alerts: [{ price: 1 }] })).toThrow(/id/);
  });
});

describe('compare maths', () => {
  it('percent change and rebase factor', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(90, 100)).toBeCloseTo(-10);
    expect(percentChange(5, 0)).toBeNaN();
    expect(percentChange(-5, -10)).toBeCloseTo(50);
    expect(rebaseFactor(200, 50)).toBe(4);
    expect(rebaseFactor(200, 0)).toBeNaN();
  });
  it('a rebased line reads the same percent on the base axis', () => {
    // Base starts at 200, the other at 50; the other doubles to 100. Scaled by 4 it sits at 400 = +100% of 200.
    const k = rebaseFactor(200, 50);
    expect(percentChange(100 * k, 200)).toBeCloseTo(100);
    expect(scaleRows([{ time: 1, value: 50 }, { time: 2, value: 100 }], k)).toEqual([{ time: 1, value: 200 }, { time: 2, value: 400 }]);
  });
  it('the reference is the first non-zero value at or after the first visible time', () => {
    const rows = [{ time: 1, value: 0 }, { time: 2, value: 0 }, { time: 3, value: 7 }, { time: 4, value: 9 }].map(r => ({ ...r, close: r.value }));
    expect(firstVisibleRef(rows, 1)).toBe(7);
    expect(firstVisibleRef(rows, 4)).toBe(9);
    expect(firstVisibleRef(rows, 5)).toBeNaN();
  });
  it('percent text carries sign and arrow, never a bare colour', () => {
    expect(percentText(12.345)).toBe('▲ +12.35%');
    expect(percentText(-4.1)).toBe('▼ −4.10%');
    expect(percentText(0)).toBe('0.00%');
    expect(percentText(0.001)).toBe('0.00%');
    expect(percentText(NaN)).toBe('');
  });
});

describe('replay timing', () => {
  it('releases at most one bar per frame', () => {
    let carry = 0;
    let steps = 0;
    for (let f = 0; f < 600; f++) { const t = tickReplay(carry, 16.7, 10); carry = t.carry; steps += t.steps; expect(t.steps).toBeLessThanOrEqual(1); }
    // 10 s of frames at 10x: about 100 bars at 800 ms / 10 = 80 ms each.
    expect(steps).toBeGreaterThan(110);
    expect(steps).toBeLessThan(135);
  });
  it('a long frame (hidden tab) never bursts', () => {
    const t = tickReplay(0, 60_000, 10);
    expect(t.steps).toBe(1);
    expect(t.carry).toBeLessThan(BASE_BAR_MS / 10);
  });
  it('1x waits a whole interval', () => {
    expect(tickReplay(0, 400, 1)).toEqual({ steps: 0, carry: 400 });
    expect(tickReplay(400, 400, 1).steps).toBe(1);
  });
  it('picks the start index and clamps steps', () => {
    const times = [10, 20, 30, 40];
    expect(startIndexAt(times, 25)).toBe(2);
    expect(startIndexAt(times, 20)).toBe(1);
    expect(startIndexAt(times, 5)).toBe(0);
    expect(startIndexAt(times, 99)).toBe(3);
    expect(startIndexAt([], 1)).toBeNull();
    expect(stepIndex(1, -5, 3)).toBe(0);
    expect(stepIndex(1, 5, 3)).toBe(3);
    expect(stepIndex(1, 1, 3)).toBe(2);
  });
});

describe('tooltip text', () => {
  it('describes a candle with the change from the previous close, a true minus and no grouping', () => {
    const row = { open: 1000.5, high: 1200, low: 990, close: 1100.25 };
    const prev = { open: 1, high: 2, low: 1, close: 1200.25 };
    const t = describeBar(row, prev, fmt);
    expect(t.kind).toBe('ohlc');
    expect(t.cells.map(c => `${c.label} ${c.value}`)).toEqual(['O 1000.50', 'H 1200.00', 'L 990.00', 'C 1100.25']);
    expect(t.change?.dir).toBe(-1);
    expect(t.change?.text).toBe('▼ −100.00 (−8.33%)');
    expect(t.cells.some(c => c.value.includes(','))).toBe(false);
  });
  it('the first candle changes from its own open; a value row from the previous value', () => {
    expect(describeBar({ open: 10, high: 12, low: 9, close: 11 }, null, fmt).change?.text).toBe('▲ +1.00 (+10.00%)');
    const v = describeBar({ value: 50 }, { value: 40 }, fmt);
    expect(v.kind).toBe('value');
    expect(v.value).toBe('50.00');
    expect(v.change?.text).toBe('▲ +10.00 (+25.00%)');
    expect(describeBar({ value: 50 }, null, fmt).change).toBeNull();
  });
  it('an unchanged price has no arrow or sign; no row, no text', () => {
    expect(describeChange(10, 10, fmt)?.text).toBe('0.00 (0.00%)');
    expect(describeChange(10, 0, fmt)).toBeNull();
    expect(describeBar(null, null, fmt).kind).toBe('none');
    expect(describeBar({ time: 1 }, null, fmt).kind).toBe('none');
  });
});

describe('tooltip placement', () => {
  const bounds = { w: 400, h: 300 };
  const size = { w: 120, h: 80 };
  it('follows the pointer right and below, flips at the right and bottom edges, stays inside', () => {
    expect(placeFloating({ x: 50, y: 50 }, size, bounds)).toEqual({ x: 64, y: 64 });
    expect(placeFloating({ x: 350, y: 50 }, size, bounds).x).toBe(350 - 14 - 120);
    expect(placeFloating({ x: 50, y: 280 }, size, bounds).y).toBe(280 - 14 - 80);
    const corner = placeFloating({ x: 395, y: 295 }, size, bounds);
    expect(corner.x + size.w).toBeLessThanOrEqual(bounds.w);
    expect(corner.y + size.h).toBeLessThanOrEqual(bounds.h);
    expect(placeFloating({ x: 2, y: 2 }, size, bounds).x).toBeGreaterThanOrEqual(0);
  });
  it('a finger puts the card above, flipping below at the top', () => {
    expect(placeFloating({ x: 100, y: 200 }, size, bounds, 28, true).y).toBe(200 - 28 - 80);
    expect(placeFloating({ x: 100, y: 20 }, size, bounds, 28, true).y).toBe(48);
  });
  it('pins over the bar, below when there is no room above, and stays in the plot', () => {
    const plot = { x: 40, width: 300, height: 260 };
    const above = placeTracking(200, 150, 190, size, plot);
    expect(above.below).toBe(false);
    expect(above.y).toBe(150 - 14 - 80);
    expect(above.x).toBe(200 - 60);
    const below = placeTracking(200, 30, 60, size, plot);
    expect(below.below).toBe(true);
    expect(below.y).toBe(74);
    expect(placeTracking(45, 150, 190, size, plot).x).toBe(44);
    expect(placeTracking(335, 150, 190, size, plot).x).toBe(40 + 300 - 120 - 4);
  });
});

describe('bands, session breaks, vertical line, watermark, realtime', () => {
  it('pairs two edges by time, keeping gaps as NaN', () => {
    const a = { t: Float64Array.from([1, 2, 4]), v: Float64Array.from([10, 11, 13]) };
    const b = { t: Float64Array.from([2, 3, 4]), v: Float64Array.from([5, NaN, 7]) };
    const p = pairEdges(a, b);
    expect([...p.t]).toEqual([1, 2, 3, 4]);
    expect([...p.up]).toEqual([10, 11, NaN, 13]);
    expect([...p.lo]).toEqual([NaN, 5, NaN, 7]);
    expect(bandExtent(p.up, p.lo, 0, 3)).toEqual({ min: 5, max: 13 });
    expect(bandExtent(p.up, p.lo, 0, 0)).toBeNull();
    expect(bandExtent(p.up, p.lo, 3, 99)).toEqual({ min: 7, max: 13 });
  });
  it('finds the first bar of each local day', () => {
    const days = [1, 1, 1, 2, 2, 3, 3, 3, 3, 4];
    expect(dayStarts(i => days[i], 0, 9)).toEqual([3, 5, 9]);
    expect(dayStarts(i => days[i], 4, 9)).toEqual([5, 9]);
    expect(dayStarts(i => days[i], 3, 3)).toEqual([]);
  });
  it('tells intraday from daily bars by the median gap', () => {
    expect(isIntraday([300, 300, 300, 3600 * 17])).toBe(true);
    expect(isIntraday([86400, 86400 * 3, 86400, 86400])).toBe(false);
    expect(isIntraday([])).toBe(false);
  });
  it('a chip goes right of the line, left of it near the edge', () => {
    expect(chipLeft(100, 60, 0, 400)).toBe(104);
    expect(chipLeft(380, 60, 0, 400)).toBe(380 - 4 - 60);
    expect(chipLeft(10, 600, 0, 400)).toBe(0);
  });
  it('places the watermark block and shrinks text to fit', () => {
    const pane = { width: 400, height: 200 };
    expect(placeBlock('center', 100, 50, pane)).toEqual({ x: 150, y: 75 });
    expect(placeBlock('top-left', 100, 50, pane)).toEqual({ x: 16, y: 16 });
    expect(placeBlock('bottom-right', 100, 50, pane)).toEqual({ x: 284, y: 134 });
    expect(fitFontSize(56, 300, 400)).toBe(56);
    expect(fitFontSize(56, 800, 400)).toBe(28);
    expect(fitFontSize(56, 99999, 400)).toBe(10);
  });
  it('the realtime button shows once the newest bar centre has left the plot', () => {
    expect(newestBarHidden(2)).toBe(false);
    expect(newestBarHidden(-0.5)).toBe(false);
    expect(newestBarHidden(-0.6)).toBe(true);
    expect(newestBarHidden(-40)).toBe(true);
  });
});

describe('radiogroup keys', () => {
  it('arrows wrap, Home and End jump, other keys do nothing', () => {
    expect(nextIndex('ArrowRight', 8, 9)).toBe(0);
    expect(nextIndex('ArrowLeft', 0, 9)).toBe(8);
    expect(nextIndex('ArrowDown', 2, 9)).toBe(3);
    expect(nextIndex('ArrowUp', 2, 9)).toBe(1);
    expect(nextIndex('Home', 5, 9)).toBe(0);
    expect(nextIndex('End', 5, 9)).toBe(8);
    expect(nextIndex('a', 5, 9)).toBe(-1);
  });
});

describe('contrast', () => {
  for (const [name, theme] of [['light', lightTheme], ['dark', darkTheme]] as const) {
    it(`${name}: alert accent is 4.5:1 text on the background`, () => {
      expect(contrastRatio(accentFor(theme), theme.background)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: series colours are 4.5:1 on the background (usable as text too)`, () => {
      for (const c of seriesPalette(theme)) expect(contrastRatio(c, theme.background)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: switcher labels are 4.5:1 on the track, selected label on the thumb`, () => {
      const c = switcherColors({ colors: theme, dark: name === 'dark' });
      expect(contrastRatio(c.label, c.track)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.selected, c.thumb)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: tooltip text and change colours are 4.5:1 on the card`, () => {
      for (const c of [theme.text, theme.mutedText, theme.upText, theme.downText]) expect(contrastRatio(c, theme.background)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('contrast ratio sanity', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
});
