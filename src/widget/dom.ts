// Small DOM helpers for the widget chrome: element builders, and the layer stack for menus, sheets and dialogs (focus
// moves in and is trapped, Escape closes and returns focus to the control that opened it, a press outside closes).

import { svgIcon } from './icons';

export type Attrs = Record<string, string | number | boolean | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = '', attrs: Attrs = {}, kids: (Node | string | null | undefined)[] = []): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined) el.append(c);
  return el;
}

/** A button: icon and/or text; `label` is its accessible name and tooltip. */
export function btn(doc: Document, opts: { icon?: string; text?: string; label: string; cls?: string; attrs?: Attrs; onClick?: (ev: MouseEvent) => void; iconPx?: number }): HTMLButtonElement {
  const iconOnly = !!opts.icon && !opts.text;
  const b = h(doc, 'button', `b${iconOnly ? ' i' : ''}${opts.cls ? ` ${opts.cls}` : ''}`, { type: 'button', 'aria-label': opts.label, title: opts.label, ...opts.attrs });
  if (opts.icon) b.append(svgIcon(doc, opts.icon, opts.iconPx ?? 20));
  if (opts.text) b.append(h(doc, 'span', 't', {}, [opts.text]));
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea,[tabindex]:not([tabindex="-1"])';

export interface LayerOptions {
  /** The control that opened it (focus returns there). */
  opener?: HTMLElement | null;
  /** 'menu': arrow keys move between items; 'dialog': Tab is trapped. */
  kind: 'menu' | 'dialog';
  /** Bottom sheet (phones) instead of a popover. */
  sheet?: boolean;
  /** A dimmed scrim behind (dialogs and sheets). */
  scrim?: boolean;
  onClose?: () => void;
  /** Element to focus first. */
  focus?: HTMLElement | null;
}

interface Layer { el: HTMLElement; scrim: HTMLElement | null; opts: LayerOptions; close: (returnFocus: boolean) => void }

/** The open menus and dialogs of one widget, topmost last. */
export class Layers {
  private stack: Layer[] = [];
  constructor(private host: HTMLElement, private root: ShadowRoot) {}

  get open(): boolean { return this.stack.length > 0; }
  top(): HTMLElement | null { return this.stack.length ? this.stack[this.stack.length - 1].el : null; }

  /** Show `el` (already filled) as a layer. Returns a function that closes it. */
  push(el: HTMLElement, opts: LayerOptions): (returnFocus?: boolean) => void {
    const doc = this.host.ownerDocument;
    let scrim: HTMLElement | null = null;
    if (opts.scrim || opts.sheet) {
      scrim = h(doc, 'div', `scrim${opts.scrim || opts.sheet ? '' : ' clear'}`);
      scrim.addEventListener('pointerdown', ev => { ev.preventDefault(); close(true); });
      this.host.appendChild(scrim);
    }
    if (opts.sheet) { el.classList.add('sheet'); el.prepend(h(doc, 'div', 'grip', { 'aria-hidden': 'true' })); }
    this.host.appendChild(el);
    let closed = false;
    const close = (returnFocus = true): void => {
      if (closed) return;
      closed = true;
      // Close the layers above this one first.
      const i = this.stack.findIndex(l => l.el === el);
      if (i >= 0) { for (const l of this.stack.slice(i + 1).reverse()) l.close(false); this.stack.splice(i, 1); }
      el.remove();
      scrim?.remove();
      try { opts.onClose?.(); } catch { /* the caller's hook must not keep a layer open */ }
      if (returnFocus && opts.opener && opts.opener.isConnected) opts.opener.focus();
    };
    const layer: Layer = { el, scrim, opts, close };
    this.stack.push(layer);
    el.addEventListener('keydown', ev => this.key(ev, layer));
    const first = opts.focus ?? (opts.kind === 'menu' ? (el.querySelector('[aria-checked="true"]') as HTMLElement | null) ?? el.querySelector<HTMLElement>('[role^="menuitem"]') : el.querySelector<HTMLElement>(FOCUSABLE));
    first?.focus({ preventScroll: true });
    return close;
  }

  /** A press outside the topmost popover (no scrim) closes it. Called from the widget's pointerdown listener. */
  pointerDown(path: EventTarget[]): void {
    const l = this.stack[this.stack.length - 1];
    if (!l || l.scrim) return;
    if (path.includes(l.el) || (l.opts.opener && path.includes(l.opts.opener))) return;
    l.close(false);
  }

  closeAll(returnFocus = false): void {
    for (const l of [...this.stack].reverse()) l.close(returnFocus);
  }

  private key(ev: KeyboardEvent, l: Layer): void {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); l.close(true); return; }
    const items = Array.from(l.el.querySelectorAll<HTMLElement>(l.opts.kind === 'menu' ? '[role^="menuitem"]:not([aria-disabled="true"])' : FOCUSABLE))
      .filter(e => e.offsetParent !== null || e === this.root.activeElement);
    if (!items.length) return;
    const active = this.root.activeElement as HTMLElement | null;
    const i = active ? items.indexOf(active) : -1;
    if (ev.key === 'Tab') {
      if (l.opts.kind === 'menu') { l.close(false); return; }
      ev.preventDefault();
      const n = ev.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
      items[n].focus();
      return;
    }
    if (l.opts.kind !== 'menu') return;
    let n = -1;
    if (ev.key === 'ArrowDown') n = (i + 1) % items.length;
    else if (ev.key === 'ArrowUp') n = i <= 0 ? items.length - 1 : i - 1;
    else if (ev.key === 'Home') n = 0;
    else if (ev.key === 'End') n = items.length - 1;
    else if ((ev.key === 'Enter' || ev.key === ' ') && active && items.includes(active)) { ev.preventDefault(); active.click(); return; }
    if (n >= 0) { ev.preventDefault(); items[n].focus(); }
  }
}

/** Place a popover under (or above) `anchor`, inside `box` (both in client px), with an 8 px margin. */
export function placePopover(el: HTMLElement, anchor: DOMRect, box: DOMRect, prefer: 'below' | 'above' = 'below', align: 'start' | 'end' = 'start'): void {
  const w = el.offsetWidth, hgt = el.offsetHeight;
  let left = align === 'start' ? anchor.left - box.left : anchor.right - box.left - w;
  left = Math.max(8, Math.min(box.width - w - 8, left));
  const below = anchor.bottom - box.top + 6;
  const above = anchor.top - box.top - hgt - 6;
  let top = prefer === 'below' ? (below + hgt <= box.height - 8 || above < 8 ? below : above) : (above >= 8 ? above : below);
  top = Math.max(8, Math.min(box.height - hgt - 8, top));
  el.style.setProperty('left', `${Math.round(left)}px`);
  el.style.setProperty('top', `${Math.round(top)}px`);
}
