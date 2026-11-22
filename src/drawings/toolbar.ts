// The optional drawing toolbar: one rail of grouped icon buttons (cursor; then one button per group of the tools on
// offer: lines, channels and pitchforks, Fibonacci and Gann, shapes, measure and analysis, positions, annotate | keep
// drawing, magnet, hide | undo, redo, delete all), each multi-tool group a button with a flyout menu, a floating style
// bar for the selected drawing, and the text-note editor. DOM in a shadow root, every style a CSSOM write with the same
// important resets as the legend (CSP-safe, page CSS cannot reach it), themed from the chart's colours. Icons are our
// own single-colour line drawings on a 24 grid (1.8 stroke, round caps), each tool's from its definition. Flyouts, the
// style bar and the editor are kept inside the chart box: a flyout opens beside its button, up when there is no room
// below, and scrolls inside itself when the chart is short; under a width threshold the style bar collapses to colour,
// a "more" panel and delete.

import type { ChartApi } from '../api';
import type { ThemeColors } from '../core/theme';
import { lightTheme } from '../core/theme';
import { css, cssReset } from '../render/dom';
import type { Pt } from './geometry';
import type { DrawingToolsController, DrawingToolsUi } from './controller';
import type { Drawing, ToolDefinition, ToolId } from './contract';
import { groupsFor, keysFor, type ToolGroup } from './engine';
import { BASIC_TOOLS } from './tools/basic';

const SVG = 'http://www.w3.org/2000/svg';
/** The chart's inset: the rail keeps this far from the pane edge and from the legend. */
const INSET = 6;
const SIZE = 28;
const GAP = 4;
const PAD = 6;
const HOLD_MS = 350;

/**
 * 24-grid line icons of the toolbar itself, one idea each, recognisable at 20 px without a tooltip. Each tool's icon is
 * in its definition (`ToolDefinition.icon`); `ICONS` keeps the toolbar's own and, for code that read them here, the
 * basic tools' (from the definitions).
 */
const UI_ICONS: Readonly<Record<string, string>> = {
  cursor: 'M7 4.5l10.5 9.8-4.7.7-2.5 4.3z',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  keep: 'M7.5 11V8a4.5 4.5 0 0 1 9 0v3M6 11h12v9H6zM12 14.5v2',
  magnet: 'M6 4.5v7.5a6 6 0 0 0 12 0V4.5h-4V12a2 2 0 0 1-4 0V4.5zM6 8.5h4M14 8.5h4',
  hide: 'M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10.5 11v5M13.5 11v5',
  undo: 'M9 5.5L4 10.5l5 5M4 10.5h10.5a5 5 0 0 1 0 10H12',
  redo: 'M15 5.5l5 5-5 5M20 10.5H9.5a5 5 0 0 0 0 10H12',
  dash: 'M3 12h4M10 12h4M17 12h4',
  solid: 'M3 12h18',
};

export const ICONS: Readonly<Record<string, string>> = { ...Object.fromEntries(BASIC_TOOLS.map(t => [t.id, t.icon])), ...UI_ICONS };

function icon(doc: Document, d: string, px = 24): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

/** Swatch colours for the style bar, per theme (no purple): line blue, green, red, orange, ink. */
function swatches(c: Readonly<ThemeColors>): string[] {
  return [c.line, c.up, c.down, isDark(c.background) ? '#FF9F0A' : '#C93400', c.text];
}

function isDark(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 128;
}

/** Tooltip text of a tool: its name and its key. */
export function toolTitle(id: ToolId, defs: readonly ToolDefinition[] = BASIC_TOOLS): string {
  const info = defs.find(t => t.id === id);
  const key = info?.key;
  return `${info ? info.label : id}${key ? ` (${key})` : ''}`;
}

type Kind = 'cursor' | 'group' | 'keep' | 'magnet' | 'hide' | 'undo' | 'redo' | 'clear';
interface Btn { el: HTMLButtonElement; kind: Kind; group?: ToolGroup; mark?: HTMLElement }

/**
 * Where a flyout goes inside the chart box (all in chart px): beside a vertical rail's button (else below a horizontal
 * one); moved up so it ends inside the box, flipped to the other side when there is no room, and given a smaller height
 * (it scrolls) when the chart is shorter than the list. Width never exceeds the box.
 */
