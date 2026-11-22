// Bar replay. Pick a start bar (click on the chart, or a date), then play, pause and step through the rest of the data
// one bar at a time at 1x, 2x, 4x or 10x. It only feeds the series through `setData` (start, step back, exit) and
// `update` (play, step forward), so indicators and alerts built on the series keep working. One animation-frame loop
// runs only while playing and never applies more than one bar per frame. The control strip is DOM in a shadow root:
// a toolbar with roving focus, aria labels, and a "Live" button that leaves replay and shows all the data again.

import type { ChartApi, ChartPointerHandler } from '../../api';
import type { Time } from '../../core/time';
import { timeToSeconds } from '../../core/time';
import { readableTextOn } from '../../core/theme';
import type { ChartPrimitive, PrimitiveHost } from '../primitive';
import type { AnySeries, Elem, Removable } from './common';
import {
  accentFor, calendarOf, createHost, css, focusRing, iconEl, make, mixColors, removable, stampText, kindOfRows, surfaceStyle, useChartUi, zoneOf,
} from './common';

export type ReplaySpeed = 1 | 2 | 4 | 10;
export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [1, 2, 4, 10];

export interface ReplayOptions {
  /** The full history to replay, ascending in time (the rows `series.setData` accepts). */
  data: readonly ({ time: Time } & Record<string, unknown>)[];
  /** Called after every change of the shown bar. */
  onStep?: (info: ReplayInfo) => void;
  /** Called when replay starts, ends (reached the last bar) or exits. */
  onState?: (info: ReplayInfo) => void;
  /** Mount the strip in your own element instead of over the chart. */
  container?: HTMLElement;
  /** Strip position over the plot. Default 'bottom'. Ignored with `container`. */
  position: 'top' | 'bottom';
}

export interface ReplayInfo {
  active: boolean;
  playing: boolean;
  /** Index of the last shown row in `data` (-1 when not active). */
  index: number;
  length: number;
  speed: ReplaySpeed;
  time: Time | undefined;
}

export interface ReplayHandle extends Removable {
  /** Begin replay at a bar: a time (the first bar at or after it) or a row index. */
  start(at: Time | number): void;
  play(): void;
  pause(): void;
  /** Move by `bars` (negative goes back). Pauses playback. */
  step(bars?: number): void;
  setSpeed(speed: ReplaySpeed): void;
  /** Leave replay: all the data again. */
  exit(): void;
  /** Arm the "click a bar to start" mode. */
  pick(on?: boolean): void;
  info(): ReplayInfo;
  applyOptions(options: Partial<Omit<ReplayOptions, 'data'>>): void;
}

/** Bars per second at 1x. */
export const BASE_BAR_MS = 800;

/**
 * One animation frame of playback: `carry` ms are banked, `dt` ms passed; at most ONE bar is released per frame (a
 * hidden tab or a slow frame never bursts). Returns the bar count (0 or 1) and the new carry (always under one interval).
 */
export function tickReplay(carry: number, dt: number, speed: number, baseMs = BASE_BAR_MS): { steps: 0 | 1; carry: number } {
  const interval = baseMs / speed;
  const total = carry + Math.max(0, Math.min(dt, 1000));
  if (total >= interval) return { steps: 1, carry: Math.min(total - interval, interval * 0.999) };
  return { steps: 0, carry: total };
}

/** Index of the first row at or after `seconds`, or `n - 1` when every row is earlier; null for no rows. */
export function startIndexAt(times: readonly number[], seconds: number): number | null {
  const n = times.length;
  if (n === 0) return null;
  let lo = 0;
  let hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < seconds) lo = mid + 1; else hi = mid; }
  return Math.min(lo, n - 1);
}

/** Move an index by `bars` inside `[0, last]`. */
export const stepIndex = (index: number, bars: number, last: number): number => Math.max(0, Math.min(last, index + bars));

const H = 32;

