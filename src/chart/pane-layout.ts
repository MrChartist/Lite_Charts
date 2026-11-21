// Vertical layout of stacked panes. Pure.
//
// Panes share the height left after the time axis, in proportion to their stretch factors, with a separator of
// `separator` px between neighbours. Heights are whole CSS px (the remainder goes to the first pane) and no pane is
// shorter than `minHeight` when there is room for all of them.

export interface PaneBox { top: number; height: number }

export function layoutPanes(stretch: readonly number[], total: number, separator: number, minHeight: number): PaneBox[] {
  const n = stretch.length;
  if (n === 0) return [];
  const avail = Math.max(0, Math.floor(total) - separator * (n - 1));
  const weights = stretch.map(s => (Number.isFinite(s) && s > 0 ? s : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const heights = weights.map(w => Math.floor((avail * w) / sum));
  // Lift short panes to the minimum, taking the height from the tallest panes, when everything fits.
  const floor = n * minHeight <= avail ? minHeight : Math.floor(avail / n);
  for (let i = 0; i < n; i++) {
    while (heights[i] < floor) {
      let tallest = -1;
      for (let k = 0; k < n; k++) if (k !== i && heights[k] > floor && (tallest < 0 || heights[k] > heights[tallest])) tallest = k;
      if (tallest < 0) break;
      const take = Math.min(floor - heights[i], heights[tallest] - floor);
      heights[i] += take;
      heights[tallest] -= take;
    }
  }
  const used = heights.reduce((a, b) => a + b, 0);
  heights[0] += avail - used;
  const out: PaneBox[] = [];
  let top = 0;
  for (let i = 0; i < n; i++) {
    out.push({ top, height: heights[i] });
    top += heights[i] + separator;
  }
  return out;
}

/**
 * Move the separator below pane `i` by `dy` px (positive = down): pane i grows, pane i + 1 shrinks by the same
 * amount, neither below `minHeight`. Returns the new heights (the input is not changed).
 */
export function moveSeparator(heights: readonly number[], i: number, dy: number, minHeight: number): number[] {
  const out = heights.slice();
  if (i < 0 || i + 1 >= out.length || !Number.isFinite(dy)) return out;
  const pair = out[i] + out[i + 1];
  const lo = Math.min(minHeight, pair / 2);
  const a = Math.max(lo, Math.min(pair - lo, out[i] + dy));
  out[i] = a;
  out[i + 1] = pair - a;
  return out;
}

/** The pane index at chart y (CSS px), or -1 when y falls on a separator or outside the panes. */
export function paneAt(boxes: readonly PaneBox[], y: number): number {
  for (let i = 0; i < boxes.length; i++) if (y >= boxes[i].top && y < boxes[i].top + boxes[i].height) return i;
  return -1;
}

/**
 * The stretch factor that gives pane `i` a height of `px` while the other panes keep their factors (all heights
 * proportional to factors over `avail` px).
 */
export function stretchForHeight(stretch: readonly number[], i: number, px: number, avail: number): number {
  let others = 0;
  for (let k = 0; k < stretch.length; k++) if (k !== i) others += stretch[k];
  if (others <= 0) return stretch[i] > 0 ? stretch[i] : 1;
  const h = Math.max(1, Math.min(avail - 1, px));
  return (h * others) / Math.max(1, avail - h);
}
