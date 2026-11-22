// Pointer, wheel, touch and keyboard input. Turns events into a handful of view operations on the chart; owns no
// chart state except the gesture in progress.

import type { InteractionOptions } from '../core/options';
import type { ChartPointerEvent, ChartPointerHandler } from '../api';

export type HitArea = 'pane' | 'price' | 'time' | 'none';

export interface InputTarget {
  readonly root: HTMLElement;
  readonly win: Window;
  interaction(): InteractionOptions;
  hit(x: number, y: number): HitArea;
  /** A drag starts at this point (chart CSS px): the chart notes the pane and axis under it. */
  gestureStart(point: { x: number; y: number }): void;
  /** Keyboard inspect mode: the crosshair steps bar by bar and each bar is announced. */
  inspecting(): boolean;
  toggleInspect(): void;
  inspectStep(bars: number): void;
  inspectEdge(edge: 'first' | 'last'): void;
  /** Pointer position in CSS px relative to the chart, or null to hide the crosshair. */
  setCrosshair(point: { x: number; y: number } | null): void;
  /** Move the content by dx (time) and dy (price, used only when the price scale is not autoscaling). */
  pan(dx: number, dy: number): void;
  zoom(anchorX: number, factor: number): void;
  /** Stretch the price scale from an axis drag of dy px. */
  stretchPrice(dy: number): void;
  resetView(): void;
  panBars(bars: number): void;
  zoomCentre(factor: number): void;
  home(): void;
  end(): void;
  click(point: { x: number; y: number }): void;
  paneWidth(): number;
  reducedMotion(): boolean;
  focusChanged(): void;
  /** Plugin pointer handlers (drawing tools), asked first. */
  pointerHandlers(): readonly ChartPointerHandler[];
  /** A pointer position as a plugin event. */
  pluginEvent(p: { x: number; y: number }, e: { pointerType?: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }, pane?: number): ChartPointerEvent;
  /** The chart's own cursor for an area ('' for the default); a plugin's forced cursor wins. */
  setRootCursor(cursor: string): void;
  /** The attribution link (or its host): pointer input on it is left to the browser so it can be clicked. */
  isLink(target: EventTarget | null): boolean;
  /** The chart or one of its parts has keyboard / click focus. */
  hasFocus(): boolean;
  /** Could the page (or a scrollable ancestor) scroll by this wheel delta? */
  pageCanScroll(dx: number, dy: number): boolean;
}

/**
 * What a wheel event does. Pure: `zoom` (anchored at the pointer), `pan` (by -dx), or `none` (left to the page,
 * no preventDefault). See `InteractionOptions.wheelZoom`.
 */
export function wheelAction(
  mode: boolean | 'auto' | 'modifier', e: { dx: number; dy: number; modifier: boolean }, focused: boolean, pageCanScroll: boolean,
): 'zoom' | 'pan' | 'none' {
  if (mode === false) return 'none';
  if (e.modifier) return 'zoom';
  if (Math.abs(e.dx) > Math.abs(e.dy)) return e.dx !== 0 ? 'pan' : 'none';
  if (e.dy === 0) return 'none';
  if (mode === true) return 'zoom';
  if (mode === 'modifier') return 'none';
  return focused || !pageCanScroll ? 'zoom' : 'none';
}

interface Pt { x: number; y: number }

const WHEEL_ZOOM_PER_PX = 0.0025;
const DRAG_THRESHOLD = 3;
/** A touch held this long without moving is a long press (plugins: `ChartPointerHandler.longPress`). */
export const LONG_PRESS_MS = 350;
const KINETIC_MIN_SPEED = 0.25; // px per ms
const KINETIC_FRICTION = 0.92; // per 16 ms

export class InputController {
  private t: InputTarget;
  private pointers = new Map<number, Pt>();
  private mode: 'none' | 'pan' | 'price' | 'pinch' = 'none';
  private start: Pt = { x: 0, y: 0 };
  private last: Pt = { x: 0, y: 0 };
  private moved = false;
  private pinchDist = 0;
  private pinchMid: Pt = { x: 0, y: 0 };
  private samples: { x: number; t: number }[] = [];
  private kineticRaf = 0;
  private owner: ChartPointerHandler | null = null;
  private ownerPane = -1;
  private off: (() => void)[] = [];
  private pressTimer: ReturnType<typeof setTimeout> | 0 = 0;

  constructor(target: InputTarget) {
    this.t = target;
    const el = target.root;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      el.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    // Passive wherever the handler never calls preventDefault (touch-action decides scrolling); only wheel, dblclick
    // and keydown can cancel. No timers on the paint path (only the long-press wait, armed while a plugin asks for it): every gesture step is applied at once and painted by the next
    // requestAnimationFrame, so a 120 Hz or 144 Hz display gets a frame on every refresh.
    const passive = { passive: true };
    on('pointerdown', e => this.down(e), passive);
    on('pointermove', e => this.move(e), passive);
    on('pointerup', e => this.up(e), passive);
    on('pointercancel', e => this.up(e, true), passive);
    on('pointerleave', e => { if (e.pointerType === 'mouse' && this.mode === 'none') target.setCrosshair(null); }, passive);
    on('wheel', e => this.wheel(e), { passive: false });
    on('dblclick', e => { if (target.interaction().doubleClickReset) { e.preventDefault(); target.resetView(); } });
    on('keydown', e => this.key(e));
    on('focus', () => target.focusChanged());
    on('blur', () => target.focusChanged());
  }

