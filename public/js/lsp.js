// lsp.js — language servers: sección del panel + formulario «agregar» (preset o comando propio) en el Panel
let lspPresets = {}, lspGlobalFile = '.lampson/lsp.json';
async function loadLsp() {
  let r; try { r = await (await fetch('/api/lsp')).json(); } catch (e) { return; }
  lspPresets = r.presets || {}; lspGlobalFile = r.global || lspGlobalFile;
  const box = $('#lspBox'); box.innerHTML = '';
  const list = r.servers || []; const ready = list.filter(s => s.status === 'ready').length;
  $('#lspCount').textContent = list.length ? (ready ? `${ready} ● · ${list.length}` : `${list.length}`) : ''; autoSec('lsp', list.some(s => s.status === 'error' || s.status === 'exited'));
  if (!list.length) { const e = document.createElement('div'); e.className = 'p none'; e.style.cursor = 'default'; e.textContent = 'sin language servers'; box.appendChild(e); }
  for (const sv of list) {
    const d = document.createElement('div'); d.className = 'p' + (sv.status === 'ready' ? ' run' : ''); d.style.cursor = 'default';
    d.title = `${sv.scope} · $ ${sv.command}` + (sv.error ? `\n${sv.error}` : '');
    d.innerHTML = `<span class="st"></span><span class="nm">${esc(sv.name)}</span><span class="cm">${esc(sv.status)} · ${esc((sv.extensions || []).join(' '))}${sv.error ? ' · ' + esc(sv.error) : ''}</span><span class="del" title="quitar este server de la config">✕</span>`;
    d.querySelector('.del').onclick = (ev) => { ev.stopPropagation(); inlineConfirm(d.querySelector('.del'), '¿quitar?', async () => { await api('/api/lsp/remove', { name: sv.name }); loadLsp(); }); };
    box.appendChild(d);
  }
  const addRow = document.createElement('div'); addRow.className = 'p'; addRow.innerHTML = `<span class="nm" style="color:var(--accent)">+ agregar un language server…</span>`;
  addRow.title = 'preset (typescript, python, rust, go, css, html) o tu propio comando · también podés editar ' + lspGlobalFile;
  addRow.onclick = openLspAdd;
  box.appendChild(addRow);
}
function openLspAdd() {
  const presets = Object.keys(lspPresets).map(k => `<option value="${esc(k)}">${esc(k)} — ${esc(Object.keys(lspPresets[k].languages || {}).join(' '))}</option>`).join('') + '<option value="">otro — mi propio comando</option>';
  Panel.open({
    id: 'lsp-add', eyebrow: 'lsp', title: 'Agregar un language server', layout: 'form', size: 'sm',
    form: {
      html: `<p class="lead">El mismo proceso que usa tu editor para «ir a definición». El agente lo usa para ver la estructura de un archivo sin leerlo entero (<code>symbols</code>) y para navegar sin ambigüedad (<code>definition</code>, <code>references</code>, <code>hover</code>). No se instala nada acá: elegí un preset (con <code>npx</code> se baja solo) o poné tu comando. Arranca en la primera consulta.</p>
        <label>preset <select name="preset">${presets}</select></label>
        <div data-custom style="display:none">
          <label>nombre <input name="name" spellcheck="false" autocomplete="off" placeholder="mylang"></label>
          <label>comando <input name="command" spellcheck="false" autocomplete="off" placeholder="my-language-server --stdio"></label>
          <label>extensiones <input name="ext" spellcheck="false" autocomplete="off" placeholder=".ml=ocaml .mli=ocaml"></label>
        </div>
        <p class="lead" data-install></p>
        <label>alcance <select name="scope"><option value="global">global — todos los proyectos</option><option value="project">proyecto — solo este repo</option></select></label>`,
      footer: `<button class="primary" data-go>Agregar</button><button data-cancel>Cancelar</button>`,
      wire: (b) => {
        const f = n => b.querySelector(`[name="${n}"]`);
        const changed = () => { const k = f('preset').value; const p = lspPresets[k]; b.querySelector('[data-custom]').style.display = k ? 'none' : ''; b.querySelector('[data-install]').textContent = p ? `$ ${p.command} ${(p.args || []).join(' ')}` + (p.install ? ` · si no está instalado: ${p.install}` : '') : ''; };
        f('preset').onchange = changed; changed();
        b.querySelector('[data-cancel]').onclick = Panel.close;
        b.querySelector('[data-go]').onclick = async () => {
          const k = f('preset').value; const body = { scope: f('scope').value };
          if (k) body.name = k;
          else {
            body.name = f('name').value.trim(); body.command = f('command').value.trim(); body.languages = {};
            for (const tok of f('ext').value.trim().split(/\s+/).filter(Boolean)) { const i = tok.indexOf('='); if (i > 0) body.languages[tok.slice(0, i)] = tok.slice(i + 1); }
            if (!body.name || !body.command || !Object.keys(body.languages).length) { Panel.err('falta nombre, comando o extensiones (.ext=languageId)'); return; }
          }
          Panel.err('guardando…');
          const r = await api('/api/lsp/add', body);
          if (!r.ok) { Panel.err(r.data.error || ('error ' + r.status)); return; }
          Panel.close(); add('meta', '⌁ ' + esc(r.data.result || 'server agregado')); loadLsp();
        };
      }
    }
  });
}
