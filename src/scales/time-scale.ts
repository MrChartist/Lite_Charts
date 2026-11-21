// The horizontal scale: logical index <-> x. Pure.
//
// Bars are equally spaced, `barSpacing` CSS px apart, one per logical index (distinct time). The view is anchored
// to the LAST bar: `rightOffset` is how many bars of empty space lie between the last bar and the right edge
// (negative when scrolled back into history). So a new bar shifts the view along with it, and zoom/pan only ever
// change two numbers.
//
//   x(i) = width - (last + rightOffset - i + 0.5) * barSpacing     (bar centre)
//   visible logical range = [rightIndex - width / barSpacing + 1, rightIndex],  rightIndex = last + rightOffset

export interface TimeScaleOptions {
  /** CSS px between bar centres at first show and after a reset. */
  barSpacing: number;
  minBarSpacing: number;
  maxBarSpacing: number;
  /** Empty bars kept right of the last bar at first show and after a reset. */
  rightOffset: number;
}

export interface LogicalRange {
  from: number;
  to: number;
}

export class TimeScaleModel {
  options: TimeScaleOptions;
  width = 0;
  /** Number of logical slots (distinct times). */
  count = 0;
  barSpacing: number;
  rightOffset: number;

  constructor(options: TimeScaleOptions) {
    this.options = options;
    this.barSpacing = options.barSpacing;
    this.rightOffset = options.rightOffset;
  }

  last(): number { return this.count - 1; }
  rightIndex(): number { return this.last() + this.rightOffset; }

  indexToX(i: number): number {
    return this.width - (this.rightIndex() - i + 0.5) * this.barSpacing;
  }

  xToIndex(x: number): number {
    return this.rightIndex() - (this.width - x) / this.barSpacing + 0.5;
  }

  visibleLogicalRange(): LogicalRange | null {
    if (!(this.width > 0) || this.count === 0) return null;
    const to = this.rightIndex();
    return { from: to - this.width / this.barSpacing + 1, to };
  }

  /** Inclusive bar indices that touch the plot, clipped to the data. Null when none. */
  visibleBars(): { from: number; to: number } | null {
    const r = this.visibleLogicalRange();
    if (!r) return null;
    const from = Math.max(0, Math.floor(r.from - 0.5));
    const to = Math.min(this.last(), Math.ceil(r.to + 0.5));
    return from <= to ? { from, to } : null;
  }

  setVisibleLogicalRange(r: LogicalRange): void {
    if (!(this.width > 0) || !(r.to > r.from - 1)) return;
    this.barSpacing = this.width / (r.to - r.from + 1);
    this.rightOffset = r.to - this.last();
    this.clamp();
  }

  /** Zoom by `factor` (> 1 = closer) keeping the bar under `anchorX` in place. */
  zoom(anchorX: number, factor: number): void {
    if (!(factor > 0) || !(this.width > 0)) return;
    const i0 = this.xToIndex(anchorX);
    this.barSpacing = clamp(this.barSpacing * factor, this.options.minBarSpacing, this.maxSpacing());
    this.rightOffset = i0 - 0.5 - this.last() + (this.width - anchorX) / this.barSpacing;
    this.clamp();
  }

  /** Move the content by `dx` CSS px (positive = drag to the right = show older bars). */
  pan(dx: number): void {
    this.rightOffset -= dx / this.barSpacing;
    this.clamp();
  }

  /** Show every bar (and the default right offset), within the spacing limits. */
  fitContent(): void {
    if (this.count === 0) return;
    this.setVisibleLogicalRange({ from: 0, to: this.last() + this.options.rightOffset });
  }

  scrollToRealTime(): void {
    this.rightOffset = this.options.rightOffset;
    this.clamp();
  }

  reset(): void {
    this.barSpacing = this.options.barSpacing;
    this.rightOffset = this.options.rightOffset;
    this.clamp();
  }

  /** New bars were appended: keep a scrolled-back view still (a view at the live edge follows the new bar). */
  onAppend(added: number): void {
    if (this.rightOffset < -0.5) this.rightOffset -= added;
  }

  maxSpacing(): number {
    return Math.max(this.options.minBarSpacing, Math.min(this.options.maxBarSpacing, this.width > 0 ? this.width / 2 : Infinity));
  }

  /** Keep the spacing in range and at least a couple of bars on screen. */
  clamp(): void {
    this.barSpacing = clamp(this.barSpacing, this.options.minBarSpacing, this.maxSpacing());
    if (this.count === 0 || !(this.width > 0)) return;
    const keep = Math.min(this.count, 2);
    const lo = keep - 1 - this.last();
    const hi = this.width / this.barSpacing - keep;
    this.rightOffset = clamp(this.rightOffset, lo, Math.max(lo, hi));
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
