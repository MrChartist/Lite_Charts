// Text on the canvas: cached measuring, and tabular figures. Canvas has no `font-variant-numeric`, so a number is
// drawn in runs: every digit sits centred in a cell as wide as the font's widest digit, everything else is drawn
// as one run at its natural width. Columns of prices then line up whatever the font's default figures are.

export class TextPainter {
  private family = '';
  private size = 12;
  private widths = new Map<string, number>();
  private digitW = new Map<number, number>();
  private ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  setFont(family: string, size: number): void {
    if (family === this.family && size === this.size) return;
    this.family = family;
    this.size = size;
    this.widths.clear();
    this.digitW.clear();
  }

  fontSize(): number { return this.size; }

  font(weight: number): string {
    return `${weight} ${this.size}px ${this.family}`;
  }

  /** Width in CSS px of `text` at `weight`, tabular figures. Cached. */
  measure(text: string, weight = 400): number {
    const key = `${weight}|${text}`;
    const hit = this.widths.get(key);
    if (hit !== undefined) return hit;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.font = this.font(weight);
    this.ctx.direction = 'ltr';
    const dw = this.digitWidth(weight);
    let w = 0;
    let run = '';
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 48 && c <= 57) {
        if (run) { w += this.runWidth(run, weight); run = ''; }
        w += dw;
      } else run += text[i];
    }
    if (run) w += this.runWidth(run, weight);
    this.ctx.restore();
    if (this.widths.size > 4000) this.widths.clear();
    this.widths.set(key, w);
    return w;
  }

  /** Natural width of a run, with the font already set on the context. Cached. */
  private runWidth(run: string, weight: number): number {
    const key = `r${weight}|${run}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      w = this.ctx.measureText(run).width;
      this.widths.set(key, w);
    }
    return w;
  }

  private digitWidth(weight: number): number {
    let w = this.digitW.get(weight);
    if (w === undefined) {
      w = 0;
      for (let d = 0; d <= 9; d++) w = Math.max(w, this.ctx.measureText(String(d)).width);
      this.digitW.set(weight, w);
    }
    return w;
  }

  /**
   * Draw `text` with tabular figures. The context must already carry the CSS-px transform. `x` is the left edge,
   * centre or right edge per `align`; `y` is the vertical middle.
   */
  draw(text: string, x: number, y: number, color: string, weight = 400, align: 'left' | 'center' | 'right' = 'left'): void {
    const ctx = this.ctx;
    const total = this.measure(text, weight);
    let cx = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total;
    ctx.font = this.font(weight);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // Runs are placed left to right by hand: an RTL page must not flip them or eat the spaces between them.
    ctx.direction = 'ltr';
    const dw = this.digitWidth(weight);
    let run = '';
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 48 && c <= 57) {
        if (run) { ctx.fillText(run, cx, y); cx += this.runWidth(run, weight); run = ''; }
        const ch = text[i];
        ctx.fillText(ch, cx + (dw - this.runWidth(ch, weight)) / 2, y);
        cx += dw;
      } else run += text[i];
    }
    if (run) ctx.fillText(run, cx, y);
  }
}
