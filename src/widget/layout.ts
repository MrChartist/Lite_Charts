// Responsive collapse of a bar: which items stay and which go into the "More" menu. Pure: widths are measured once
// (on a resize), never per frame.

export interface BarItem {
  id: string;
  /** CSS px the item takes, gap included. */
  width: number;
  /** Higher stays longer. Items at or above `KEEP` never collapse. */
  priority: number;
}

export const KEEP = 1000;

/**
 * Items that fit in `available` px, dropping the lowest priority first (ties: the later item goes first). When anything
 * is dropped, `moreWidth` px are reserved for the More button. Order is kept.
 */
export function collapseBar(items: readonly BarItem[], available: number, moreWidth: number): { visible: string[]; overflow: string[] } {
  const total = items.reduce((a, b) => a + b.width, 0);
  if (total <= available) return { visible: items.map(i => i.id), overflow: [] };
  const order = items.map((it, idx) => ({ it, idx })).filter(x => x.it.priority < KEEP)
    .sort((a, b) => a.it.priority - b.it.priority || b.idx - a.idx);
  const dropped = new Set<string>();
  let used = total + moreWidth;
  for (const { it } of order) {
    if (used <= available) break;
    dropped.add(it.id);
    used -= it.width;
  }
  return { visible: items.filter(i => !dropped.has(i.id)).map(i => i.id), overflow: items.filter(i => dropped.has(i.id)).map(i => i.id) };
}

/** Menus become bottom sheets at phone width or on a narrow coarse pointer. */
export function useSheets(width: number, coarse: boolean): boolean {
  return width < 560 || (coarse && width < 760);
}
