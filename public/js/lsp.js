// lsp.js — language servers: sección del panel lateral + vista browse del Panel («+ agregar» = fila con el formulario)
let lspServers = [], lspPresets = {}, lspGlobalFile = '.lampson/lsp.json';
async function fetchLsp() {
  let r; try { r = await (await fetch(BASE + '/api/lsp')).json(); } catch (e) { return lspServers; }
  lspServers = r.servers || []; lspPresets = r.presets || {}; lspGlobalFile = r.global || lspGlobalFile;
  return lspServers;
}
async function loadLsp() {
  const list = await fetchLsp();
  const box = $('#lspBox'); box.innerHTML = '';
  const ready = list.filter(s => s.status === 'ready').length;
  $('#lspCount').textContent = list.length ? (ready ? `${ready} ● · ${list.length}` : `${list.length}`) : ''; autoSec('lsp', list.some(s => s.status === 'error' || s.status === 'exited'));
  if (!list.length) { const e = document.createElement('div'); e.className = 'p none'; e.style.cursor = 'default'; e.textContent = 'sin language servers'; box.appendChild(e); }
  for (const sv of list) {
    const d = document.createElement('div'); d.className = 'p' + (sv.status === 'ready' ? ' run' : '');
    d.title = `${sv.scope} · $ ${sv.command}` + (sv.error ? `\n${sv.error}` : '');
    d.innerHTML = `<span class="st"></span><span class="nm">${esc(sv.name)}</span><span class="cm">${esc(sv.status)} · ${esc((sv.extensions || []).join(' '))}${sv.error ? ' · ' + esc(sv.error) : ''}</span>`;
    d.onclick = () => openLsp(sv.name);
    box.appendChild(d);
  }
  const addRow = document.createElement('div'); addRow.className = 'p'; addRow.innerHTML = `<span class="nm" style="color:var(--accent)">+ agregar un language server…</span>`;
  addRow.title = 'preset (typescript, python, rust, go, css, html) o tu propio comando · también podés editar ' + lspGlobalFile;
  addRow.onclick = () => openLsp('__new');
  box.appendChild(addRow);
  if (Panel.is('lsp')) Panel.refresh();
}
const LSP_NEW = { name: '__new' };
function openLsp(selectName) {
  Panel.open({
    id: 'lsp', eyebrow: 'lsp', title: 'Language servers', sub: 'arrancan en la primera consulta del agente', layout: 'browse', select: selectName || null,
    browse: {
      placeholder: 'buscar…', listWidth: '260px', key: s => s.name,
      load: async (q) => { const all = await fetchLsp(); const list = all.filter(s => !q || (s.name + ' ' + s.scope + ' ' + (s.extensions || []).join(' ')).toLowerCase().includes(q.toLowerCase())); return q ? list : [...list, LSP_NEW]; },
      render: (s) => s === LSP_NEW ? `<span class="dot">+</span><div><div class="nm" style="color:var(--accent);font-weight:400">agregar un language server…</div><div class="meta">preset o comando propio</div></div>` : `<span class="dot">${s.status === 'ready' ? '●' : (s.status === 'error' || s.status === 'exited' ? '!' : '○')}</span><div><div class="nm">${esc(s.name)}</div><div class="meta">${esc(s.scope)} · ${esc(s.status)} · ${esc((s.extensions || []).join(' '))}</div></div>`,
      count: (rows) => { const n = rows.filter(r => r !== LSP_NEW).length; return `${n} server${n === 1 ? '' : 's'}`; },
      emptyHtml: 'nada coincide',
      detail: (s) => s === LSP_NEW ? lspForm() : `<div class="dhead"><span class="nm">${esc(s.name)}</span><span class="meta">${esc(s.scope)} · ${esc(s.status)}</span></div>
        <div class="dcap">$ ${esc(s.command)}</div>${s.error ? `<div class="dcap err">${esc(s.error)}</div>` : ''}
        <div class="ddesc">Extensiones: ${(s.extensions || []).map(e => `<code>${esc(e)}</code>`).join(' ') || '—'}. El agente lo usa con la tool <code>lsp</code>: <code>symbols</code> (estructura de un archivo sin leerlo), <code>definition</code>, <code>references</code>, <code>hover</code>. ${s.status === 'idle' ? 'Está en espera: arranca en la primera consulta.' : ''}</div>
        <div class="dfoot"><span>${esc(s.scope === 'project' ? '.lampson/lsp.json' : lspGlobalFile)}</span><span class="del">quitar</span></div><div class="derr"></div>`,
      wire: (s, box) => {
        const err = (t) => { const e = box.querySelector('.derr'); if (e) e.textContent = t || ''; };
        if (s === LSP_NEW) {
          const f = n => box.querySelector(`[name="${n}"]`);
          const changed = () => { const k = f('preset').value; const p = lspPresets[k]; box.querySelector('[data-custom]').style.display = k ? 'none' : ''; box.querySelector('[data-install]').textContent = p ? `$ ${p.command} ${(p.args || []).join(' ')}` + (p.install ? ` · si no está instalado: ${p.install}` : '') : ''; };
          f('preset').onchange = changed; changed();
          box.querySelector('[data-go]').onclick = async () => {
            const k = f('preset').value; const body = { scope: f('scope').value };
            if (k) body.name = k;
            else {
              body.name = f('name').value.trim(); body.command = f('command').value.trim(); body.languages = {};
              for (const tok of f('ext').value.trim().split(/\s+/).filter(Boolean)) { const i = tok.indexOf('='); if (i > 0) body.languages[tok.slice(0, i)] = tok.slice(i + 1); }
              if (!body.name || !body.command || !Object.keys(body.languages).length) { err('falta nombre, comando o extensiones (.ext=languageId)'); return; }
            }
            err('guardando…');
            const r = await api(BASE + '/api/lsp/add', body);
            if (!r.ok) { err(r.data.error || ('error ' + r.status)); return; }
            add('meta', '⌁ ' + esc(r.data.result || 'server agregado')); await loadLsp(); Panel.selectKey(body.name);
          };
          return;
        }
        const del = box.querySelector('.dfoot .del');
        del.onclick = () => inlineConfirm(del, `¿quitar ${s.name}?`, async () => { const r = await api(BASE + '/api/lsp/remove', { name: s.name }); if (!r.ok) { err(r.data.error || 'error'); return; } add('meta', '⌁ ' + esc(r.data.result || '')); loadLsp(); });
      }
    }
  });
}
function lspForm() {
  const presets = Object.keys(lspPresets).map(k => `<option value="${esc(k)}">${esc(k)} — ${esc(Object.keys(lspPresets[k].languages || {}).join(' '))}</option>`).join('') + '<option value="">otro — mi propio comando</option>';
  return `<div class="dhead"><span class="nm serif">Agregar un language server</span></div><div class="dform">
    <p class="lead">El mismo proceso que usa tu editor para «ir a definición». No se instala nada acá: elegí un preset (con <code>npx</code> se baja solo) o poné tu comando. Arranca en la primera consulta.</p>
    <label>preset <select name="preset">${presets}</select></label>
    <div data-custom style="display:none">
      <label>nombre <input name="name" spellcheck="false" autocomplete="off" placeholder="mylang"></label>
      <label>comando <input name="command" spellcheck="false" autocomplete="off" placeholder="my-language-server --stdio"></label>
      <label>extensiones <input name="ext" spellcheck="false" autocomplete="off" placeholder=".ml=ocaml .mli=ocaml"></label>
    </div>
    <p class="lead" data-install></p>
    <label>alcance <select name="scope"><option value="global">global — todos los proyectos</option><option value="project">proyecto — solo este repo</option></select></label>
    <div class="pfoot"><button class="primary" data-go>Agregar</button><span class="derr"></span></div></div>`;
}
