// Range switcher: a capsule segmented control (one track, one sliding thumb, a radiogroup with roving focus) that sets
// the visible range by calendar span in the chart's time zone. Selection follows focus, as radio groups do: arrows move
// and select, Home / End jump. Panning or zooming away from the chosen span clears the selection. The range maths is
// pure (`range.ts`). Written to the DOM in a shadow root with CSSOM styles.

import type { ChartApi } from '../../api';
import type { Removable, UiState } from './common';
import { createHost, css, focusRing, make, mixColors, reducedMotion, removable, useChartUi, zoneOf } from './common';
import type { RangeKey, ResolvedRange } from './range';
import { RANGE_KEYS, resolveRange } from './range';

export interface RangeChange extends ResolvedRange { key: RangeKey }

export interface RangeSwitcherOptions {
  /** Default all nine: 1D 5D 1M 3M 6M YTD 1Y 5Y All. */
  ranges: readonly RangeKey[];
  /** Called when the user picks a range (not for `select()` made in code). */
  onChange?: (key: RangeKey, range: RangeChange) => void;
  /** Where it sits over the plot. Default 'bottom-left'. Ignored with `container`. */
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Mount it in your own element instead of over the chart. */
  container?: HTMLElement;
  /** Accessible name of the group. Default 'Visible range'. */
  label: string;
}

export interface RangeSwitcherHandle extends Removable {
  /** Show a range (like a user click without `onChange`); null clears the selection. */
  select(key: RangeKey | null): void;
  selected(): RangeKey | null;
  applyOptions(options: Partial<RangeSwitcherOptions>): void;
}

// Keys of 38 x 28 px for a mouse, 44 x 44 on a touch screen (pointer: coarse, read when the switcher is made).
const KEY_W = 38;
const KEY_H = 28;
const PAD = 2;

function checkRanges(r: readonly string[]): void {
  if (!Array.isArray(r) || r.length === 0) throw new TypeError('Chartist Lite: range switcher "ranges" needs at least one key');
  for (const k of r) if (!(RANGE_KEYS as readonly string[]).includes(k)) throw new TypeError(`Chartist Lite: unknown range "${k}"; use ${RANGE_KEYS.join(', ')}`);
  if (new Set(r).size !== r.length) throw new TypeError('Chartist Lite: range switcher "ranges" has a repeated key');
}

/** Index to focus after `key` in a group of `n` (wrapping), or -1 when the key moves nothing. Pure. */
export function nextIndex(key: string, index: number, n: number): number {
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': return (index + 1) % n;
    case 'ArrowLeft': case 'ArrowUp': return (index - 1 + n) % n;
    case 'Home': return 0;
    case 'End': return n - 1;
    default: return -1;
  }
}

/** Label, track, thumb and unselected-label colours for a theme, solid so they read over candles. */
export function switcherColors(ui: Pick<UiState, 'colors' | 'dark'>): { track: string; thumb: string; label: string; selected: string } {
  const c = ui.colors;
  const track = mixColors(c.background, c.text, ui.dark ? 0.14 : 0.07);
  const thumb = ui.dark ? mixColors(c.background, c.text, 0.28) : c.background;
  return { track, thumb, label: mixColors(c.text, track, 0.2), selected: c.text };
}

