// A vertical scale: maps prices to y (CSS px, 0 at the top of the scale's pane) and back. Pure: no canvas.
//
// The scale works in its own "scale space": linear = the price, log = ln(price), percent = change from the base
// price in percent. Autoscale fits the visible values into the pane less the top and bottom margins.

export type PriceScaleMode = 'linear' | 'log' | 'percent';

export interface ScaleMargins {
  /** Share of the pane height left empty above the highest value, 0..1. */
  top: number;
  /** Share left empty below the lowest value, 0..1. */
  bottom: number;
}

export interface PriceScaleOptions {
  mode: PriceScaleMode;
  /** Fit the visible data on every repaint. Turned off by dragging the axis; double-click turns it back on. */
  autoScale: boolean;
  scaleMargins: ScaleMargins;
  /** Draw this scale's axis. Overlay scales (any id other than 'right') are never drawn. */
  visible: boolean;
}

export class PriceScaleModel {
  readonly id: string;
  options: PriceScaleOptions;
  /** Pixel height of the pane this scale spans. */
  height = 0;
  /** Visible range in scale space (min at the bottom margin, max at the top margin). */
  min = NaN;
  max = NaN;
  /** Percent mode: the price that reads 0%. */
  base = NaN;

  constructor(id: string, options: PriceScaleOptions) {
    this.id = id;
    this.options = options;
  }

  isEmpty(): boolean {
    return !(this.max > this.min) || !(this.height > 0);
  }

  /** Price -> scale space. NaN when the price cannot be shown (log of a value <= 0, percent without a base). */
  toScale(price: number): number {
    switch (this.options.mode) {
      case 'log': return price > 0 ? Math.log(price) : NaN;
      case 'percent': return this.base !== 0 && Number.isFinite(this.base) ? (price / this.base - 1) * 100 : NaN;
      default: return price;
    }
  }

  fromScale(v: number): number {
    switch (this.options.mode) {
      case 'log': return Math.exp(v);
      case 'percent': return this.base * (1 + v / 100);
      default: return v;
    }
  }

  private innerTop(): number { return this.height * clamp01(this.options.scaleMargins.top); }
  private innerHeight(): number {
    const m = this.options.scaleMargins;
    return Math.max(1, this.height * (1 - clamp01(m.top) - clamp01(m.bottom)));
  }

  /** y in CSS px from the top of the pane; NaN when the price cannot be shown. */
  priceToY(price: number): number {
    const s = this.toScale(price);
    if (Number.isNaN(s) || this.isEmpty()) return NaN;
    return this.innerTop() + ((this.max - s) / (this.max - this.min)) * this.innerHeight();
  }

  yToPrice(y: number): number {
    if (this.isEmpty()) return NaN;
    const s = this.max - ((y - this.innerTop()) / this.innerHeight()) * (this.max - this.min);
    return this.fromScale(s);
  }

  /** Fit [lo, hi] (prices). A flat range is opened symmetrically so a single value sits mid-pane. */
  fit(lo: number, hi: number): void {
    let a = this.toScale(lo);
    let b = this.toScale(hi);
    if (!Number.isFinite(a) || !Number.isFinite(b)) { this.min = NaN; this.max = NaN; return; }
    if (a > b) { const t = a; a = b; b = t; }
    if (b - a < 1e-12 * Math.max(1, Math.abs(a))) {
      const pad = this.options.mode === 'log' ? 0.01 : Math.max(Math.abs(a) * 0.01, 0.5);
      a -= pad;
      b += pad;
    }
    this.min = a;
    this.max = b;
  }

  /** Stretch the range about its centre (factor > 1 shows more). Used by the axis drag. */
  scaleBy(factor: number): void {
    if (this.isEmpty() || !(factor > 0)) return;
    const mid = (this.min + this.max) / 2;
    const half = ((this.max - this.min) / 2) * factor;
    this.min = mid - half;
    this.max = mid + half;
  }

  /** Move the range by `dy` CSS px (positive = content moves down). */
  shiftBy(dy: number): void {
    if (this.isEmpty()) return;
    const d = (dy / this.innerHeight()) * (this.max - this.min);
    this.min += d;
    this.max += d;
  }

  /** The prices at the top and bottom edges of the pane (margins included), for the tick planner. */
  edgePrices(): { lo: number; hi: number } {
    return { lo: this.yToPrice(this.height), hi: this.yToPrice(0) };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 0.95 ? 0.95 : v;
}
