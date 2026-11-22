// The widget's own icons: single-colour line drawings on a 24 grid, 1.8 stroke, round caps and joins, one idea each
// (the same house rules as the drawing rail). Filled shapes are marked with a leading 'F:'.

export const WIDGET_ICONS: Readonly<Record<string, string>> = {
  search: 'M15.5 15.5L20 20M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 1 1 13 0',
  chevron: 'M7 10l5 5 5-5',
  chevronUp: 'M7 14l5-5 5 5',
  candles: 'M7 3.5v3M7 15.5v5M4.5 6.5h5v9h-5zM17 3.5v5M17 17.5v3M14.5 8.5h5v9h-5z',
  hollow: 'M7 3.5v3M7 15.5v5M4.5 6.5h5v9h-5zM17 3.5v5M17 17.5v3M14.5 8.5h5v9h-5z',
  bars: 'M8 4v16M4.5 8H8M8 15h3.5M16 6v13M12.5 10H16M16 16h3.5',
  line: 'M3.5 17l5-6 4 3.5 8-9',
  step: 'M3.5 18H8v-6h5V8h4V5h3.5',
  area: 'M3.5 16l5-6 4 3.5 8-8.5M3.5 20.5h17',
  baseline: 'M3.5 15.5l4-6 4 4 3-5 6 7M3 12h2M8 12h2M13 12h2M18 12h3',
  columns: 'M5 20.5v-8M10 20.5V7M15 20.5v-5M20 20.5V10',
  heikin: 'M7 4v2.5M7 15.5V20M4.5 6.5h5v9h-5zM17 6v2M17 18v2M14.5 8h5v10h-5zM9.5 11h5',
  renko: 'M3.5 20.5h5v-5h-5zM8.5 15.5h5v-5h-5zM13.5 10.5h5v-5h-5z',
  kagi: 'M4 18V9h5v8h5V5h6v9',
  pnf: 'M4.5 5l4 4M8.5 5l-4 4M4.5 15l4 4M8.5 15l-4 4M17 7.5a2.5 2.5 0 1 1-.01 0M17 14.5a2.5 2.5 0 1 1-.01 0',
  linebreak: 'M4 20.5v-6h4v-4h4v-4h4v10h4',
  range: 'M5 18V11M9 15V8M13 13V5M17 10v8M21 12v7M3.5 11h3M7.5 8h3M11.5 5h3M15.5 18h3M19.5 19h3',
  hlc: 'M3.5 9l5-4 4 3 8-4M3.5 19l5-5 4 3 8-6M3.5 14l5-4.5 4 3 8-5',
  indicators: 'M3.5 19.5c3-9 5-13 7-13s2.5 6 4.5 6 3-3.5 5.5-6.5M3.5 4.5v15h17',
  compare: 'M3.5 17.5l5-5 3.5 3 8.5-9M3.5 11l5 2 3.5-4 8.5 3',
  undo: 'M9 5.5L4 10.5l5 5M4 10.5h10.5a5 5 0 0 1 0 10H12',
  redo: 'M15 5.5l5 5-5 5M20 10.5H9.5a5 5 0 0 0 0 10H12',
  camera: 'M3.5 8.5a2 2 0 0 1 2-2h2.5l1.5-2h5l1.5 2h2.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0',
  expand: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  shrink: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  sun: 'M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  pencil: 'M4.5 19.5l1-4.5L16 4.5l3.5 3.5L9 18.5zM13.5 7l3.5 3.5',
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  replay: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v3.5H8M10.5 9l4 3-4 3z',
  calendar: 'M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4',
  clock: 'M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 1 1 17 0M12 7.5V12l3 2',
  latest: 'M6 7l5 5-5 5M12.5 7l5 5-5 5M20.5 5v14',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  eye: 'M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0',
  eyeOff: 'M4 4l16 16M9.9 6.2A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.6 3.2M6.6 7.6A15.6 15.6 0 0 0 2.5 12s3.5 6 9.5 6a9.3 9.3 0 0 0 4.2-1',
  gear: 'M20.9 10.9V13.1L18.5 13.8L17.9 15.3L19.1 17.6L17.6 19.1L15.3 17.9L13.8 18.5L13.1 20.9H10.9L10.2 18.5L8.7 17.9L6.4 19.1L4.9 17.6L6.1 15.3L5.5 13.8L3.1 13.1V10.9L5.5 10.2L6.1 8.7L4.9 6.4L6.4 4.9L8.7 6.1L10.2 5.5L10.9 3.1H13.1L13.8 5.5L15.3 6.1L17.6 4.9L19.1 6.4L17.9 8.7L18.5 10.2zM14.8 12a2.8 2.8 0 1 1-5.6 0 2.8 2.8 0 1 1 5.6 0',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13',
  up: 'M12 19V5M6.5 10.5L12 5l5.5 5.5',
  down: 'M12 5v14M6.5 13.5L12 19l5.5-5.5',
  maximise: 'M4.5 4.5h15v15h-15zM4.5 9h15',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  globe: 'M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 1 1 17 0M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5',
};

const SVG = 'http://www.w3.org/2000/svg';

/** An icon as an SVG element (aria-hidden; the button names it). */
export function svgIcon(doc: Document, name: string, px = 20): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const d = WIDGET_ICONS[name] ?? '';
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  if (name === 'more') path.setAttribute('stroke-width', '2.6');
  svg.appendChild(path);
  return svg;
}