export function createRangeSwitcher(chart: ChartApi, options: Partial<RangeSwitcherOptions> = {}): RangeSwitcherHandle {
  let opts: RangeSwitcherOptions = { ranges: RANGE_KEYS, position: 'bottom-left', label: 'Visible range', ...options };
  checkRanges(opts.ranges);
  const ui = useChartUi(chart);
  const inline = !!opts.container;
  const dom = createHost(chart, 'range-switcher', true, 3, { parent: opts.container, inline });
  const doc = dom.doc;
  let big = false;
  try { big = !!doc.defaultView?.matchMedia?.('(pointer: coarse)').matches; } catch { /* no media queries */ }
  const ITEM_W = big ? 44 : KEY_W;
  const ITEM_H = big ? 44 : KEY_H;
  const group = make(doc, 'div', {
    position: inline ? 'relative' : 'absolute', left: '0', top: '0', display: 'flex', padding: `${PAD}px`, 'border-radius': '999px', 'pointer-events': 'auto',
    'flex-wrap': 'nowrap', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', 'max-width': '100%',
  }, dom.root);
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', opts.label);
  const inner = make(doc, 'div', { position: 'relative', display: 'flex', 'flex-shrink': '0' }, group);
  const thumb = make(doc, 'div', { position: 'absolute', left: '0', top: '0', width: `${ITEM_W}px`, height: `${ITEM_H}px`, 'border-radius': '999px', opacity: '0', 'pointer-events': 'none' }, inner);
  thumb.setAttribute('aria-hidden', 'true');

  let buttons: HTMLButtonElement[] = [];
  let selected: RangeKey | null = null;
  /** Bars between the last bar and the right edge, and the width in bars, of the view the last selection made. */
  let expected: { sp: number; width: number } | null = null;
  let styleKey = '';

  const paint = (): void => {
    const s = ui.state();
    const col = switcherColors(s);
    const k = `${col.track}|${col.thumb}|${selected}|${opts.position}|${s.plot.x}|${s.plot.y}|${s.plot.width}|${s.plot.height}`;
    if (k === styleKey) return;
    styleKey = k;
    css(group, { background: col.track, ...(inline ? {} : { 'max-width': `${Math.max(120, Math.floor(s.plot.width - 16))}px` }) });
    css(thumb, {
      background: col.thumb, 'box-shadow': s.dark ? '0 1px 3px rgba(0,0,0,0.5)' : '0 1px 3px rgba(0,0,0,0.2), 0 0 0 0.5px rgba(0,0,0,0.04)',
    });
    buttons.forEach((b, i) => {
      const on = opts.ranges[i] === selected;
      css(b, { color: on ? col.selected : col.label, 'font-weight': on ? '600' : '500' });
    });
    if (!inline) {
      const w = group.offsetWidth || opts.ranges.length * ITEM_W + PAD * 2;
      const h = ITEM_H + PAD * 2;
      const m = 8;
      const x = opts.position.endsWith('right') ? s.plot.x + s.plot.width - w - m : s.plot.x + m;
      const y = opts.position.startsWith('top') ? s.plot.y + m : s.plot.y + s.plot.height - h - m;
      css(group, { transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` });
    }
  };

  const moveThumb = (animate: boolean): void => {
    const i = selected === null ? -1 : opts.ranges.indexOf(selected);
    css(thumb, {
      opacity: i < 0 ? '0' : '1', transform: `translateX(${Math.max(0, i) * ITEM_W}px)`,
      transition: animate && !reducedMotion(chart) ? 'transform 180ms cubic-bezier(0.3, 0.7, 0.2, 1), opacity 120ms' : 'none',
    });
    buttons.forEach((b, j) => {
      b.setAttribute('aria-checked', String(j === i));
      b.tabIndex = i < 0 ? (j === 0 ? 0 : -1) : (j === i ? 0 : -1);
    });
    styleKey = '';
    paint();
  };

  const build = (): void => {
    for (const b of buttons) b.remove();
    buttons = opts.ranges.map((key, i) => {
      const b = make(doc, 'button', {
        position: 'relative', width: `${ITEM_W}px`, height: `${ITEM_H}px`, 'border-radius': '999px', cursor: 'pointer', appearance: 'none', '-webkit-appearance': 'none',
        font: `500 12px/${ITEM_H}px ${ui.state().fontFamily}`, 'text-align': 'center', 'font-variant-numeric': 'tabular-nums', 'flex-shrink': '0', 'touch-action': 'manipulation',
        'user-select': 'none', '-webkit-user-select': 'none',
      }, inner) as HTMLButtonElement;
      b.type = 'button';
      b.textContent = key;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      focusRing(b, () => ui.state().colors.focusRing);
      b.addEventListener('click', () => choose(i, true));
      b.addEventListener('keydown', e => {
        const next = nextIndex(e.key, i, opts.ranges.length);
        if (next < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        buttons[next].focus();
        choose(next, true);
      });
      return b;
    });
    moveThumb(false);
  };

  /** Make the chart show `key`. Returns the resolved range, or null when the chart has no data or size yet. */
  const apply = (key: RangeKey): RangeChange | null => {
    const ts = chart.timeScale();
    const vr = ts.getVisibleLogicalRange();
    if (!vr) return null;
    const lastLogical = vr.to - ts.scrollPosition();
    const firstTime = ts.logicalToTime(0);
    const lastTime = ts.logicalToTime(lastLogical);
    if (firstTime === null || lastTime === null) return null;
    const visible = ts.getVisibleRange();
    const businessDay = visible ? typeof visible.to !== 'number' : lastTime % 86_400 === 0 && firstTime % 86_400 === 0;
    const r = resolveRange(key, firstTime, lastTime, zoneOf(chart), businessDay);
    // The view itself comes from the core (one source of truth for spans: 'nD' are the last n sessions there).
    if (key === 'All') ts.fitContent(); else ts.setVisibleSpan(key);
    const after = ts.getVisibleLogicalRange();
    if (after) expected = { sp: ts.scrollPosition(), width: after.to - after.from };
    return { key, ...r };
  };

  const choose = (i: number, user: boolean): void => {
    const key = opts.ranges[i];
    const res = apply(key);
    if (!res) return;
    selected = key;
    moveThumb(true);
    if (user) opts.onChange?.(key, res);
  };

  const onFrame = (): void => {
    if (selected !== null && expected) {
      const ts = chart.timeScale();
      const vr = ts.getVisibleLogicalRange();
      if (vr && (Math.abs(ts.scrollPosition() - expected.sp) > 0.75 || Math.abs(vr.to - vr.from - expected.width) > 1.5)) {
        selected = null;
        expected = null;
        moveThumb(true);
      }
    }
    paint();
  };
  const off = ui.onFrame(onFrame);
  build();

  return removable({
    select(key: RangeKey | null) {
      if (key === null) { selected = null; expected = null; moveThumb(true); return; }
      const i = opts.ranges.indexOf(key);
      if (i < 0) throw new TypeError(`Chartist Lite: range "${key}" is not in this switcher`);
      choose(i, false);
    },
    selected: () => selected,
    applyOptions(patch: Partial<RangeSwitcherOptions>) {
      if (patch.ranges) checkRanges(patch.ranges);
      opts = { ...opts, ...patch };
      group.setAttribute('aria-label', opts.label);
      if (patch.ranges) { if (selected && !opts.ranges.includes(selected)) selected = null; build(); }
      styleKey = '';
      paint();
    },
  }, () => { off(); dom.destroy(); ui.release(); });
}

