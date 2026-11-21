// A canvas sized to its CSS box on whole device pixels.
//
// At a fractional device pixel ratio a CSS box is a fractional number of device pixels (999 x 1.25 = 1248.75) and
// the browser rasterises a whole number that depends on where the box sits; `round(css * dpr)` can be one pixel
// off, and the bitmap is then resampled: one-pixel lines turn two-tone. So each canvas is observed with
// ResizeObserver's 'device-pixel-content-box', and the reported size is used when it is for the same CSS box and
// within one pixel of css x dpr; otherwise round(css x dpr). Ported from the host engine (PROVENANCE.md).

/** The pure size rule: the backing store for a CSS length. */
export function backingStoreSize(css: number, dpr: number, reported: number | null): number {
  const expected = Math.max(1, Math.round(css * dpr));
  if (reported !== null && reported > 0 && Math.abs(reported - css * dpr) <= 1) return reported;
  return expected;
}

export class CanvasLayer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  cssW = 0;
  cssH = 0;
  /** Device pixels per CSS pixel, horizontally and vertically (equal except by a rounding hair). */
  hpr = 1;
  vpr = 1;
  private reportedW: number | null = null;
  private reportedH: number | null = null;
  private reportedForW = -1;
  private reportedForH = -1;
  private observer: ResizeObserver | null = null;

  constructor(doc: Document, onDeviceResize: () => void) {
    this.canvas = doc.createElement('canvas');
    const st = this.canvas.style;
    st.position = 'absolute';
    st.left = '0';
    st.top = '0';
    st.display = 'block';
    st.pointerEvents = 'none';
    const ctx = this.canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Chartist Lite: 2D canvas is not available');
    this.ctx = ctx;
    const RO = (doc.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver;
    if (RO) {
      try {
        this.observer = new RO(entries => {
          const e = entries[entries.length - 1];
          const dev = e.devicePixelContentBoxSize?.[0];
          if (!dev) return;
          this.reportedW = dev.inlineSize;
          this.reportedH = dev.blockSize;
          this.reportedForW = e.contentRect.width;
          this.reportedForH = e.contentRect.height;
          onDeviceResize();
        });
        this.observer.observe(this.canvas, { box: 'device-pixel-content-box' } as ResizeObserverOptions);
      } catch {
        this.observer = null;
      }
    }
  }

  /** Size the canvas; returns true when the backing store changed (its content is then cleared). */
  resize(cssW: number, cssH: number, dpr: number): boolean {
    const sameW = Math.abs(this.reportedForW - cssW) < 0.01;
    const sameH = Math.abs(this.reportedForH - cssH) < 0.01;
    const bw = backingStoreSize(cssW, dpr, sameW ? this.reportedW : null);
    const bh = backingStoreSize(cssH, dpr, sameH ? this.reportedH : null);
    const changed = bw !== this.canvas.width || bh !== this.canvas.height || cssW !== this.cssW || cssH !== this.cssH;
    if (cssW !== this.cssW || cssH !== this.cssH) {
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
    }
    if (bw !== this.canvas.width) this.canvas.width = bw;
    if (bh !== this.canvas.height) this.canvas.height = bh;
    this.cssW = cssW;
    this.cssH = cssH;
    this.hpr = cssW > 0 ? bw / cssW : dpr;
    this.vpr = cssH > 0 ? bh / cssH : dpr;
    return changed;
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.canvas.remove();
  }
}
