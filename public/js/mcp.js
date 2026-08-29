// mcp.js — servers MCP: sección del panel lateral + vista browse del Panel (servers a la izquierda, detalle a la
// derecha; «+ conectar» es una fila más cuyo detalle es el formulario)
let mcpServers = [], mcpFiles = { global: '.lampson/mcp.json', project: '' };
async function fetchMcp() {
  let r; try { r = await (await fetch('/api/mcp')).json(); } catch (e) { return mcpServers; }
  mcpServers = r.servers || []; mcpFiles = { global: r.global || '.lampson/mcp.json', project: r.project || '' };
  return mcpServers;
}
async function loadMcp() {
  const list = await fetchMcp();
  const box = $('#mcpBox'); box.innerHTML = '';
  const ready = list.filter(s => s.status === 'ready').length;
  $('#mcpCount').textContent = list.length ? (ready ? `${ready} ● · ${list.length}` : `${list.length}`) : ''; autoSec('mcp', list.some(s => s.status === 'error'));
  if (!list.length) { const e = document.createElement('div'); e.className = 'p none'; e.style.cursor = 'default'; e.textContent = 'sin servers conectados'; box.appendChild(e); }
  for (const sv of list) {
    const d = document.createElement('div'); d.className = 'p' + (sv.status === 'ready' ? ' run' : '');
    d.title = `${sv.scope} · $ ${sv.command}` + (sv.error ? `\n${sv.error}` : '') + (sv.tools.length ? `\ntools: ${sv.tools.join(', ')}` : '');
    d.innerHTML = `<span class="st"></span><span class="nm">${esc(sv.name)}</span><span class="cm">${esc(sv.status)} · ${sv.tools.length} tools${sv.error ? ' · ' + esc(sv.error) : ''}</span>`;
    d.onclick = () => openMcp(sv.name);
    box.appendChild(d);
  }
  const addRow = document.createElement('div'); addRow.className = 'p'; addRow.innerHTML = `<span class="nm" style="color:var(--accent)">+ conectar un server…</span>`;
  addRow.title = 'también podés editar a mano ' + mcpFiles.global + ' (global) o ' + mcpFiles.project + ' (proyecto), o pedírselo al agente';
  addRow.onclick = () => openMcp('__new');
  box.appendChild(addRow);
  if (Panel.is('mcp')) Panel.refresh();
}
const MCP_NEW = { name: '__new' };
function openMcp(selectName) {
  Panel.open({
    id: 'mcp', eyebrow: 'mcp', title: 'Servers MCP', sub: 'formato Claude Code / Cursor', layout: 'browse', select: selectName || null,
    browse: {
      placeholder: 'buscar server o tool…', listWidth: '260px', key: s => s.name,
      load: async (q) => { const all = await fetchMcp(); const list = all.filter(s => !q || (s.name + ' ' + s.scope + ' ' + (s.tools || []).join(' ')).toLowerCase().includes(q.toLowerCase())); return q ? list : [...list, MCP_NEW]; },
      render: (s) => s === MCP_NEW ? `<span class="dot">+</span><div><div class="nm" style="color:var(--accent);font-weight:400">conectar un server…</div><div class="meta">${esc(mcpFiles.global)}</div></div>` : `<span class="dot">${s.status === 'ready' ? '●' : (s.status === 'error' ? '!' : '○')}</span><div><div class="nm">${esc(s.name)}</div><div class="meta">${esc(s.scope)} · ${esc(s.status)} · ${(s.tools || []).length} tools</div></div>`,
      count: (rows, q) => `${rows.filter(r => r !== MCP_NEW).length} server${rows.filter(r => r !== MCP_NEW).length === 1 ? '' : 's'}`,
      emptyHtml: 'nada coincide',
      detail: (s) => s === MCP_NEW ? mcpForm() : `<div class="dhead"><span class="nm">${esc(s.name)}</span><span class="meta">${esc(s.scope)} · ${esc(s.status)}</span></div>
        <div class="dcap">$ ${esc(s.command)}</div>${s.error ? `<div class="dcap err">${esc(s.error)}</div>` : ''}
        <div class="ddesc">${(s.tools || []).length ? 'Tools en el catálogo del agente: ' + (s.tools || []).map(t => `<code>mcp_${esc(s.name)}_${esc(t)}</code>`).join(' ') : 'sin tools todavía (el server no terminó de arrancar o falló)'}</div>
        <div class="dfoot"><span>${esc(s.scope === 'project' ? mcpFiles.project : mcpFiles.global)}</span><span class="del">quitar</span></div><div class="derr"></div>`,
      wire: (s, box) => {
        const err = (t) => { const e = box.querySelector('.derr'); if (e) e.textContent = t || ''; };
        if (s === MCP_NEW) {
          const f = n => box.querySelector(`[name="${n}"]`);
          f('scope').onchange = () => { box.querySelector('[data-file]').textContent = f('scope').value === 'project' ? mcpFiles.project : mcpFiles.global; };
          box.querySelector('[data-go]').onclick = async () => {
            const name = f('name').value.trim(), command = f('command').value.trim();
            if (!name || !command) { err('falta nombre o comando'); return; }
            const env = {};
            for (const tok of f('env').value.trim().split(/\s+/).filter(Boolean)) { const i = tok.indexOf('='); if (i > 0) env[tok.slice(0, i)] = tok.slice(i + 1); }
            err('conectando…');
            const r = await api('/api/mcp/add', { name, command, env, scope: f('scope').value });
            if (!r.ok) { err(r.data.error || ('error ' + r.status)); return; }
            add('meta', '⌁ ' + esc(r.data.result || 'server conectado')); await loadMcp(); Panel.selectKey(name);
          };
          f('name').focus();
          return;
        }
        const del = box.querySelector('.dfoot .del');
        del.onclick = () => inlineConfirm(del, `¿quitar ${s.name}?`, async () => { const r = await api('/api/mcp/remove', { name: s.name }); if (!r.ok) { err(r.data.error || 'error'); return; } add('meta', '⌁ ' + esc(r.data.result || '')); loadMcp(); });
      }
    }
  });
}
function mcpForm() {
  return `<div class="dhead"><span class="nm serif">Conectar un server MCP</span></div><div class="dform">
    <p class="lead">El comando arranca el server por stdio. Queda guardado en <code data-file>${esc(mcpFiles.global)}</code> y sus tools entran al catálogo del agente como <code>mcp_&lt;server&gt;_&lt;tool&gt;</code> desde el próximo turno.</p>
    <label>nombre <input name="name" spellcheck="false" autocomplete="off" placeholder="github"></label>
    <label>comando <input name="command" spellcheck="false" autocomplete="off" placeholder="npx -y @modelcontextprotocol/server-github"></label>
    <label>env <input name="env" spellcheck="false" autocomplete="off" placeholder="opcional: GITHUB_TOKEN=… · separá con espacios"></label>
    <label>alcance <select name="scope"><option value="global">global — todos los proyectos</option><option value="project">proyecto — solo este repo</option></select></label>
    <div class="pfoot"><button class="primary" data-go>Conectar</button><span class="derr"></span></div></div>`;
}
