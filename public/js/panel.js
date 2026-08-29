// panel.js — EL componente modal de la app. Un cascarón y tres layouts; cada vista aporta solo su contenido.
//
//   Panel.open({ eyebrow, title, sub, size: 'lg'|'md'|'sm', layout: 'browse'|'tabs'|'form',
//                headActions: [{label, title, onClick}],   // botones chicos en la cabecera (p.ej. «?»)
//                noClose: bool,                             // sin ✕/Esc (onboarding)
//                onClose(),
//     browse: { placeholder, listWidth, load(q) → rows, render(row, q) → html de la fila, key(row) → id estable,
//               nodot: true (filas sin la columna del punto), detail(row, q) → html del panel derecho (puede ser async), wire(row, box) → engancha handlers,
//               onPick(row) → Enter / doble clic, count(rows, q) → texto del pie, emptyHtml, help: html },
//     tabs:   { tabs: [{id, label, html}], footer: html, wire(box), initial },
//     form:   { html, footer: html, wire(box) } })
//   Panel.close() · Panel.refresh() (browse: recarga la lista conservando la selección) · Panel.detail() (re-render
//   del detalle) · Panel.box (el elemento) · Panel.err(texto) (línea de error del pie) · Panel.is(id)
//
// Teclado en browse: ↑↓ mueven la selección (el detalle sigue), Enter = onPick, Esc cierra. Un solo panel abierto.
const Panel = (() => {
  let cur = null, rows = [], sel = 0, timer = null, seq = 0, overlay = null;
  const ICON_X = '✕';
  function ensure() {
    if (overlay) return overlay;
    overlay = document.createElement('div'); overlay.className = 'modal'; overlay.id = 'panel'; overlay.style.display = 'none';
    overlay.innerHTML = '<div class="panel"></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay && cur && !cur.noClose) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur && !cur.noClose) close(); });
    return overlay;
  }
  const box = () => ensure().querySelector('.panel');
  function head(spec) {
    const acts = (spec.headActions || []).map((a, i) => `<button class="pghost" data-ha="${i}" title="${esc(a.title || '')}">${esc(a.label)}</button>`).join('');
    return `<div class="phead"><span class="eyebrow">${esc(spec.eyebrow || '')}</span><h3>${esc(spec.title || '')}</h3><span class="sub">${esc(spec.sub || '')}</span><span class="spacer"></span>${acts}${spec.noClose ? '' : `<button class="pghost" data-close title="cerrar (Esc)">${ICON_X}</button>`}</div>`;
  }
  function open(spec) {
    cur = spec; rows = []; sel = 0; seq++;
    const b = box(); b.className = 'panel ' + (spec.size || (spec.layout === 'browse' ? 'lg' : 'md'));
    let body = '';
    if (spec.layout === 'browse') {
      const w = spec.browse.listWidth ? `style="--list-w:${spec.browse.listWidth}"` : '';
      body = `<div class="browse" ${w}><div class="blist"><input class="bsearch" spellcheck="false" autocomplete="off" placeholder="${esc(spec.browse.placeholder || 'buscar…')}"><div class="bitems"></div><div class="bcount"></div></div><div class="bdetail"></div></div>` + (spec.browse.help ? `<div class="phelp" style="display:none">${spec.browse.help}</div>` : '');
    } else if (spec.layout === 'tabs') {
      body = `<div class="ptabs">${spec.tabs.tabs.map(t => `<span class="ptab" data-tab="${esc(t.id)}">${esc(t.label)}</span>`).join('')}</div><div class="pbody">${spec.tabs.tabs.map(t => `<div class="pane" data-pane="${esc(t.id)}" style="display:none">${t.html}</div>`).join('')}</div>` + (spec.tabs.footer ? `<div class="pfoot">${spec.tabs.footer}<span class="err"></span></div>` : '');
    } else {
      body = `<div class="pbody">${spec.form.html}</div>` + (spec.form.footer ? `<div class="pfoot">${spec.form.footer}<span class="err"></span></div>` : '');
    }
    b.innerHTML = head(spec) + body;
    const x = b.querySelector('[data-close]'); if (x) x.onclick = close;
    b.querySelectorAll('[data-ha]').forEach(el => el.onclick = () => spec.headActions[Number(el.dataset.ha)].onClick(b));
    ensure().style.display = 'flex';
    if (spec.layout === 'browse') wireBrowse(spec);
    else if (spec.layout === 'tabs') { b.querySelectorAll('.ptab').forEach(t => t.onclick = () => tab(t.dataset.tab)); tab(spec.tabs.initial || spec.tabs.tabs[0].id); if (spec.tabs.wire) spec.tabs.wire(b); }
    else { if (spec.form.wire) spec.form.wire(b); const f = b.querySelector('.pbody input, .pbody textarea, .pbody select'); if (f && spec.form.focus !== false) f.focus(); }
    return b;
  }
  function tab(id) { const b = box(); b.querySelectorAll('.ptab').forEach(t => t.classList.toggle('on', t.dataset.tab === id)); b.querySelectorAll('.pane').forEach(p => p.style.display = p.dataset.pane === id ? '' : 'none'); }
  function close() { const p = cur; cur = null; if (overlay) overlay.style.display = 'none'; clearTimeout(timer); if (p && p.onClose) p.onClose(); }
  function err(t) { const e = box().querySelector('.pfoot .err'); if (e) e.textContent = t || ''; }
  function is(id) { return !!cur && cur.id === id; }
  // ---- browse ----
  function wireBrowse(spec) {
    const b = box(), inp = b.querySelector('.bsearch');
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 220); });
    inp.addEventListener('keydown', (e) => {
      if (!rows.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); select((sel + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length); const it = b.querySelectorAll('.bitems .li')[sel]; it && it.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter' && spec.browse.onPick) { e.preventDefault(); const r = rows[sel]; if (r) { close(); spec.browse.onPick(r); } }
    });
    inp.focus(); refresh();
  }
  function query() { const i = box().querySelector('.bsearch'); return i ? i.value.trim() : ''; }
  async function refresh() {
    if (!cur || cur.layout !== 'browse') return;
    const spec = cur, q = query(), my = ++seq;
    const keep = rows[sel] && spec.browse.key ? spec.browse.key(rows[sel]) : null;
    let list; try { list = await spec.browse.load(q); } catch (e) { list = []; }
    if (cur !== spec || my !== seq) return;
    rows = list || [];
    sel = 0; if (keep != null && spec.browse.key) { const i = rows.findIndex(r => spec.browse.key(r) === keep); if (i >= 0) sel = i; }
    const items = box().querySelector('.bitems'); items.innerHTML = '';
    if (!rows.length) items.innerHTML = `<div class="bempty">${q ? 'nada coincide con «' + esc(q) + '»' : (spec.browse.emptyHtml || 'nada todavía')}</div>`;
    rows.forEach((r, i) => {
      const d = document.createElement('div'); d.className = 'li' + (spec.browse.nodot ? ' nodot' : '') + (i === sel ? ' sel' : ''); d.innerHTML = spec.browse.render(r, q);
      d.onclick = () => select(i); if (spec.browse.onPick) d.ondblclick = () => { close(); spec.browse.onPick(r); };
      items.appendChild(d);
    });
    box().querySelector('.bcount').textContent = spec.browse.count ? spec.browse.count(rows, q) : `${rows.length}`;
    detail();
  }
  function select(i) { sel = i; box().querySelectorAll('.bitems .li').forEach((x, j) => x.classList.toggle('sel', j === i)); detail(); }
  async function detail() {
    if (!cur || cur.layout !== 'browse') return;
    const spec = cur, my = ++seq, d = box().querySelector('.bdetail'), r = rows[sel];
    if (!r) { d.innerHTML = `<div class="none">${rows.length ? '' : (spec.browse.emptyDetail || '')}</div>`; return; }
    let html; try { html = await spec.browse.detail(r, query()); } catch (e) { html = `<div class="none">${esc(String(e.message || e))}</div>`; }
    if (cur !== spec || my !== seq) return;
    d.innerHTML = html; if (spec.browse.wire) spec.browse.wire(r, d);
  }
  function help(show) { const b = box(); const h = b.querySelector('.phelp'), br = b.querySelector('.browse'); if (!h) return; h.style.display = show ? '' : 'none'; br.style.display = show ? 'none' : ''; }
  return { open, close, refresh, detail, err, is, tab, help, get box() { return box(); }, get current() { return cur; }, get selected() { return rows[sel]; } };
})();
