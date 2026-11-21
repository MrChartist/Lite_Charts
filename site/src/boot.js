// Runs in <head> before the first paint (a small blocking file, not an inline script, so a strict CSP needs no
// 'unsafe-inline'): marks JavaScript as present, applies a remembered theme so there is no flash of the wrong one,
// and over http(s) adds the font preloads and the @font-face sheet (browsers refuse fonts over file://).
(function () {
  var d = document.documentElement;
  d.classList.add('js');
  try {
    var t = localStorage.getItem('cl-theme');
    if (t === 'dark' || t === 'light') d.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: follow the system */ }
  if (location.protocol === 'file:') return;
  var base = d.getAttribute('data-assets') || 'assets/';
  ['fonts/chartist-sans-flex/chartist-sans-flex.woff2', 'fonts/chartist-sans/chartist-sans.woff2'].forEach(function (f) {
    var l = document.createElement('link');
    l.rel = 'preload'; l.as = 'font'; l.type = 'font/woff2'; l.crossOrigin = 'anonymous'; l.href = base + f;
    document.head.appendChild(l);
  });
  var s = document.createElement('link');
  s.rel = 'stylesheet'; s.href = base + 'fonts.css';
  document.head.appendChild(s);
})();
