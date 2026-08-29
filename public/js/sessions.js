// sessions.js — sesiones: las últimas 4 en el panel, «ver todas» abre el Panel (browse) con búsqueda en
// títulos y contenido (GET /api/sessions/search?q=) y una previsualización de la conversación; traza.
function forgetSession(id) { if (id === session) { session = ''; localStorage.removeItem('lampson.session'); log.innerHTML = ''; showPane('log'); empty(); } }
async function deleteSession(id) { await api('/api/sessions/delete', { id }); forgetSession(id); loadSessions(); }
async function loadSessions() {
  let r; try { r = await (await fetch('/api/sessions')).json(); } catch (e) { return; }
  const box = $('#sessions'); box.innerHTML = '';
  $('#sessCount').textContent = r.sessions.length || '';
  if (!r.sessions.length) { box.innerHTML = '<div class="s none">todavía ninguna</div>'; return; }
  const shown = r.sessions.slice(0, 4);
  for (const s of shown) {
    const d = document.createElement('div'); d.className = 's' + (s.id === session ? ' active' : ''); d.innerHTML = '<span class="id">' + esc(s.id.slice(-6)) + '</span><span class="title">' + esc(s.title || '') + '</span><span class="del tr" title="traza: qué hizo el agente en esta sesión (pasos, tools, tiempos, tokens)">≡</span><span class="del" title="borrar esta sesión">✕</span>'; d.title = s.id; d.onclick = () => open(s.id);
    d.querySelector('.tr').onclick = (ev) => { ev.stopPropagation(); openTrace(s.id); };
    d.querySelector('.del:not(.tr)').onclick = (ev) => { ev.stopPropagation(); inlineConfirm(d.querySelector('.del:not(.tr)'), '¿borrar?', () => deleteSession(s.id)); };
    box.appendChild(d);
  }
  if (r.sessions.length > shown.length) { const m = document.createElement('div'); m.className = 's more'; m.innerHTML = `<span class="title">ver todas (${r.sessions.length}) y buscar…</span>`; m.title = 'buscar en títulos y en el contenido de las conversaciones'; m.onclick = openSessionsPanel; box.appendChild(m); }
}
$('#sessAll').onclick = (e) => { e.stopPropagation(); openSessionsPanel(); };
function openSessionsPanel() {
  Panel.open({
    id: 'sessions', eyebrow: 'sesiones', title: 'Todas las sesiones', sub: 'de este workspace', layout: 'browse',
    browse: {
      placeholder: 'buscar en títulos y en lo que se habló… (↑↓ · Enter abre)', listWidth: '360px', nodot: true,
      key: s => s.id,
      load: async (q) => (await (await fetch('/api/sessions/search?q=' + encodeURIComponent(q) + '&limit=300')).json()).sessions || [],
      render: (s, q) => `<div><div class="nm serif">${hl(s.title || '(sin título)', q)}</div><div class="meta">${esc(s.id)} · ${esc(fmtIso(s.updated))}</div>` + (s.snippet ? `<div class="snip">${hl(s.snippet, q)}</div>` : '') + '</div>',
      detail: async (s, q) => {
        const d = await (await fetch('/api/sessions/' + encodeURIComponent(s.id))).json();
        const msgs = (d.messages || []).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim() && !/^\[harness\]|^\[Context compacted/.test(m.content)).slice(0, 14);
        const steps = (d.messages || []).filter(m => m.role === 'tool').length;
        return `<div class="dhead"><span class="nm serif">${esc(s.title || '(sin título)')}</span><span class="meta">${esc(s.id)} · ${esc(fmtIso(d.updated))} · ${(d.messages || []).length} mensajes · ${steps} tools</span></div>`
          + `<div class="dacts"><button class="primary" data-act="open">Abrir</button><button data-act="trace">≡ Traza</button></div>`
          + `<div class="dmsgs">${msgs.map(m => `<div class="dmsg dm-${m.role}"><span class="who">${m.role === 'user' ? 'vos' : 'agente'}</span>${hl(m.content.length > 500 ? m.content.slice(0, 500) + '…' : m.content, q)}</div>`).join('')}${(d.messages || []).length > msgs.length ? '<div class="none">… (abrila para ver todo)</div>' : ''}</div>`
          + `<div class="dfoot"><span>.lampson/sessions/${esc(s.id)}.json</span><span class="del">borrar</span></div>`;
      },
      wire: (s, box) => {
        box.querySelector('[data-act="open"]').onclick = () => { Panel.close(); open(s.id); };
        box.querySelector('[data-act="trace"]').onclick = () => { Panel.close(); openTrace(s.id); };
        const del = box.querySelector('.dfoot .del');
        del.onclick = () => inlineConfirm(del, `¿borrar ${s.id}?`, async () => { await deleteSession(s.id); Panel.refresh(); });
      },
      onPick: (s) => open(s.id),
      count: (rows, q) => q ? `${rows.length} coincidencia${rows.length === 1 ? '' : 's'}` : `${rows.length} sesión${rows.length === 1 ? '' : 'es'}`,
      emptyHtml: 'todavía no hay sesiones'
    }
  });
}
async function open(id) {
  session = id; localStorage.setItem('lampson.session', id); log.innerHTML = ''; log.classList.remove('hero'); showPane('log'); loadTodo();
  const r = await fetch('/api/sessions/' + id); if (!r.ok) { session = ''; empty(); return loadSessions(); }
  const d = await r.json();
  const queue = []; // pasos sin resultado todavía, en orden (varias tool calls por turno)
  for (const m of d.messages) {
    // los avisos del harness viajan con role user (lo exige el wire) pero no los escribió el usuario:
    // al recargar se muestran como meta (✉), igual que en vivo — nunca con la etiqueta "vos"
    if (m.role === 'user') { queue.length = 0; const t = String(m.content || ''); if (t.startsWith('[harness]') || t.startsWith('[Context compacted')) add('meta', '✉ ' + esc(t.split('\n')[0].slice(0, 160))); else add('user', esc(m.content) + imagesHtml(m.images)); }
    else if (m.role === 'assistant') { if (m.content) add('assistant', md(m.content)); for (const c of (m.tool_calls || [])) { const el = add('step', `<span class="ic">⚙</span>${cmdHtml(describe(c))}`); wireMore(el); queue.push(el); } }
    else if (m.role === 'tool') { const out = String(m.content); const bad = /^(ERROR|DENIED)/.test(out); const el = queue.shift() || add('step', '<span class="ic">→</span>'); const ic = el.querySelector('.ic'); if (ic) { ic.textContent = bad ? '✗' : '✓'; ic.className = 'ic ' + (bad ? 'bad' : 'ok'); } el.insertAdjacentHTML('beforeend', `<details><summary class="${bad ? 'bad' : ''}">${esc(out.split('\n')[0].slice(0, 140))} <span style="color:var(--ink-3)">(${out.length} chars)</span></summary><pre>${esc(out)}</pre></details>`); }
  }
  loadSessions();
}
$('#new').onclick = () => { session = ''; localStorage.removeItem('lampson.session'); log.innerHTML = ''; showPane('log'); empty(); loadSessions(); loadTodo(); };
// traza legible de una sesión (.lampson/trace/<sid>.log)
async function openTrace(id) {
  procOpen = null; agentOpen = null;
  let r; try { r = await (await fetch('/api/trace?session=' + encodeURIComponent(id) + '&tail=600')).json(); } catch (e) { return; }
  showText('traza ' + id, r.file || '', r.trace || '(sin traza todavía: se escribe a medida que el agente trabaja)', true);
}
