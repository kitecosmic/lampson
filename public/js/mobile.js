// mobile.js — la vista de celular (≤ 900 px; en escritorio no hace nada). Decisiones del usuario (2026-09-28):
//   * barra inferior al alcance del pulgar: Chat · Sesiones (el panel izquierdo entero) · Archivos · Más
//   * agente, permisos, modelo y plugins como chips sobre la caja de texto (hoy la fila del header rompía el ancho:
//     la página medía 1060 px en una pantalla de 390)
// Los controles se MUEVEN (appendChild), no se copian: sus listeners siguen andando; al volver a escritorio vuelven
// a su lugar. Todo lo que se muestra en el centro pasa por showPane() (sesión, archivo, log, terminal): envuelto,
// en el celular te lleva solo a la pestaña Chat.
(function () {
  const mq = window.matchMedia('(max-width: 900px)');
  const ICON = {
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    side: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  };
  const svg = (k) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
  let bar = null, chips = null, sheet = null, newBtn = null, moved = [], on = false, placeholder = null;

  function setTab(t) {
    document.body.dataset.mtab = t;
    if (bar) bar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  }

  function build() {
    bar = document.createElement('nav');
    bar.className = 'mtabs';
    bar.innerHTML = [['chat', 'Chat'], ['side', 'Sesiones'], ['files', 'Archivos'], ['more', 'Más']]
      .map(([t, l]) => `<button type="button" data-t="${t}">${svg(t)}<span>${l}</span><i class="badge" hidden></i></button>`).join('');
    bar.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t === 'more') openMore(); else setTab(b.dataset.t);
    };
    document.body.appendChild(bar);
    chips = document.createElement('div');
    chips.className = 'mchips';
    // «+ nueva sesión» arriba de la lista de sesiones (en escritorio está en el header)
    newBtn = document.createElement('button');
    newBtn.type = 'button'; newBtn.className = 'mnew'; newBtn.textContent = '+ nueva sesión';
    newBtn.onclick = () => { const n = document.getElementById('new'); if (n) n.click(); setTab('chat'); };
    // aprobaciones pendientes: un número sobre «Sesiones» para no perderlas de vista
    const cnt = document.getElementById('apprCount');
    if (cnt) new MutationObserver(badge).observe(cnt, { childList: true, characterData: true, subtree: true });
    // todo lo que se abre en el centro (sesión, archivo, log, terminal) vuelve a la pestaña Chat
    if (typeof window.showPane === 'function') {
      const orig = window.showPane;
      window.showPane = function (which) { const r = orig.apply(this, arguments); if (on) setTab('chat'); return r; };
    }
  }

  function badge() {
    const b = bar && bar.querySelector('button[data-t="side"] .badge'); if (!b) return;
    const n = parseInt((document.getElementById('apprCount') || {}).textContent || '0', 10);
    b.hidden = !(n > 0); b.textContent = n > 0 ? String(n) : '';
  }

  // los controles del header que van como chips sobre la caja de texto
  const CHIP_IDS = ['agent', 'perm', 'model', 'plugins', 'wsPill'];

  function attach() {
    if (!bar) build();
    const form = document.getElementById('f');
    if (form && chips.parentNode !== form) form.insertBefore(chips, form.firstChild);
    moved = [];
    for (const id of CHIP_IDS) {
      const el = document.getElementById(id); if (!el) continue;
      moved.push({ el, parent: el.parentNode, next: el.nextSibling });
      chips.appendChild(el);
    }
    const aside = document.querySelector('aside:not(.right)');
    if (aside && newBtn.parentNode !== aside) aside.insertBefore(newBtn, aside.firstChild);
    const ta = document.getElementById('in');
    if (ta) { placeholder = ta.placeholder; ta.placeholder = 'Escribí… · !comando lo corrés vos'; }
    document.body.classList.add('mobile');
    on = true;
    setTab(document.body.dataset.mtab || 'chat');
    badge();
  }

  function detach() {
    for (const m of moved.reverse()) m.parent.insertBefore(m.el, m.next && m.next.parentNode === m.parent ? m.next : null);
    moved = [];
    if (newBtn && newBtn.parentNode) newBtn.parentNode.removeChild(newBtn);
    const ta = document.getElementById('in');
    if (ta && placeholder != null) ta.placeholder = placeholder;
    closeMore();
    document.body.classList.remove('mobile');
    delete document.body.dataset.mtab;
    on = false;
  }

  // «Más»: lo que en escritorio vive en el header (terminal, configuración, tema, workspaces) y dónde estás
  function openMore() {
    closeMore();
    const click = (id) => () => { closeMore(); const el = document.getElementById(id); if (el) el.click(); };
    const path = (document.getElementById('hpath') || {}).textContent || '';
    const git = (document.getElementById('git') || {}).innerHTML || '';
    const upd = document.getElementById('update');
    sheet = document.createElement('div');
    sheet.className = 'msheet';
    sheet.innerHTML = `<div class="mback"></div><div class="mcard">
      <div class="mwhere">${git ? `<div class="mgit">${git}</div>` : ''}<div class="mpath">${esc(path)}</div></div>
      ${upd && upd.style.display !== 'none' ? `<button type="button" data-a="update">${esc(upd.textContent || 'actualizar')}</button>` : ''}
      <button type="button" data-a="term">&gt;_ terminal</button>
      <button type="button" data-a="cfg">⚙ configuración</button>
      <button type="button" data-a="theme">◐ cambiar tema</button>
      <button type="button" data-a="hub">⌂ workspaces</button>
      <button type="button" data-a="close" class="mcancel">cerrar</button></div>`;
    const acts = { update: click('update'), term: click('term'), cfg: click('cfgBtn'), theme: click('theme'), hub: () => { location.href = '/'; }, close: closeMore };
    sheet.onclick = (e) => {
      if (e.target.classList.contains('mback')) return closeMore();
      const b = e.target.closest('button[data-a]'); if (b && acts[b.dataset.a]) acts[b.dataset.a]();
    };
    document.body.appendChild(sheet);
  }
  function closeMore() { if (sheet) { sheet.remove(); sheet = null; } }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function apply() { if (mq.matches && !on) attach(); else if (!mq.matches && on) detach(); }
  // después de que app.js armó el header (los selects se llenan al arrancar)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
  (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply));
})();