export function placeFlyout(button: { left: number; top: number; right: number; bottom: number }, chartBox: { width: number; height: number }, want: { width: number; height: number }, vertical: boolean): { left: number; top: number; width: number; height: number } {
  const M = 4;
  const width = Math.max(0, Math.min(want.width, chartBox.width - 2 * M));
  const height = Math.max(0, Math.min(want.height, chartBox.height - 2 * M));
  let left: number, top: number;
  if (vertical) {
    left = button.right + 6;
    if (left + width > chartBox.width - M) left = button.left - 6 - width; // flip to the left of the button
    // No room either side: overlap, inside the box; a button left of the chart (a host's left bar): at the chart's edge.
    if (left < M) left = button.right < M ? M : Math.max(M, chartBox.width - M - width);
    top = button.top - 4;
    if (top + height > chartBox.height - M) top = chartBox.height - M - height; // open upwards
  } else {
    left = Math.min(button.left, chartBox.width - M - width);
    top = button.bottom + 6;
    if (top + height > chartBox.height - M) top = button.top - 6 - height; // above the button
    if (top < M) top = Math.max(M, chartBox.height - M - height);
  }
  // A button outside the chart (a rail mounted in the host's own bar): the flyout still opens over the chart.
  left = Math.min(left, chartBox.width - M - width);
  top = Math.min(top, chartBox.height - M - height);
  return { left: Math.max(M, left), top: Math.max(M, top), width, height };
}

/** Where the toolbar goes: inside the chart (default), or a host's own containers (see `DrawingToolsOptions.toolbar`). */
export interface ToolbarMount {
  /** The host's element for the rail (its left chrome bar, a bottom sheet); the rail fills it and scrolls inside it. */
  container?: HTMLElement;
  /** 'rail' (a column) or 'bar' (a row), for a rail in `container`. */
  variant?: 'rail' | 'bar';
  /** The host's element for the style bar of the selected drawing; default: floating over the chart. */
  styleContainer?: HTMLElement;
}

/** A shadow host for toolbar parts placed in a host's element (CSSOM styles, page CSS cannot reach them). */
type El = HTMLElement;
type Mounted = { host: El; shadow: ShadowRoot | El };
function mountHost(doc: Document, parent: El, fill: boolean): Mounted {
  const host = doc.createElement('div');
  host.setAttribute('data-chartist-drawing-ui', 'mounted');
  cssReset(host, fill ? { display: 'block', position: 'relative', width: '100%', height: '100%', 'min-width': '0', 'min-height': '0', overflow: 'hidden' } : { display: 'block', position: 'relative' });
  let shadow: ShadowRoot | HTMLElement = host;
  try { shadow = host.attachShadow({ mode: 'open' }); } catch { shadow = host; }
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'dblclick', 'keydown']) host.addEventListener(t, ev => ev.stopPropagation());
  parent.appendChild(host);
  return { host, shadow };
}