  destroy(): void {
    this.stopKinetic();
    this.clearPress();
    for (const f of this.off) f();
    this.off = [];
  }

  private local(e: { clientX: number; clientY: number }): Pt {
    const r = this.t.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private capture(id: number): void {
    try { this.t.root.setPointerCapture(id); } catch { /* capture is best effort */ }
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // The attribution link: no gesture and no pointer capture (capture would retarget its click to the chart).
    if (this.t.isLink(e.target)) return;
    this.stopKinetic();
    const p = this.local(e);
    if (this.pointers.size === 0) {
      // Plugins first: a drawing tool takes the gesture before any pan.
      const ev = this.t.pluginEvent(p, e);
      for (const h of this.t.pointerHandlers()) {
        if (h.pointerDown?.(ev)) {
          this.owner = h;
          this.ownerPane = ev.paneIndex;
          this.pointers.set(e.pointerId, p);
          this.mode = 'none';
          this.capture(e.pointerId);
          return;
        }
      }
    } else if (this.owner) return;
    this.pointers.set(e.pointerId, p);
    const opts = this.t.interaction();
    if (this.pointers.size === 2 && opts.pinchZoom) {
      const [a, b] = [...this.pointers.values()];
      this.mode = 'pinch';
      for (const id of this.pointers.keys()) this.capture(id);
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.t.setCrosshair(null);
      return;
    }
    if (this.pointers.size > 1) return;
    this.start = p;
    this.last = p;
    this.moved = false;
    this.samples = [{ x: p.x, t: e.timeStamp }];
    const area = this.t.hit(p.x, p.y);
    this.t.gestureStart(p);
    this.mode = !opts.dragPan ? 'none' : area === 'price' ? 'price' : area === 'pane' || area === 'time' ? 'pan' : 'none';
    // A touch held still for LONG_PRESS_MS: plugins may claim the gesture (`longPress`), the pan then stops.
    if (e.pointerType !== 'mouse' && this.t.pointerHandlers().some(h => h.longPress)) {
      const id = e.pointerId;
      this.pressTimer = this.t.win.setTimeout(() => {
        this.pressTimer = 0;
        if (this.moved || this.pointers.size !== 1 || !this.pointers.has(id) || this.owner) return;
        const ev = this.t.pluginEvent(this.start, e);
        for (const h of this.t.pointerHandlers()) {
          if (h.longPress?.(ev)) { this.owner = h; this.ownerPane = ev.paneIndex; this.mode = 'none'; this.capture(id); return; }
        }
      }, LONG_PRESS_MS);
    }
    if (e.pointerType === 'mouse') this.t.setRootCursor(this.mode === 'pan' ? 'grabbing' : this.mode === 'price' ? 'ns-resize' : '');
  }

  private move(e: PointerEvent): void {
    const p = this.local(e);
    if (this.owner) {
      if (this.pointers.has(e.pointerId)) this.owner.pointerMove?.(this.t.pluginEvent(p, e, this.ownerPane));
      if (e.pointerType === 'mouse') this.t.setCrosshair(p);
      return;
    }
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.mode === 'pinch') {
      const pts = [...this.pointers.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.pinchDist > 0 && dist > 0) this.t.zoom(mid.x, dist / this.pinchDist);
      this.t.pan(mid.x - this.pinchMid.x, 0);
      this.pinchDist = dist;
      this.pinchMid = mid;
      return;
    }
    if (this.mode === 'pan' || this.mode === 'price') {
      if (!this.moved && Math.hypot(p.x - this.start.x, p.y - this.start.y) < DRAG_THRESHOLD) return;
      this.clearPress();
      // Captured only once it is a drag, so a plain click lands where it was aimed.
      if (!this.moved) this.capture(e.pointerId);
      this.moved = true;
      const dx = p.x - this.last.x;
      const dy = p.y - this.last.y;
      if (this.mode === 'pan') this.t.pan(dx, dy);
      else this.t.stretchPrice(dy);
      this.last = p;
      this.samples.push({ x: p.x, t: e.timeStamp });
      if (this.samples.length > 6) this.samples.shift();
      if (e.pointerType === 'mouse') this.t.setCrosshair(p);
      return;
    }
    if (e.pointerType === 'mouse') {
      const area = this.t.hit(p.x, p.y);
      this.t.setRootCursor(area === 'price' ? 'ns-resize' : area === 'pane' ? 'crosshair' : '');
      this.t.setCrosshair(area === 'pane' ? p : null);
      const hs = this.t.pointerHandlers();
      if (hs.length) { const ev = this.t.pluginEvent(p, e); for (const h of hs) h.hover?.(ev); }
    }
  }

