// theme.js — tema día / noche (el valor inicial ya lo puso el script del <head>)
const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.7v2.1M12 19.2v2.1M2.7 12h2.1M19.2 12h2.1M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"/></svg>';
const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z"/></svg>';
function paintTheme() { const light = document.documentElement.getAttribute('data-theme') === 'light'; $('#theme').innerHTML = light ? MOON : SUN; $('#theme').title = light ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'; }
$('#theme').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'light' ? 'dark' : 'light'); try { localStorage.setItem('lampson.theme', r.getAttribute('data-theme')); } catch (e) {} paintTheme(); if (typeof termsRetheme === 'function') termsRetheme(); };
paintTheme();
