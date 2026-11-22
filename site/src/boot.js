// Runs in <head> before the first paint (a small blocking file, not an inline script, so a strict CSP needs no
// 'unsafe-inline'): marks JavaScript as present and applies a remembered theme so there is no flash of the wrong one.
// Without a remembered choice the page follows the system setting (prefers-color-scheme), through the stylesheet.
(function () {
  var d = document.documentElement;
  d.classList.add('js');
  try {
    var t = localStorage.getItem('cl-theme');
    if (t === 'dark' || t === 'light') d.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: follow the system */ }
})();
