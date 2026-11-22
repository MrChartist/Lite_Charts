// The widget's stylesheet, adopted as a constructable sheet in its shadow root (a CSSOM object: a strict CSP with
// `style-src 'self'` does not block it). `:host { all: initial }` cuts every inherited page style; the shadow root keeps
// page rules out. Colours are tokens on `.w`, switched by `.dark`. Motion is a short fade only, none when reduced.

export const WIDGET_CSS = `
:host{all:initial;display:block;position:relative;min-width:0;min-height:0;contain:layout paint;-webkit-text-size-adjust:100%}
:host([hidden]){display:none}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;border:0;font:inherit;color:inherit;background:none;letter-spacing:normal;text-transform:none;text-decoration:none;text-align:left;line-height:inherit;outline:none;box-shadow:none;float:none;max-width:none;min-width:0}
svg{display:block;flex:none;pointer-events:none}
.w{--bar:#F2F2F5;--card:#FFFFFF;--pop:#FFFFFF;--ink:#1D1D1F;--muted:#64646A;--edge:rgba(60,60,67,.13);--hover:rgba(60,60,67,.075);--press:rgba(60,60,67,.13);--focus:#0066CC;--scrim:rgba(0,0,0,.22);--shadow:0 0 0 .5px rgba(0,0,0,.12),0 10px 30px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.06);--up:#1E7E37;--down:#C8161F;--warn:#B25000;--field:#F2F2F5;--h:28px;--bh:40px;
position:absolute;top:0;right:0;bottom:0;left:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:var(--bar);color:var(--ink);overflow:hidden;
font:400 13px/1.3 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;font-variant-numeric:tabular-nums;direction:ltr;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.w.dark{--bar:#0F0F11;--card:#141414;--pop:#1E1E20;--ink:#F5F5F7;--muted:#9C9CA2;--edge:rgba(235,235,245,.11);--hover:rgba(235,235,245,.08);--press:rgba(235,235,245,.14);--focus:#0A84FF;--scrim:rgba(0,0,0,.5);--shadow:0 0 0 .5px rgba(255,255,255,.12),0 12px 34px rgba(0,0,0,.5);--up:#30D158;--down:#FF6961;--warn:#FF9F0A;--field:#2A2A2D}
.w.coarse{--h:44px;--bh:52px}
.bar{display:flex;align-items:center;gap:2px;height:var(--bh);padding:0 8px;min-width:0;white-space:nowrap}
.top{padding-top:2px}
.bot{padding-bottom:2px}
.grp{display:flex;align-items:center;gap:2px;flex:none}
.sp{flex:1 1 0;min-width:4px}
.sep{flex:none;width:1px;height:16px;background:var(--edge);margin:0 6px}
.stage{position:relative;min-height:0;min-width:0}
.card{position:absolute;top:0;right:6px;bottom:0;left:6px;border-radius:10px;background:var(--card);box-shadow:0 0 0 1px var(--edge);overflow:hidden;isolation:isolate}
.plot{position:absolute;top:0;right:0;bottom:0;left:0}
.b{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:none;height:var(--h);min-width:var(--h);padding:0 9px;border-radius:calc(var(--h) / 2);color:var(--ink);font-weight:500;cursor:pointer;transition:background-color .12s}
.b:hover{background:var(--hover)}
.b:active{background:var(--press)}
.b:focus-visible,.mi:focus-visible,.row:focus-visible,.f:focus-visible,.sw:focus-visible{box-shadow:0 0 0 2px var(--focus)}
.b.i{width:var(--h);padding:0}
.b[aria-pressed=true],.b.on{background:var(--ink);color:var(--bar)}
.b[disabled]{opacity:.35;cursor:default;background:none}
.k{color:var(--muted);padding:0 7px;min-width:30px}
.k[aria-checked=true]{color:var(--ink);font-weight:600}
.sym{padding:0 10px 0 8px;gap:8px;max-width:260px}
.sym .n{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis}
.sym .d{color:var(--muted);font-weight:400;overflow:hidden;text-overflow:ellipsis}
.sym.plain{cursor:default}
.sym.plain:hover{background:none}
.st{display:inline-flex;align-items:center;gap:6px;flex:none;height:22px;padding:0 9px 0 8px;border-radius:11px;color:var(--muted);font-size:12px;font-weight:500}
.dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.st[data-s=live] .dot{color:var(--up)}
.st[data-s=connecting] .dot,.st[data-s=reconnecting] .dot{color:var(--warn)}
.st[data-s=error] .dot,.st[data-s=offline] .dot{color:var(--down)}
.clk{color:var(--muted);font-weight:500;gap:6px}
.chev{opacity:.7;margin:0 -3px 0 -2px}
.hide{display:none!important}
.menu{position:absolute;z-index:40;display:flex;flex-direction:column;gap:1px;min-width:200px;max-width:min(340px,calc(100% - 16px));max-height:min(440px,calc(100% - 16px));overflow:auto;padding:5px;border-radius:12px;background:var(--pop);box-shadow:var(--shadow);animation:fade .12s ease-out;overscroll-behavior:contain;scrollbar-width:thin}
.menu.sheet,.dlg.sheet{left:0!important;right:0!important;bottom:0!important;top:auto!important;width:auto!important;max-width:none;max-height:78%;border-radius:16px 16px 0 0;padding:8px 8px max(10px,env(safe-area-inset-bottom));transform:none}
.grip{align-self:center;width:36px;height:5px;border-radius:3px;background:var(--edge);margin:2px 0 8px;flex:none}
.mh{padding:8px 10px 4px;color:var(--muted);font-size:12px;font-weight:600}
.mi{display:flex;align-items:center;gap:10px;min-height:32px;padding:0 10px;border-radius:8px;cursor:pointer;white-space:nowrap;flex:none}
.coarse .mi{min-height:44px}
.mi:hover{background:var(--hover)}
.mi[aria-checked=true]{background:var(--ink);color:var(--pop)}
.mi[aria-checked=true] .x{color:inherit;opacity:.75}
.mi .t{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.mi .x{color:var(--muted);font-size:12px}
.mi[aria-disabled=true]{opacity:.4;cursor:default}
.msep{height:1px;background:var(--edge);margin:4px 6px;flex:none}
.scrim{position:absolute;top:0;right:0;bottom:0;left:0;z-index:35;background:var(--scrim);animation:fade .16s ease-out}
.scrim.clear{background:transparent}
.dlg{position:absolute;z-index:45;left:50%;top:44px;transform:translateX(-50%);display:flex;flex-direction:column;width:min(600px,calc(100% - 24px));max-height:calc(100% - 64px);border-radius:14px;background:var(--pop);box-shadow:var(--shadow);animation:fade .14s ease-out;overflow:hidden}
.dh{display:flex;align-items:center;gap:8px;padding:12px 12px 8px 16px;flex:none}
.dh .ttl{flex:1;font-size:15px;font-weight:600}
.db{overflow:auto;padding:4px 8px 12px;min-height:0;overscroll-behavior:contain;scrollbar-width:thin}
.df{display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--edge);flex:none}
.srch{display:flex;align-items:center;gap:8px;margin:0 8px 6px;height:36px;padding:0 10px;border-radius:10px;background:var(--field);color:var(--muted);flex:none}
.srch input{flex:1;height:100%;color:var(--ink);font-size:14px;user-select:text;-webkit-user-select:text}
input::placeholder{color:var(--muted);opacity:1}
.f{height:30px;padding:0 10px;border-radius:8px;background:var(--field);color:var(--ink);font-size:13px;min-width:0;user-select:text;-webkit-user-select:text;color-scheme:light}
.dark .f{color-scheme:dark}
select.f{padding-right:6px;cursor:pointer}
.fr{display:flex;align-items:center;gap:12px;min-height:40px;padding:0 8px}
.fr>label,.fr>.lb{flex:1 1 auto;color:var(--ink)}
.fr .f{width:140px}
.fs{padding:10px 8px 4px;color:var(--muted);font-size:12px;font-weight:600}
.pill{display:inline-flex;padding:2px;border-radius:16px;background:var(--field);gap:2px}
.pill .b{height:26px;min-width:26px;border-radius:13px;font-size:12px}
.coarse .pill .b{height:40px;border-radius:20px}
.pill .b[aria-checked=true]{background:var(--pop);color:var(--ink);box-shadow:0 0 0 .5px var(--edge),0 1px 3px rgba(0,0,0,.12)}
.sw{position:relative;width:38px;height:22px;border-radius:11px;background:var(--press);cursor:pointer;flex:none;transition:background-color .15s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:9px;background:#FFFFFF;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s}
.sw[aria-checked=true]{background:var(--up)}
.sw[aria-checked=true]::after{transform:translateX(16px)}
.cl{display:flex;gap:6px}
.cs{width:22px;height:22px;border-radius:11px;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
.cs[aria-checked=true]{box-shadow:0 0 0 2px var(--pop),0 0 0 4px var(--ink)}
.cols{display:grid;grid-template-columns:150px minmax(0,1fr);gap:4px;min-height:0;flex:1 1 auto}
.cats{display:flex;flex-direction:column;gap:1px;padding:0 0 8px 8px;overflow:auto}
.lst{overflow:auto;padding:0 8px 8px;min-height:0;scrollbar-width:thin}
.ind{display:flex;align-items:center;gap:10px;min-height:36px;padding:0 6px 0 10px;border-radius:8px}
.ind:hover,.ind:focus-within{background:var(--hover)}
.ind .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ind .x{color:var(--muted);font-size:12px}
.ind .acts{display:flex;gap:2px}
.ind .b{height:28px;min-width:28px}
.empty{padding:14px 10px;color:var(--muted)}
.lg{position:absolute;z-index:3;display:flex;flex-direction:column;align-items:flex-start;gap:2px;pointer-events:none;max-width:calc(100% - 80px)}
.row{pointer-events:auto;display:inline-flex;align-items:center;gap:6px;height:22px;max-width:100%;padding:0 4px 0 6px;border-radius:6px;background:var(--rowbg);font-size:12px;line-height:22px;white-space:nowrap;cursor:default}
.row .sw2{width:8px;height:8px;border-radius:4px;flex:none}
.row .nm{color:var(--ink);font-weight:600;overflow:hidden;text-overflow:ellipsis}
.row .v{color:var(--muted)}
.row.off .nm,.row.off .v{opacity:.5}
.row .acts{display:none;align-items:center;gap:0;margin-left:2px}
.row:hover .acts,.row:focus-within .acts,.row.tap .acts{display:inline-flex}
.row .acts .b{height:22px;min-width:22px;width:22px;border-radius:6px}
.coarse .row{height:32px}
.coarse .row .acts .b{height:32px;width:32px;min-width:32px}
.ov{position:absolute;top:0;right:0;bottom:0;left:0;z-index:6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:var(--card);color:var(--muted);text-align:center;padding:24px}
.ov .msg{font-size:14px;color:var(--ink);font-weight:500;text-align:center}
.ov .sub{font-size:12px;color:var(--muted);max-width:360px;text-align:center}
.ov .b.pri{background:var(--ink);color:var(--card);padding:0 16px}
.skel{position:absolute;left:24px;right:84px;top:22%;bottom:22%;display:flex;align-items:flex-end;gap:2.2%;opacity:.55}
.skel i{flex:1;border-radius:3px;background:var(--hover);animation:pulse 1.6s ease-in-out infinite}
.latest{position:absolute;z-index:4;height:28px;padding:0 10px 0 8px;border-radius:14px;background:var(--pop);color:var(--ink);box-shadow:var(--shadow);font-size:12px;animation:fade .14s ease-out}
.latest:hover{background:var(--pop)}
.tip{position:absolute;z-index:4;left:50%;top:10px;transform:translateX(-50%);padding:6px 12px;border-radius:14px;background:var(--ink);color:var(--card);font-size:12px;font-weight:500;pointer-events:none;animation:fade .12s ease-out}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
.w:fullscreen,.w.pseudo{position:fixed;z-index:2147483000;top:0;left:0;width:100%;height:100%}
@keyframes fade{from{opacity:0}}
@keyframes pulse{50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

const sheets = new WeakMap<object, CSSStyleSheet>();

/** The shared constructable sheet for a window, or null where constructable sheets are missing. */
export function widgetSheet(win: (Window & typeof globalThis) | null): CSSStyleSheet | null {
  if (!win || typeof win.CSSStyleSheet !== 'function') return null;
  let s = sheets.get(win);
  if (!s) {
    try { s = new win.CSSStyleSheet(); s.replaceSync(WIDGET_CSS); } catch { return null; }
    sheets.set(win, s);
  }
  return s;
}