export function createToolbar(chart: ChartApi, ctl: DrawingToolsController, position: 'left' | 'top', mount: ToolbarMount = {}): DrawingToolsUi {
  const defs = ctl.tools();
  const byId = new Map(defs.map(t => [t.id, t]));
  const TOOL_GROUPS = groupsFor(defs);
  const TOOL_KEYS = keysFor(defs);
  const toolInfo = (id: ToolId): ToolDefinition | undefined => byId.get(id);
  const title = (id: ToolId): string => toolTitle(id, defs);
  const root = chart.element();
  const doc = root.ownerDocument;
  /** A toolbar icon or a tool's icon, by name. */
  const ic = (name: string, px?: number): SVGSVGElement => icon(doc, byId.get(name)?.icon ?? UI_ICONS[name] ?? '', px);
  const win = doc.defaultView;
  const coarse = (): boolean => { try { return !!win?.matchMedia?.('(pointer: coarse)').matches; } catch { return false; } };
  const external = !!mount.container;
  const vertical = external ? mount.variant !== 'bar' : position === 'left';

  const host = doc.createElement('div');
  host.setAttribute('data-chartist-drawing-ui', '');
  cssReset(host, { position: 'absolute', 'z-index': '3', display: 'block', left: '0', top: '0', width: '0', height: '0' });
  let shadow: ShadowRoot | HTMLElement = host;
  try { shadow = host.attachShadow({ mode: 'open' }); } catch { shadow = host; }
  // The chart must not pan, zoom or take keys for what happens on the toolbar.
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'dblclick', 'keydown']) host.addEventListener(t, ev => ev.stopPropagation());
  root.appendChild(host);

  const rail = doc.createElement('div');
  rail.setAttribute('role', 'toolbar');
  rail.setAttribute('aria-label', 'Drawing tools');
  rail.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
  const railMount = mount.container ? mountHost(doc, mount.container, true) : null;
  const styleMount = mount.styleContainer ? mountHost(doc, mount.styleContainer, false) : null;
  (railMount ? railMount.shadow : shadow).appendChild(rail);

  const buttons: Btn[] = [];
  const seps: HTMLElement[] = [];
  let confirmClear = false;
  /** Last tool used in each group: what its rail button shows and arms. */
  const current = new Map<string, ToolId>(TOOL_GROUPS.map(g => [g.id, g.tools[0]]));

  function colors(): Readonly<ThemeColors> { return ctl.colors() ?? lightTheme; }

  function focusRing(el: HTMLElement): void {
    let v = false;
    try { v = el.matches(':focus-visible'); } catch { v = false; }
    css(el, { 'box-shadow': v ? `0 0 0 2px ${colors().focusRing}` : 'none' });
  }

  function button(kind: Kind, label: string, iconName: string, onClick: (ev: MouseEvent) => void, group?: ToolGroup): Btn {
    const el = doc.createElement('button');
    el.type = 'button';
    el.setAttribute('aria-label', label);
    el.title = label;
    el.tabIndex = -1;
    el.appendChild(ic(iconName));
    el.addEventListener('click', ev => { if (kind !== 'clear') confirmClear = false; onClick(ev); sync(); });
    el.addEventListener('pointerdown', () => css(el, { transform: 'scale(0.97)' }));
    const release = (): void => css(el, { transform: 'none' });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointerleave', () => { release(); hover(el, false); });
    el.addEventListener('pointerenter', () => hover(el, true));
    el.addEventListener('focus', () => focusRing(el));
    el.addEventListener('blur', () => { focusRing(el); if (kind === 'clear' && confirmClear) { confirmClear = false; sync(); } });
    const b: Btn = { el, kind, group };
    buttons.push(b);
    rail.appendChild(el);
    return b;
  }

  function sep(apart = false): void {
    const d = doc.createElement('div');
    d.setAttribute('role', 'separator');
    (d as HTMLElement & { _apart?: boolean })._apart = apart;
    rail.appendChild(d);
    seps.push(d);
  }

  function hover(el: HTMLElement, on: boolean): void {
    if (el.getAttribute('aria-pressed') === 'true') return;
    css(el, { background: on ? colors().grid : 'transparent' });
  }

  // ── rail ──
  button('cursor', 'Cursor (Escape)', 'cursor', () => ctl.setTool(null));
  for (const g of TOOL_GROUPS) {
    const b = button('group', g.label, current.get(g.id) as string, ev => {
      if (suppressClick) { suppressClick = false; return; }
      // The corner mark opens the flyout; the rest of the button arms the group's current tool.
      const r = b.el.getBoundingClientRect();
      if (g.tools.length > 1 && ev.clientX > r.right - 10 && ev.clientY > r.bottom - 10) { openMenu(b, false); return; }
      const t = current.get(g.id) as ToolId;
      ctl.setTool(ctl.tool() === t ? null : t);
    }, g);
    if (g.tools.length > 1) {
      b.el.setAttribute('aria-haspopup', 'menu');
      b.el.setAttribute('aria-expanded', 'false');
      // The corner mark: a small filled triangle at the bottom right (the group has more tools).
      const mark = doc.createElementNS(SVG, 'svg');
      mark.setAttribute('viewBox', '0 0 4 4');
      mark.setAttribute('width', '4');
      mark.setAttribute('height', '4');
      mark.setAttribute('aria-hidden', 'true');
      const tri = doc.createElementNS(SVG, 'path');
      tri.setAttribute('d', 'M4 0V4H0z');
      tri.setAttribute('fill', 'currentColor');
      mark.appendChild(tri);
      b.el.appendChild(mark);
      b.mark = mark as unknown as HTMLElement;
      // Press and hold opens the flyout.
      let holdTimer: ReturnType<typeof setTimeout> | null = null;
      const cancel = (): void => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
      b.el.addEventListener('pointerdown', () => { cancel(); holdTimer = setTimeout(() => { holdTimer = null; suppressClick = true; openMenu(b, false); }, HOLD_MS); });
      b.el.addEventListener('pointerup', cancel);
      b.el.addEventListener('pointerleave', cancel);
      b.el.addEventListener('pointercancel', cancel);
    }
  }
  sep();
  button('keep', 'Keep drawing', 'keep', () => ctl.setKeepDrawing(!ctl.keepDrawing()));
  button('magnet', 'Magnet: snap to open, high, low, close', 'magnet', () => ctl.setMagnet(!ctl.magnet()));
  button('hide', 'Hide drawings', 'hide', () => ctl.setHidden(!ctl.hidden()));
  sep(true);
  button('undo', 'Undo (ctrl or cmd + Z)', 'undo', () => ctl.undo());
  button('redo', 'Redo (ctrl or cmd + shift + Z)', 'redo', () => ctl.redo());
  button('clear', 'Delete all drawings', 'trash', () => {
    if (!ctl.drawings().length) return;
    if (confirmClear) { confirmClear = false; ctl.clear(); } else confirmClear = true;
  });
  let suppressClick = false;

  // Edge fades while the rail scrolls inside itself (a short pane): a mask, not a colour.
  rail.addEventListener('scroll', () => fades());
  function fades(): void {
    const start = vertical ? rail.scrollTop : rail.scrollLeft;
    const len = vertical ? rail.scrollHeight - rail.clientHeight : rail.scrollWidth - rail.clientWidth;
    const dir = vertical ? 'to bottom' : 'to right';
    const a = start > 1 ? 'transparent' : '#000';
    const b = start < len - 1 ? 'transparent' : '#000';
    const mask = len > 1 ? `linear-gradient(${dir}, ${a}, #000 18px, #000 calc(100% - 18px), ${b})` : 'none';
    css(rail, { 'mask-image': mask, '-webkit-mask-image': mask });
  }

  // Roving tab index: one stop for the rail; arrows move along it; the cross arrow opens a group's flyout.
  let focusAt = 0;
  rail.addEventListener('keydown', ev => {
    const k = ev.key;
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
    const open = vertical ? 'ArrowRight' : 'ArrowDown';
    let i = focusAt;
    const b = buttons[focusAt];
    if (k === open && b && b.group && b.group.tools.length > 1) { ev.preventDefault(); openMenu(b, true); return; }
    if (k === next) i = (focusAt + 1) % buttons.length;
    else if (k === prev) i = (focusAt - 1 + buttons.length) % buttons.length;
    else if (k === 'Home') i = 0;
    else if (k === 'End') i = buttons.length - 1;
    else if (k === 'Escape') { ctl.setTool(null); root.focus(); ev.preventDefault(); return; }
    else return;
    ev.preventDefault();
    focusAt = i;
    sync();
    buttons[i].el.focus();
  });
  rail.addEventListener('focusin', ev => {
    const i = buttons.findIndex(x => x.el === ev.target);
    if (i >= 0 && i !== focusAt) { focusAt = i; sync(); }
  });

  // ── flyout menu ──
  const menu = doc.createElement('div');
  menu.setAttribute('role', 'menu');
  shadow.appendChild(menu);
  let menuFor: Btn | null = null;

  function closeMenu(returnFocus: boolean): void {
    if (!menuFor) return;
    const b = menuFor;
    menuFor = null;
    b.el.setAttribute('aria-expanded', 'false');
    cssReset(menu, { display: 'none' });
    menu.textContent = '';
    if (returnFocus) b.el.focus();
  }

  function openMenu(b: Btn, byKeyboard: boolean): void {
    const g = b.group;
    if (!g) return;
    if (menuFor === b) { closeMenu(true); return; }
    closeMenu(false);
    menuFor = b;
    b.el.setAttribute('aria-expanded', 'true');
    menu.setAttribute('aria-label', g.label);
    menu.textContent = '';
    const c = colors();
    const items: HTMLElement[] = [];
    for (const t of g.tools) {
      const row = doc.createElement('div');
      row.setAttribute('role', 'menuitemradio');
      const on = ctl.tool() === t || (ctl.tool() === null && current.get(g.id) === t);
      row.setAttribute('aria-checked', String(ctl.tool() === t));
      row.tabIndex = -1;
      const glyph = ic(t, 20);
      const name = doc.createElement('span');
      name.textContent = toolInfo(t)?.label ?? t;
      const key = doc.createElement('span');
      key.textContent = TOOL_KEYS[t] ?? '';
      cssReset(glyph as unknown as HTMLElement, { display: 'block', 'flex-shrink': '0' });
      cssReset(name, { display: 'block', 'flex-grow': '1', 'white-space': 'nowrap', color: 'inherit', font: 'inherit' });
      cssReset(key, { display: 'block', color: ctl.tool() === t ? 'inherit' : c.mutedText, font: 'inherit', 'min-width': '12px', 'text-align': 'right', 'font-variant-numeric': 'tabular-nums' });
      row.append(glyph, name, key);
      const pick = (): void => { current.set(g.id, t); closeMenu(true); ctl.setTool(t); swapIcon(b); sync(); };
      row.addEventListener('click', pick);
      row.addEventListener('keydown', ev => {
        const i = items.indexOf(row);
        if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        else if (ev.key === 'Home') { ev.preventDefault(); items[0].focus(); }
        else if (ev.key === 'End') { ev.preventDefault(); items[items.length - 1].focus(); }
        else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); }
        else if (ev.key === 'Escape' || (vertical ? ev.key === 'ArrowLeft' : false)) { ev.preventDefault(); closeMenu(true); }
        else if (ev.key === 'Tab') closeMenu(false);
      });
      row.addEventListener('pointerenter', () => { if (row.getAttribute('aria-checked') !== 'true') css(row, { background: c.grid }); });
      row.addEventListener('pointerleave', () => { if (row.getAttribute('aria-checked') !== 'true') css(row, { background: 'transparent' }); });
      row.addEventListener('focus', () => focusRing(row));
      row.addEventListener('blur', () => focusRing(row));
      const checked = ctl.tool() === t;
      cssReset(row, {
        display: 'flex', 'align-items': 'center', gap: '10px', height: `${coarse() ? 44 : 32}px`, padding: '0 10px', 'border-radius': '8px',
        background: checked ? c.text : 'transparent', color: checked ? c.background : c.text, cursor: 'pointer', outline: 'none',
      });
      items.push(row);
      menu.appendChild(row);
      void on;
    }
    const r = b.el.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const rowH = coarse() ? 44 : 32;
    cssReset(menu, {
      position: 'absolute', display: 'flex', 'flex-direction': 'column', gap: '2px', padding: '4px', 'min-width': '0',
      background: c.background, border: `1px solid ${c.paneSeparator}`, 'border-radius': '12px', color: c.text,
      font: `400 13px ${chart.options().fontFamily}`, 'pointer-events': 'auto', 'z-index': '4', 'box-sizing': 'border-box',
      'overflow-y': 'auto', 'overflow-x': 'hidden', 'scrollbar-width': 'thin', visibility: 'hidden', left: '0', top: '0',
    });
    const box = placeFlyout(
      { left: r.left - rr.left, top: r.top - rr.top, right: r.right - rr.left, bottom: r.bottom - rr.top },
      { width: rr.width, height: rr.height },
      { width: Math.max(200, menu.scrollWidth + 2), height: g.tools.length * (rowH + 2) + 8 },
      vertical,
    );
    css(menu, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, 'max-height': `${box.height}px`, visibility: 'visible' });
    const start = items[Math.max(0, g.tools.indexOf(current.get(g.id) as ToolId))];
    if (byKeyboard) start.focus();
  }

  function swapIcon(b: Btn): void {
    if (!b.group) return;
    const t = current.get(b.group.id) as ToolId;
    const old = b.el.querySelector('svg');
    if (old) old.replaceWith(ic(t));
  }

  // Close the flyout on any press elsewhere in the chart.
  const outside = (ev: Event): void => {
    const path = ev.composedPath();
    if (panelOpen && !path.includes(panel) && !path.includes(bar)) { panelOpen = false; sync(); }
    if (!menuFor) return;
    if (path.includes(menu) || path.includes(menuFor.el)) return;
    closeMenu(false);
  };
  doc.addEventListener('pointerdown', outside, true);

  // ── style bar for the selected drawing ──
  const bar = doc.createElement('div');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Drawing style');
  (styleMount ? styleMount.shadow : shadow).appendChild(bar);
  const swatchEls: HTMLButtonElement[] = [];
  for (let i = 0; i < 5; i++) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { const sel = ctl.selected(); if (sel) ctl.update(sel.id, { style: { color: (b as HTMLButtonElement & { _c?: string })._c } }); sync(); });
    swatchEls.push(b);
    bar.appendChild(b);
  }
  const widthEls: HTMLButtonElement[] = [];
  for (const w of [1, 2, 3] as const) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `Line width ${w}`);
    b.title = `Line width ${w}`;
    const svg = ic('solid', 20);
    svg.setAttribute('stroke-width', String(w * 1.2));
    b.appendChild(svg);
    b.addEventListener('click', () => { const sel = ctl.selected(); if (sel) ctl.update(sel.id, { style: { width: w } }); sync(); });
    widthEls.push(b);
    bar.appendChild(b);
  }
  const dashEl = doc.createElement('button');
  dashEl.type = 'button';
  dashEl.setAttribute('aria-label', 'Dashed line');
  dashEl.title = 'Dashed line';
  dashEl.appendChild(ic('dash', 20));
  dashEl.addEventListener('click', () => { const sel = ctl.selected(); if (sel) ctl.update(sel.id, { style: { dash: sel.style.dash === 'dashed' ? 'solid' : 'dashed' } }); sync(); });
  bar.appendChild(dashEl);
  const delEl = doc.createElement('button');
  delEl.type = 'button';
  delEl.setAttribute('aria-label', 'Delete drawing');
  delEl.title = 'Delete drawing';
  delEl.appendChild(ic('trash', 20));
  delEl.addEventListener('click', () => { const sel = ctl.selected(); if (sel) ctl.remove(sel.id); sync(); });
  bar.appendChild(delEl);
  // Compact form (narrow charts): the current colour and "more" open one panel with every option; delete stays.
  const colorEl = doc.createElement('button');
  colorEl.type = 'button';
  colorEl.setAttribute('aria-label', 'Colour, width and dash');
  colorEl.title = 'Colour, width and dash';
  colorEl.setAttribute('aria-haspopup', 'true');
  const moreEl = doc.createElement('button');
  moreEl.type = 'button';
  moreEl.setAttribute('aria-label', 'More style options');
  moreEl.title = 'More style options';
  moreEl.setAttribute('aria-haspopup', 'true');
  moreEl.appendChild(ic('more', 20));
  const panel = doc.createElement('div');
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Drawing style options');
  shadow.appendChild(panel);
  let panelOpen = false;
  let compact = false;
  const togglePanel = (): void => { panelOpen = !panelOpen; sync(); };
  colorEl.addEventListener('click', togglePanel);
  moreEl.addEventListener('click', togglePanel);
  for (const b of [...swatchEls, ...widthEls, dashEl, delEl, colorEl, moreEl]) {
    b.addEventListener('focus', () => focusRing(b));
    b.addEventListener('blur', () => focusRing(b));
  }
  /** Put the options in the bar (wide) or in the panel (compact); only when the form changes. */
  function arrange(next: boolean): void {
    if (next === compact && bar.childElementCount) return;
    compact = next;
    bar.textContent = '';
    panel.textContent = '';
    if (compact) { bar.append(colorEl, moreEl, delEl); panel.append(...swatchEls, ...widthEls, dashEl); }
    else { bar.append(...swatchEls, ...widthEls, dashEl, delEl); panelOpen = false; }
  }

  // ── text editor ──
  let editor: HTMLInputElement | null = null;

  function plotLeft(): number { return chart.priceScale('left').width(); }
  function paneTop(pane: number): number {
    const panes = chart.panes();
    let y = 0;
    for (let i = 0; i < pane && i < panes.length; i++) y += panes[i].getHeight() + 1;
    return y;
  }

  /** Bottom of the legend box of the top pane (relative to the chart), or 0 when there is none. */
  function legendBottom(): number {
    const lg = root.querySelector('[data-chartist-legend]') as HTMLElement | null;
    if (!lg || lg.getClientRects().length === 0) return 0;
    const r = lg.getBoundingClientRect();
    return r.height > 0 ? r.bottom - root.getBoundingClientRect().top : 0;
  }

  function sync(): void {
    const c = colors();
    const size = coarse() ? 44 : SIZE;
    const font = `500 12px ${chart.options().fontFamily}`;
    const p0h = chart.panes()[0]?.getHeight() ?? 0;
    const top = Math.max(INSET, legendBottom() + INSET);
    const maxLen = vertical ? p0h - top - INSET : chart.timeScale().width() - 2 * INSET;
    if (external) {
      // In the host's bar: the bar is the surface (no card look); the rail fills it and scrolls inside it.
      cssReset(rail, {
        position: 'absolute', left: '0', top: '0', right: '0', bottom: '0', display: 'flex', 'flex-direction': vertical ? 'column' : 'row',
        'align-items': 'center', 'justify-content': 'flex-start', gap: `${GAP}px`, padding: `${PAD}px`, background: 'transparent', border: '0',
        'border-radius': '0', 'box-shadow': 'none', [vertical ? 'overflow-y' : 'overflow-x']: 'auto', [vertical ? 'overflow-x' : 'overflow-y']: 'hidden',
        'scrollbar-width': 'none', 'pointer-events': 'auto', 'box-sizing': 'border-box',
      });
    } else cssReset(rail, {
      position: 'absolute', display: 'flex', 'flex-direction': vertical ? 'column' : 'row', 'align-items': 'center', gap: `${GAP}px`,
      padding: `${PAD}px`, background: c.background, border: `1px solid ${c.paneSeparator}`,
      // Concentric with the buttons: the button radius plus the padding.
      'border-radius': `${size / 2 + PAD}px`,
      left: `${plotLeft() + INSET}px`, top: `${top}px`,
      [vertical ? 'max-height' : 'max-width']: `${Math.max(size + 2 * PAD, maxLen)}px`,
      [vertical ? 'overflow-y' : 'overflow-x']: 'auto', [vertical ? 'overflow-x' : 'overflow-y']: 'hidden',
      'scrollbar-width': 'none', 'pointer-events': 'auto', 'box-sizing': 'border-box',
    });
    for (const s of seps) {
      const apart = (s as HTMLElement & { _apart?: boolean })._apart;
      cssReset(s, {
        display: 'block', 'flex-shrink': '0', background: c.paneSeparator,
        // In a host's bar: the length of a chrome separator (16 px), even space on both sides.
        [vertical ? 'width' : 'height']: `${external ? 16 : size - 8}px`, [vertical ? 'height' : 'width']: '1px',
        margin: vertical ? `${external ? 4 : apart ? 6 : 2}px 0` : `0 ${external ? 4 : apart ? 6 : 2}px`,
      });
    }
    buttons.forEach((b, i) => {
      let pressed: boolean | null = null;
      if (b.kind === 'cursor') pressed = ctl.tool() === null;
      else if (b.kind === 'group' && b.group) {
        const t = ctl.tool();
        pressed = t !== null && b.group.tools.includes(t);
        if (pressed && t && current.get(b.group.id) !== t) { current.set(b.group.id, t); swapIcon(b); }
        const cur = current.get(b.group.id) as ToolId;
        const label = b.group.tools.length > 1 ? `${b.group.label}: ${title(cur)}. Hold, or press the arrow away from the rail, for more` : title(cur);
        b.el.setAttribute('aria-label', label);
        b.el.title = b.group.tools.length > 1 ? `${title(cur)}. Hold for more ${b.group.label.toLowerCase()}` : title(cur);
      } else if (b.kind === 'keep') pressed = ctl.keepDrawing();
      else if (b.kind === 'magnet') pressed = ctl.magnet();
      else if (b.kind === 'hide') pressed = ctl.hidden();
      const disabled = (b.kind === 'undo' && !ctl.canUndo()) || (b.kind === 'redo' && !ctl.canRedo()) || (b.kind === 'clear' && !ctl.drawings().length);
      if (pressed === null) b.el.removeAttribute('aria-pressed'); else b.el.setAttribute('aria-pressed', String(pressed));
      b.el.disabled = disabled;
      b.el.tabIndex = i === focusAt ? 0 : -1;
      const danger = b.kind === 'clear' && confirmClear;
      if (b.kind === 'clear') { const l = danger ? 'Click again to delete all drawings' : 'Delete all drawings'; b.el.setAttribute('aria-label', l); b.el.title = l; }
      // Selected = inverted ink (the house rule); the rest in full ink, disabled at 35%.
      cssReset(b.el, {
        position: 'relative', display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center',
        width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, 'flex-shrink': '0',
        background: pressed ? c.text : danger ? c.grid : 'transparent', color: pressed ? c.background : danger ? c.downText : c.text,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? '0.35' : '1', font,
      });
      if (b.mark) cssReset(b.mark, { position: 'absolute', right: '4px', bottom: '4px', display: 'block', opacity: '0.7' });
    });
    fades();
    // Style bar: above the selected drawing, inside the chart.
    const sel = ctl.hidden() ? null : ctl.selected();
    if (!sel) { panelOpen = false; cssReset(bar, { display: 'none' }); cssReset(panel, { display: 'none' }); return; }
    const sw = swatches(c);
    const plotW = chart.timeScale().width();
    const boxH = root.clientHeight || p0h;
    const cell = size + 2;
    const fullW = 10 * cell + 8 + 2;
    // Narrow plot: the compact form (colour, more, delete), its options in a panel that wraps inside the chart.
    arrange(fullW > (styleMount ? (mount.styleContainer as HTMLElement).clientWidth || plotW : plotW - 8));
    const barW = (compact ? 3 * cell : 10 * cell) + 8 + 2;
    const barH = size + 8 + 2;
    const pos = selectionPoint(sel);
    // Inside the plot: never over the price axis; above the drawing, else below its top, always inside the chart box.
    const left = Math.max(plotLeft() + 4, Math.min(plotLeft() + plotW - barW - 4, pos.x - barW / 2));
    const barTop = Math.max(4, Math.min(boxH - barH - 4, pos.y - size - 22));
    if (styleMount) cssReset(bar, { position: 'static', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '2px', padding: '0', background: 'transparent', border: '0', 'pointer-events': 'auto' });
    else cssReset(bar, {
      position: 'absolute', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '2px', padding: '4px',
      background: c.background, border: `1px solid ${c.paneSeparator}`, 'border-radius': '12px', left: `${left}px`, top: `${barTop}px`,
      'pointer-events': 'auto', 'box-sizing': 'border-box',
    });
    if (compact && panelOpen) {
      const panelW = Math.min(5 * cell + 8 + 2, plotW - 8);
      const rows = Math.ceil(9 / Math.max(1, Math.floor((panelW - 10) / cell)));
      const panelH = rows * cell + 8 + 2;
      const pLeft = Math.max(plotLeft() + 4, Math.min(plotLeft() + plotW - panelW - 4, left));
      let pTop = styleMount ? 4 : barTop + barH + 4;
      if (pTop + panelH > boxH - 4) pTop = Math.max(4, barTop - panelH - 4);
      cssReset(panel, {
        position: 'absolute', display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: '2px', padding: '4px', 'box-sizing': 'border-box',
        width: `${panelW}px`, left: `${pLeft}px`, top: `${pTop}px`, background: c.background, border: `1px solid ${c.paneSeparator}`,
        'border-radius': '12px', 'pointer-events': 'auto', 'z-index': '4',
      });
    } else cssReset(panel, { display: 'none' });
    const cur = sel.style.color ?? c.line;
    colorEl.setAttribute('aria-expanded', String(panelOpen));
    moreEl.setAttribute('aria-expanded', String(panelOpen));
    colorEl.textContent = '';
    const swatch = doc.createElement('span');
    cssReset(swatch, { display: 'block', width: '16px', height: '16px', 'border-radius': '8px', background: cur, margin: 'auto' });
    colorEl.appendChild(swatch);
    for (const [b, on] of [[colorEl, panelOpen], [moreEl, panelOpen]] as const) {
      cssReset(b, { display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center', width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, background: on ? c.grid : 'transparent', color: c.text, cursor: 'pointer', 'flex-shrink': '0', padding: '0' });
    }
    swatchEls.forEach((b, i) => {
      const col = sw[i];
      (b as HTMLButtonElement & { _c?: string })._c = col;
      const on = (sel.style.color ?? c.line) === col;
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-label', ['Blue', 'Green', 'Red', 'Orange', 'Ink'][i]);
      b.title = ['Blue', 'Green', 'Red', 'Orange', 'Ink'][i];
      cssReset(b, {
        display: 'inline-block', width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, background: 'transparent',
        cursor: 'pointer', 'flex-shrink': '0', 'box-shadow': on ? `inset 0 0 0 2px ${c.text}` : 'none', padding: '0',
      });
      b.textContent = '';
      const dot = doc.createElement('span');
      cssReset(dot, { display: 'block', width: '14px', height: '14px', 'border-radius': '7px', background: col, margin: 'auto' });
      b.appendChild(dot);
    });
    widthEls.forEach((b, i) => {
      const on = sel.style.width === i + 1;
      b.setAttribute('aria-checked', String(on));
      cssReset(b, { display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center', width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, background: on ? c.text : 'transparent', color: on ? c.background : c.text, cursor: 'pointer', 'flex-shrink': '0' });
    });
    dashEl.setAttribute('aria-pressed', String(sel.style.dash === 'dashed'));
    for (const [b, on] of [[dashEl, sel.style.dash === 'dashed'], [delEl, false]] as const) {
      cssReset(b, { display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center', width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, background: on ? c.text : 'transparent', color: on ? c.background : c.text, cursor: 'pointer', 'flex-shrink': '0' });
    }
  }

  /** Chart coordinates of the top centre of a drawing (for the style bar). */
  function selectionPoint(d: Drawing): Pt {
    const ts = chart.timeScale();
    const s = chart.panes()[d.pane]?.getSeries()[0];
    let x = 0, y = Infinity, n = 0;
    for (const p of d.points) {
      const l = ts.timeToLogical(p.time);
      const px = l === null ? null : ts.logicalToCoordinate(l);
      const py = s?.priceToCoordinate(p.price) ?? null;
      if (px === null || py === null) continue;
      x += px; n++;
      y = Math.min(y, py);
    }
    const ph = chart.panes()[d.pane]?.getHeight() ?? 0;
    const top = paneTop(d.pane);
    return { x: plotLeft() + (n ? x / n : ts.width() / 2), y: top + (Number.isFinite(y) ? Math.max(0, Math.min(ph, y)) : 0) };
  }

  function editText(d: Drawing, at: Pt, onDone?: (text: string | null) => void): void {
    editor?.remove();
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = d.text ?? '';
    input.placeholder = toolInfo(d.tool)?.text ?? 'Text';
    input.setAttribute('aria-label', 'Text of the note');
    input.maxLength = 200;
    const c = colors();
    // Inside the plot and the chart box, whatever the chart's size.
    const plotW = chart.timeScale().width();
    const boxH = root.clientHeight || (chart.panes()[0]?.getHeight() ?? 0);
    const w = Math.max(80, Math.min(200, plotW - 8));
    const h = coarse() ? 40 : 28;
    const left = Math.max(plotLeft() + 4, Math.min(plotLeft() + plotW - w - 4, plotLeft() + at.x));
    const top = Math.max(4, Math.min(boxH - h - 4, paneTop(d.pane) + at.y - h / 2));
    cssReset(input, {
      position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`, 'box-sizing': 'border-box',
      padding: '0 8px', 'border-radius': '8px', border: `1px solid ${c.focusRing}`, background: c.background, color: c.text,
      font: `500 ${coarse() ? 16 : 13}px ${chart.options().fontFamily}`, 'pointer-events': 'auto', outline: 'none',
    });
    let done = false;
    const finish = (keepText: boolean): void => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.remove();
      editor = null;
      if (onDone) onDone(keepText && v ? v : null);
      else if (keepText && v) ctl.update(d.id, { text: v });
      root.focus();
    };
    input.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') finish(true);
      else if (ev.key === 'Escape') finish(false);
    });
    let focused = false;
    input.addEventListener('focus', () => { focused = true; });
    input.addEventListener('blur', () => { if (focused) finish(true); });
    shadow.appendChild(input);
    editor = input;
    // After the press that placed the note has finished (its mousedown focuses the chart).
    if (win) win.requestAnimationFrame(() => input.focus()); else input.focus();
  }

  sync();
  return {
    sync,
    editText,
    destroy() { editor?.remove(); doc.removeEventListener('pointerdown', outside, true); host.remove(); railMount?.host.remove(); styleMount?.host.remove(); },
  };
}

