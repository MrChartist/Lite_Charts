// Inline styles written through the CSSOM (`style.setProperty`), never as `style="..."` markup, so a strict
// Content-Security-Policy (`style-src 'self'`) does not block them. Every property is written with `!important`, so
// a host page's broad rules (`canvas { width: 100% !important }`, `div { padding: 1em }`) cannot reach inside.

/** Properties a host page commonly sets on every div, canvas or link; reset on each element the chart creates. */
export const BASE_RESET: Readonly<Record<string, string>> = {
  margin: '0',
  padding: '0',
  border: '0',
  'border-radius': '0',
  'box-sizing': 'border-box',
  'max-width': 'none',
  'max-height': 'none',
  'min-width': '0',
  'min-height': '0',
  float: 'none',
  transform: 'none',
  filter: 'none',
  opacity: '1',
  background: 'none',
  'box-shadow': 'none',
  outline: 'none',
  'text-decoration': 'none',
  'text-transform': 'none',
  'letter-spacing': 'normal',
  'line-height': 'normal',
  visibility: 'visible',
};

/** Write `props` (kebab-case names) as important inline styles. */
export function css(el: { style: CSSStyleDeclaration }, props: Readonly<Record<string, string>>): void {
  for (const k of Object.keys(props)) el.style.setProperty(k, props[k], 'important');
}

/** Reset an element, then write `props`. */
export function cssReset(el: { style: CSSStyleDeclaration }, props: Readonly<Record<string, string>> = {}): void {
  css(el, BASE_RESET);
  css(el, props);
}
