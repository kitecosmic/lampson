// sidebar.js — secciones acordeón de los paneles laterales y plegado de cada panel
function setSec(name, open) {
  const s = document.querySelector(`.sec[data-sec="${name}"]`); if (!s) return;
  s.classList.toggle('open', open);
  s.querySelector('.caret').textContent = open ? '▾' : '▸';
}
// sin preferencia del usuario, una sección se abre sola solo si tiene contenido
function autoSec(name, hasContent) {
  const pref = localStorage.getItem('lampson.sec.' + name);
  setSec(name, pref === null ? hasContent : pref === '1');
}
document.querySelectorAll('.sec h2').forEach(h => h.onclick = () => {
  const s = h.closest('.sec'); const open = !s.classList.contains('open');
  localStorage.setItem('lampson.sec.' + s.dataset.sec, open ? '1' : '0');
  setSec(s.dataset.sec, open);
});
for (const s of document.querySelectorAll('.sec')) {
  const pref = localStorage.getItem('lampson.sec.' + s.dataset.sec);
  if (pref !== null) setSec(s.dataset.sec, pref === '1');
}
// plegar/desplegar: cerrado = barra angosta con su icono; preferencia por lado en localStorage
function sideSet(which, closed) {
  document.body.classList.toggle(which + '-closed', closed);
  const a = document.querySelector(which === 'l' ? 'aside:not(.right)' : 'aside.right'); if (a) a.classList.toggle('closed', closed);
  try { localStorage.setItem('lampson.side.' + which, closed ? '1' : '0'); } catch (e) {}
}
for (const which of ['l', 'r']) {
  const a = document.querySelector(which === 'l' ? 'aside:not(.right)' : 'aside.right'); if (!a) continue;
  a.querySelector('.fold').onclick = () => sideSet(which, true);
  a.querySelector('.rail button').onclick = () => sideSet(which, false);
  let pref = null; try { pref = localStorage.getItem('lampson.side.' + which); } catch (e) {}
  if (pref === '1') sideSet(which, true);
}