  private clearPress(): void {
    if (this.pressTimer) { this.t.win.clearTimeout(this.pressTimer); this.pressTimer = 0; }
  }

  private up(e: PointerEvent, cancelled = false): void {
    this.clearPress();
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try { this.t.root.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (this.owner) {
      const h = this.owner;
      this.owner = null;
      h.pointerUp?.(this.t.pluginEvent(this.local(e), e, this.ownerPane), cancelled);
      return;
    }
    if (this.mode === 'pinch') {
      if (this.pointers.size < 2) this.mode = 'none';
      return;
    }
    const p = this.local(e);
    const wasPan = this.mode === 'pan' && this.moved;
    if (!cancelled && !this.moved && this.pointers.size === 0) {
      if (this.t.hit(p.x, p.y) === 'pane') {
        // A tap on a touch screen shows the crosshair there (there is no hover).
        if (e.pointerType !== 'mouse') this.t.setCrosshair(p);
        this.t.click(p);
      }
    }
    this.mode = 'none';
    if (e.pointerType === 'mouse') this.t.setRootCursor(this.t.hit(p.x, p.y) === 'pane' ? 'crosshair' : '');
    if (wasPan && !cancelled) this.maybeKinetic(e.timeStamp);
  }

  private maybeKinetic(now: number): void {
    const opts = this.t.interaction();
    if (!opts.kinetic || this.t.reducedMotion() || this.samples.length < 2) return;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (now - last.t > 80) return; // the finger stopped before lifting
    const dt = last.t - first.t;
    if (dt <= 0) return;
    let v = (last.x - first.x) / dt;
    if (Math.abs(v) < KINETIC_MIN_SPEED) return;
    let prev = -1;
    const step = (ts: number): void => {
      if (prev >= 0) {
        const elapsed = Math.min(64, ts - prev);
        this.t.pan(v * elapsed, 0);
        v *= Math.pow(KINETIC_FRICTION, elapsed / 16);
      }
      prev = ts;
      if (Math.abs(v) > 0.02) this.kineticRaf = this.t.win.requestAnimationFrame(step);
      else this.kineticRaf = 0;
    };
    this.kineticRaf = this.t.win.requestAnimationFrame(step);
  }

  private stopKinetic(): void {
    if (this.kineticRaf) this.t.win.cancelAnimationFrame(this.kineticRaf);
    this.kineticRaf = 0;
  }

  private wheel(e: WheelEvent): void {
    const opts = this.t.interaction();
    const p = this.local(e);
    if (this.t.hit(p.x, p.y) === 'none') return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.t.paneWidth() : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const modifier = e.ctrlKey || e.metaKey;
    const mode = opts.wheelZoom;
    const action = wheelAction(mode, { dx, dy, modifier }, this.t.hasFocus(), mode === 'auto' && !modifier ? this.t.pageCanScroll(dx, dy) : true);
    if (action === 'none') return;
    e.preventDefault();
    this.stopKinetic();
    if (action === 'pan') { this.t.pan(-dx, 0); return; }
    // ctrl + wheel is a trackpad pinch: its deltas are small, so it zooms faster per pixel.
    const k = e.ctrlKey ? WHEEL_ZOOM_PER_PX * 4 : WHEEL_ZOOM_PER_PX;
    const clamped = Math.max(-200, Math.min(200, dy));
    this.t.zoom(Math.min(p.x, this.t.paneWidth()), Math.exp(-clamped * k));
  }

  private key(e: KeyboardEvent): void {
    for (const h of this.t.pointerHandlers()) {
      if (h.keyDown?.(e)) { e.preventDefault(); this.t.focusChanged(); return; }
    }
    if (!this.t.interaction().keyboard || e.altKey || e.metaKey || e.ctrlKey) return;
    this.stopKinetic();
    let handled = true;
    const inspect = this.t.inspecting();
    switch (e.key) {
      case 'ArrowLeft':
        if (inspect) this.t.inspectStep(e.shiftKey ? -10 : -1); else this.t.panBars(e.shiftKey ? -20 : -2);
        break;
      case 'ArrowRight':
        if (inspect) this.t.inspectStep(e.shiftKey ? 10 : 1); else this.t.panBars(e.shiftKey ? 20 : 2);
        break;
      case '+': case '=': case 'ArrowUp': this.t.zoomCentre(1.2); break;
      case '-': case '_': case 'ArrowDown': this.t.zoomCentre(1 / 1.2); break;
      case 'Home': if (inspect) this.t.inspectEdge('first'); else this.t.home(); break;
      case 'End': if (inspect) this.t.inspectEdge('last'); else this.t.end(); break;
      case 'Enter': case ' ': this.t.toggleInspect(); break;
      case 'Escape': if (!inspect) { handled = false; break; } this.t.setCrosshair(null); break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      this.t.focusChanged();
    }
  }
}