export function createReplay(chart: ChartApi, series: AnySeries, options: Partial<ReplayOptions> & { data: ReplayOptions['data'] }): ReplayHandle {
  const data = options.data;
  if (!Array.isArray(data) || data.length < 2) throw new TypeError('Chartist Lite: createReplay needs "data": an array of at least two rows');
  const times: number[] = data.map(r => timeToSeconds(r.time));
  for (let i = 1; i < times.length; i++) if (times[i] <= times[i - 1]) throw new TypeError('Chartist Lite: createReplay "data" must be in ascending time order, one row per time');
  let opts = { position: 'bottom' as 'top' | 'bottom', ...options };
  const last = data.length - 1;
  const ui = useChartUi(chart);
  const inline = !!opts.container;
  const dom = createHost(chart, 'replay', true, 3, { parent: opts.container, inline });
  const doc = dom.doc;
  const win = doc.defaultView as Window;

  let active = false;
  let playing = false;
  let index = -1;
  let speed: ReplaySpeed = 1;
  let picking = false;
  let hoverX: number | null = null;
  let raf = 0;
  let prevTs = 0;
  let carry = 0;
  let primHost: PrimitiveHost | null = null;
  let cursorSet = false;

  const info = (): ReplayInfo => ({ active, playing, index, length: data.length, speed, time: index >= 0 ? data[index].time : undefined });
  const kind = kindOfRows(data);
  const stamp = (i: number): string => stampText(chart, data[i].time, kind);

  // ── strip DOM ──
  const bar = make(doc, 'div', {
    position: inline ? 'relative' : 'absolute', left: '0', top: '0', display: 'flex', 'align-items': 'center', gap: '2px', height: `${H}px`, padding: '0 4px',
    'border-radius': `${H / 2}px`, 'pointer-events': 'auto', 'white-space': 'nowrap', 'max-width': '100%', overflow: 'hidden',
  }, dom.root);
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Bar replay');
  const sr = make(doc, 'div', { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', 'white-space': 'nowrap' }, dom.root);
  sr.setAttribute('aria-live', 'polite');
  sr.setAttribute('aria-atomic', 'true');

  const btn = (label: string, content: Node | string, extra: Record<string, string> = {}): HTMLButtonElement => {
    const b = make(doc, 'button', {
      display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center', gap: '6px', height: '28px', 'min-width': '28px', padding: '0 6px', 'border-radius': '14px',
      cursor: 'pointer', appearance: 'none', '-webkit-appearance': 'none', font: `500 12px/16px ${ui.state().fontFamily}`, 'touch-action': 'manipulation', 'flex-shrink': '0', ...extra,
    }, bar) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    if (typeof content === 'string') b.textContent = content; else b.appendChild(content);
    focusRing(b, () => ui.state().colors.focusRing);
    return b;
  };
  const filled = (path: string): SVGSVGElement => { const s = iconEl(doc, path, 16, 2); s.setAttribute('fill', 'currentColor'); return s; };
  const replayBtn = btn('Start replay: pick a bar', (() => { const f = doc.createDocumentFragment(); f.appendChild(filled('M8 5.5v13l10.5-6.5z')); const t = doc.createElement('span'); t.textContent = 'Replay'; f.appendChild(t); return f; })(), { padding: '0 10px 0 8px' });
  const hint = make(doc, 'span', { display: 'none', padding: '0 8px', font: `400 12px/16px ${ui.state().fontFamily}` }, bar);
  hint.textContent = 'Click a bar to start';
  const dateIn = make(doc, 'input', { display: 'none', height: '24px', padding: '0 6px', 'border-radius': '12px', font: `400 12px/16px ${ui.state().fontFamily}`, width: '124px', 'min-width': '0' }, bar) as HTMLInputElement;
  dateIn.type = 'date';
  dateIn.setAttribute('aria-label', 'Start replay on date');
  focusRing(dateIn, () => ui.state().colors.focusRing);
  const cancelBtn = btn('Cancel', iconEl(doc, 'M6 6l12 12M18 6L6 18', 14, 2), { display: 'none' });
  const backBtn = btn('Step back one bar', iconEl(doc, 'M18 5.5l-9 6.5 9 6.5zM5.5 5.5v13', 16, 2), { display: 'none' });
  const playBtn = btn('Play', filled('M8 5.5v13l10.5-6.5z'), { display: 'none', width: '30px', 'min-width': '30px' });
  const fwdBtn = btn('Step forward one bar', iconEl(doc, 'M6 5.5l9 6.5-9 6.5zM18.5 5.5v13', 16, 2), { display: 'none' });
  const speedGroup = make(doc, 'div', { display: 'none', 'align-items': 'center', gap: '0' }, bar);
  speedGroup.setAttribute('role', 'group');
  speedGroup.setAttribute('aria-label', 'Speed');
  const speedBtns = REPLAY_SPEEDS.map(v => {
    const b = make(doc, 'button', {
      height: '28px', 'min-width': '30px', padding: '0 5px', 'border-radius': '14px', cursor: 'pointer', appearance: 'none', '-webkit-appearance': 'none',
      font: `600 12px/16px ${ui.state().fontFamily}`, 'font-variant-numeric': 'tabular-nums', 'touch-action': 'manipulation',
    }, speedGroup) as HTMLButtonElement;
    b.type = 'button';
    b.textContent = `${v}x`;
    b.setAttribute('aria-label', `Speed ${v}x`);
    b.addEventListener('click', () => api.setSpeed(v));
    focusRing(b, () => ui.state().colors.focusRing);
    return b;
  });
  const stampEl = make(doc, 'span', { display: 'none', padding: '0 8px', 'font-variant-numeric': 'tabular-nums', font: `500 12px/16px ${ui.state().fontFamily}` }, bar);
  const liveBtn = btn('Exit replay and show the latest bar', (() => {
    const f = doc.createDocumentFragment();
    const d = make(doc, 'span', { width: '8px', height: '8px', 'border-radius': '4px', display: 'inline-block' });
    d.setAttribute('data-live-dot', '');
    f.appendChild(d);
    const t = doc.createElement('span');
    t.textContent = 'Live';
    f.appendChild(t);
    return f;
  })(), { display: 'none', padding: '0 10px 0 8px' });
  const controls: HTMLButtonElement[] = [replayBtn, cancelBtn, backBtn, playBtn, fwdBtn, ...speedBtns, liveBtn];

  // Roving focus for the toolbar: Left / Right move between the visible controls.
  const visibleControls = (): HTMLButtonElement[] => controls.filter(c => c.style.getPropertyValue('display') !== 'none' && (c.parentElement !== speedGroup || speedGroup.style.getPropertyValue('display') !== 'none'));
  const syncTab = (focused?: HTMLButtonElement): void => {
    const vis = visibleControls();
    const target = focused && vis.includes(focused) ? focused : vis[0];
    for (const c of controls) c.tabIndex = c === target ? 0 : -1;
  };
  bar.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const vis = visibleControls();
    const i = vis.indexOf(e.target as HTMLButtonElement);
    if (i < 0 && !(e.target === bar)) return;
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % vis.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + vis.length) % vis.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = vis.length - 1;
    else if (e.key === 'Escape' && picking) { api.pick(false); e.preventDefault(); return; }
    if (j < 0) return;
    e.preventDefault();
    syncTab(vis[j]);
    vis[j].focus();
  });
  bar.addEventListener('focusin', e => { if (controls.includes(e.target as HTMLButtonElement)) syncTab(e.target as HTMLButtonElement); });

  const show = (el: Elem, on: boolean, display = 'inline-flex'): void => css(el, { display: on ? display : 'none' });

  const paintStrip = (): void => {
    const s = ui.state();
    const c = s.colors;
    const accent = accentFor(c);
    css(bar, { ...surfaceStyle(s), color: c.text });
    const track = mixColors(c.background, c.text, s.dark ? 0.16 : 0.08);
    const ink = (el: Elem, on = false): void => css(el, { color: on ? c.background : c.text, background: on ? c.text : 'transparent' });
    for (const b of [replayBtn, cancelBtn, backBtn, fwdBtn, liveBtn]) ink(b);
    css(replayBtn, { color: c.text });
    css(hint, { color: c.mutedText });
    css(dateIn, { color: c.text, background: track, 'color-scheme': s.dark ? 'dark' : 'light' });
    const playFill = c.line;
    css(playBtn, { background: playFill, color: readableTextOn(playFill) });
    css(stampEl, { color: c.mutedText });
    css(speedGroup, { background: track, 'border-radius': '14px' });
    speedBtns.forEach((b, i) => {
      const on = REPLAY_SPEEDS[i] === speed;
      css(b, { background: on ? c.background : 'transparent', color: on ? c.text : mixColors(c.text, track, 0.2), 'box-shadow': on ? '0 1px 2px rgba(0,0,0,0.25)' : 'none' });
      b.setAttribute('aria-pressed', String(on));
    });
    const dot = liveBtn.querySelector('[data-live-dot]') as Elem | null;
    if (dot) css(dot, { background: accent });
    css(liveBtn, { color: c.text });
    const disabled = (b: HTMLButtonElement, off: boolean): void => { b.setAttribute('aria-disabled', String(off)); css(b, { opacity: off ? '0.4' : '1', cursor: off ? 'default' : 'pointer' }); };
    disabled(backBtn, !active || index <= 0);
    disabled(fwdBtn, !active || index >= last);
    disabled(playBtn, !active || index >= last);
    // Place.
    if (!inline) {
      const w = bar.offsetWidth;
      const x = s.plot.x + (s.plot.width - w) / 2;
      const y = opts.position === 'top' ? s.plot.y + 10 : s.plot.y + s.plot.height - H - 10;
      css(bar, { transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` });
    }
  };

  const layout = (): void => {
    show(replayBtn, !active && !picking);
    show(hint, picking, 'inline');
    show(dateIn, picking, 'inline-block');
    show(cancelBtn, picking);
    show(backBtn, active);
    show(playBtn, active);
    show(fwdBtn, active);
    show(speedGroup, active, 'inline-flex');
    show(stampEl, active, 'inline');
    show(liveBtn, active);
    if (active) stampEl.textContent = stamp(index);
    playBtn.replaceChildren(playing ? (() => { const s = iconEl(doc, 'M9 6v12M15 6v12', 16, 3); return s; })() : filled('M8 5.5v13l10.5-6.5z'));
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    playBtn.title = playing ? 'Pause' : 'Play';
    syncTab();
    paintStrip();
  };

  const announce = (msg: string): void => { sr.textContent = msg; };
  const emit = (stepped: boolean): void => {
    layout();
    const i = info();
    try { if (stepped) opts.onStep?.(i); opts.onState?.(i); } catch { /* the host's callback */ }
  };

  // ── playback ──
  const stopLoop = (): void => { if (raf) win.cancelAnimationFrame(raf); raf = 0; prevTs = 0; carry = 0; };
  const frame = (ts: number): void => {
    raf = 0;
    if (!playing) return;
    const dt = prevTs ? ts - prevTs : 0;
    prevTs = ts;
    const t = tickReplay(carry, dt, speed);
    carry = t.carry;
    if (t.steps) {
      if (index >= last) { pauseIt(true); return; }
      index++;
      series.update(data[index] as never);
      stepEmit();
      if (index >= last) { pauseIt(true); announce('Replay reached the last bar'); return; }
    }
    raf = win.requestAnimationFrame(frame);
  };
  const stepEmit = (): void => {
    stampEl.textContent = stamp(index);
    paintStrip();
    try { opts.onStep?.(info()); } catch { /* the host's callback */ }
  };
  const pauseIt = (ended = false): void => {
    if (!playing && !ended) return;
    playing = false;
    stopLoop();
    emit(false);
  };

  const begin = (i: number): void => {
    active = true;
    picking = false;
    index = i;
    series.setData(data.slice(0, i + 1) as never);
    chart.timeScale().scrollToRealTime();
    setPickCursor(false);
    announce(`Replay started at ${stamp(i)}`);
    emit(true);
    playBtn.focus();
  };

  const setPickCursor = (on: boolean): void => {
    if (on === cursorSet) return;
    cursorSet = on;
    chart.setCursor(on ? 'crosshair' : null);
  };

  // Picking: a click on the plot starts replay at that bar. The pointer hook takes the press so the chart does not pan.
  const handler: ChartPointerHandler = {
    pointerDown(e) {
      if (!picking || e.area !== 'pane') return false;
      const i = startIndexAt(times, chart.timeScale().logicalToTime(Math.round(e.logical)) ?? times[0]);
      if (i !== null) begin(i);
      return true;
    },
    hover(e) {
      if (!picking) return;
      hoverX = e.area === 'pane' ? e.point.x : null;
      primHost?.requestOverlay?.();
    },
    keyDown(e) {
      if (picking && e.key === 'Escape') { api.pick(false); return true; }
      return false;
    },
  };
  const removeHandler = chart.addPointerHandler(handler);
  const leave = (): void => { hoverX = null; primHost?.requestOverlay?.(); };
  chart.element().addEventListener('pointerleave', leave, { passive: true });
  const prim: ChartPrimitive = {
    zOrder: 'top',
    attached(h) { primHost = h; },
    detached() { primHost = null; },
    drawOverlay(s) {
      if (!picking || hoverX === null) return;
      const { ctx, pane } = s;
      const accent = accentFor(s.colors);
      const x = Math.round(pane.x + hoverX) + 0.5;
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, pane.y);
      ctx.lineTo(x, pane.y + pane.height);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(x, pane.y + 6); ctx.lineTo(x + 7, pane.y + 14); ctx.lineTo(x, pane.y + 22);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
  chart.attachPrimitive(prim);

  replayBtn.addEventListener('click', () => api.pick(true));
  cancelBtn.addEventListener('click', () => api.pick(false));
  backBtn.addEventListener('click', () => api.step(-1));
  fwdBtn.addEventListener('click', () => api.step(1));
  playBtn.addEventListener('click', () => { if (playing) api.pause(); else api.play(); });
  liveBtn.addEventListener('click', () => api.exit());
  dateIn.addEventListener('change', () => {
    if (!dateIn.value) return;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIn.value);
    if (!m) return;
    const zone = zoneOf(chart);
    const bd = typeof data[0].time !== 'number';
    const want = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
    let at = 0;
    while (at < last && calendarOf(times[at], zone, bd).dayNum < want) at++;
    begin(at);
  });
  const off = ui.onFrame(() => paintStrip());
  // min / max of the date field, in the chart's zone.
  {
    const zone = zoneOf(chart);
    const bd = typeof data[0].time !== 'number';
    const iso = (sec: number): string => { const c = calendarOf(sec, zone, bd); return `${String(c.year).padStart(4, '0')}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`; };
    dateIn.min = iso(times[0]);
    dateIn.max = iso(times[last]);
  }
  layout();

  const api: ReplayHandle = removable({
    start(at: Time | number) {
      const i = typeof at === 'number' && Number.isInteger(at) && at >= 0 && at < data.length && at < 1e9 ? at : startIndexAt(times, timeToSeconds(at as Time));
      if (i === null) return;
      pauseIt();
      begin(i);
    },
    play() {
      if (!active || playing || index >= last) return;
      playing = true;
      prevTs = 0;
      carry = 0;
      raf = win.requestAnimationFrame(frame);
      emit(false);
    },
    pause() { pauseIt(); },
    step(bars = 1) {
      if (!active) return;
      pauseIt();
      const to = stepIndex(index, bars, last);
      if (to === index) return;
      const forward = to === index + 1;
      index = to;
      if (forward) series.update(data[index] as never);
      else series.setData(data.slice(0, index + 1) as never);
      announce(`Bar ${stamp(index)}`);
      stepEmit();
      layout();
    },
    setSpeed(v: ReplaySpeed) {
      if (!REPLAY_SPEEDS.includes(v)) throw new TypeError('Chartist Lite: replay speed must be 1, 2, 4 or 10');
      speed = v;
      announce(`Speed ${v}x`);
      layout();
    },
    exit() {
      if (!active && !picking) return;
      const wasActive = active;
      playing = false;
      stopLoop();
      active = false;
      picking = false;
      index = -1;
      setPickCursor(false);
      if (wasActive) series.setData(data as never);
      announce('Replay ended: showing all bars');
      emit(false);
      replayBtn.focus();
    },
    pick(on = true) {
      if (on && active) return;
      picking = on;
      if (!on) hoverX = null;
      setPickCursor(on);
      primHost?.requestOverlay?.();
      layout();
      if (on) { hint.textContent = 'Click a bar to start'; cancelBtn.focus(); }
      else replayBtn.focus();
    },
    info,
    applyOptions(patch: Partial<Omit<ReplayOptions, 'data'>>) { opts = { ...opts, ...patch }; paintStrip(); },
  } as ReplayHandle & { remove: () => void }, () => {
    playing = false;
    stopLoop();
    const wasActive = active;
    active = false;
    if (wasActive) series.setData(data as never);
    setPickCursor(false);
    removeHandler();
    chart.element().removeEventListener('pointerleave', leave);
    try { chart.detachPrimitive(prim); } catch { /* chart removed */ }
    off();
    dom.destroy();
    ui.release();
  });
  return api;
}

