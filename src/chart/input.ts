// Pointer, wheel, touch and keyboard input. Turns events into a handful of view operations on the chart; owns no
// chart state except the gesture in progress.

import type { InteractionOptions } from '../core/options';

export type HitArea = 'pane' | 'price' | 'time' | 'none';

export interface InputTarget {
  readonly root: HTMLElement;
  readonly win: Window;
  interaction(): InteractionOptions;
  hit(x: number, y: number): HitArea;
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
}

interface Pt { x: number; y: number }

const WHEEL_ZOOM_PER_PX = 0.0025;
const DRAG_THRESHOLD = 3;
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
  private off: (() => void)[] = [];

  constructor(target: InputTarget) {
    this.t = target;
    const el = target.root;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      el.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', e => this.down(e));
    on('pointermove', e => this.move(e));
    on('pointerup', e => this.up(e));
    on('pointercancel', e => this.up(e, true));
    on('pointerleave', e => { if (e.pointerType === 'mouse' && this.mode === 'none') target.setCrosshair(null); });
    on('wheel', e => this.wheel(e), { passive: false });
    on('dblclick', e => { if (target.interaction().doubleClickReset) { e.preventDefault(); target.resetView(); } });
    on('keydown', e => this.key(e));
    on('focus', () => target.focusChanged());
    on('blur', () => target.focusChanged());
  }

  destroy(): void {
    this.stopKinetic();
    for (const f of this.off) f();
    this.off = [];
  }

  private local(e: { clientX: number; clientY: number }): Pt {
    const r = this.t.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.stopKinetic();
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    try { this.t.root.setPointerCapture(e.pointerId); } catch { /* capture is best effort */ }
    const opts = this.t.interaction();
    if (this.pointers.size === 2 && opts.pinchZoom) {
      const [a, b] = [...this.pointers.values()];
      this.mode = 'pinch';
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
    this.mode = !opts.dragPan ? 'none' : area === 'price' ? 'price' : area === 'pane' || area === 'time' ? 'pan' : 'none';
    if (e.pointerType === 'mouse') this.t.root.style.cursor = this.mode === 'pan' ? 'grabbing' : this.mode === 'price' ? 'ns-resize' : '';
  }

  private move(e: PointerEvent): void {
    const p = this.local(e);
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
      this.t.root.style.cursor = area === 'price' ? 'ns-resize' : area === 'pane' ? 'crosshair' : '';
      this.t.setCrosshair(area === 'pane' ? p : null);
    }
  }

  private up(e: PointerEvent, cancelled = false): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try { this.t.root.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
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
    if (e.pointerType === 'mouse') this.t.root.style.cursor = this.t.hit(p.x, p.y) === 'pane' ? 'crosshair' : '';
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
    if (!opts.wheelZoom) return;
    const p = this.local(e);
    if (this.t.hit(p.x, p.y) === 'none') return;
    e.preventDefault();
    this.stopKinetic();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.t.paneWidth() : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (Math.abs(dx) > Math.abs(dy) && !e.ctrlKey) {
      this.t.pan(-dx, 0);
      return;
    }
    // ctrl + wheel is a trackpad pinch: its deltas are small, so it zooms faster per pixel.
    const k = e.ctrlKey ? WHEEL_ZOOM_PER_PX * 4 : WHEEL_ZOOM_PER_PX;
    const clamped = Math.max(-200, Math.min(200, dy));
    this.t.zoom(Math.min(p.x, this.t.paneWidth()), Math.exp(-clamped * k));
  }

  private key(e: KeyboardEvent): void {
    if (!this.t.interaction().keyboard || e.altKey || e.metaKey || e.ctrlKey) return;
    this.stopKinetic();
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': this.t.panBars(e.shiftKey ? -20 : -2); break;
      case 'ArrowRight': this.t.panBars(e.shiftKey ? 20 : 2); break;
      case '+': case '=': case 'ArrowUp': this.t.zoomCentre(1.2); break;
      case '-': case '_': case 'ArrowDown': this.t.zoomCentre(1 / 1.2); break;
      case 'Home': this.t.home(); break;
      case 'End': this.t.end(); break;
      case 'Escape': this.t.setCrosshair(null); break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      this.t.focusChanged();
    }
  }
}
