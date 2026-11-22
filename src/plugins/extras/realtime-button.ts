// Go to realtime: a small round button near the right edge of the plot that appears only while the newest bar is
// scrolled out of view, and scrolls back to it. DOM in a shadow root, keyboard operable, no motion under reduced motion.

import type { ChartApi } from '../../api';
import type { Removable } from './common';
import { createHost, css, focusRing, iconEl, make, reducedMotion, removable, surfaceStyle, useChartUi } from './common';

export interface GoToRealtimeOptions {
  /** Distance in CSS px from the plot's right edge and from the top pane's bottom edge. Default 12 and 12. */
  right: number;
  bottom: number;
  /** Accessible name. Default 'Go to the latest bar'. */
  label: string;
}

export interface GoToRealtimeHandle extends Removable {
  applyOptions(options: Partial<GoToRealtimeOptions>): void;
  /** True while the button is showing. */
  visible(): boolean;
}

/** The newest bar is out of view once its centre has left the plot: `scrollPosition` is the bars between it and the right edge. */
export function newestBarHidden(scrollPosition: number): boolean {
  return scrollPosition < -0.5;
}

const SIZE = 36;

export function createGoToRealtimeButton(chart: ChartApi, options: Partial<GoToRealtimeOptions> = {}): GoToRealtimeHandle {
  let opts: GoToRealtimeOptions = { right: 12, bottom: 12, label: 'Go to the latest bar', ...options };
  const ui = useChartUi(chart);
  const dom = createHost(chart, 'realtime-button', true, 3);
  const btn = make(dom.doc, 'button', {
    position: 'absolute', left: '0', top: '0', width: `${SIZE}px`, height: `${SIZE}px`, 'border-radius': `${SIZE / 2}px`, display: 'flex',
    'align-items': 'center', 'justify-content': 'center', cursor: 'pointer', 'pointer-events': 'auto', appearance: 'none', '-webkit-appearance': 'none',
    opacity: '0', visibility: 'hidden', 'touch-action': 'manipulation',
  }, dom.root) as HTMLButtonElement;
  btn.type = 'button';
  btn.appendChild(iconEl(dom.doc, 'M5 6l6 6-6 6M12 6l6 6-6 6M20.5 5v14', 18, 2));
  btn.setAttribute('aria-label', opts.label);
  btn.title = opts.label;
  focusRing(btn, () => ui.state().colors.focusRing);
  let colorKey = '';
  let shown = false;

  const paintTheme = (): void => {
    const s = ui.state();
    if (colorKey === s.colors.background + s.colors.text) return;
    colorKey = s.colors.background + s.colors.text;
    css(btn, { ...surfaceStyle(s), color: s.colors.text });
  };

  const sync = (): void => {
    const s = ui.state();
    paintTheme();
    const want = newestBarHidden(chart.timeScale().scrollPosition()) && s.plot.width > SIZE * 3;
    const x = Math.round(s.plot.x + s.plot.width - SIZE - opts.right);
    const y = Math.round(s.plot.y + s.plot.height - SIZE - opts.bottom);
    css(btn, { transform: `translate(${x}px, ${y}px)` });
    if (want === shown) return;
    shown = want;
    const motion = !reducedMotion(chart);
    css(btn, {
      opacity: want ? '1' : '0',
      visibility: want ? 'visible' : 'hidden',
      transition: motion ? `opacity 140ms ease-out, visibility 0s linear ${want ? '0s' : '140ms'}` : 'none',
    });
  };

  const onClick = (): void => {
    chart.timeScale().scrollToRealTime();
    chart.element().focus({ preventScroll: true });
  };
  btn.addEventListener('click', onClick);
  const off = ui.onFrame(sync);
  sync();

  return removable({
    applyOptions(patch: Partial<GoToRealtimeOptions>) {
      opts = { ...opts, ...patch };
      btn.setAttribute('aria-label', opts.label);
      btn.title = opts.label;
      sync();
    },
    visible: () => shown,
  }, () => { off(); btn.removeEventListener('click', onClick); dom.destroy(); ui.release(); });
}
