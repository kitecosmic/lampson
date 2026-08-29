// mcp.js — servers MCP: sección del panel + formulario «conectar» (Panel form)
let mcpFiles = { global: '.lampson/mcp.json', project: '' };
async function loadMcp() {
  let r; try { r = await (await fetch('/api/mcp')).json(); } catch (e) { return; }
  mcpFiles = { global: r.global || '.lampson/mcp.json', project: r.project || '' };
  const box = $('#mcpBox'); box.innerHTML = '';
  const list = r.servers || []; const ready = list.filter(s => s.status === 'ready').length;
  $('#mcpCount').textContent = list.length ? (ready ? `${ready} ● · ${list.length}` : `${list.length}`) : ''; autoSec('mcp', list.some(s => s.status === 'error'));
  if (!list.length) { const e = document.createElement('div'); e.className = 'p none'; e.style.cursor = 'default'; e.textContent = 'sin servers conectados'; box.appendChild(e); }
  for (const sv of list) {
    const d = document.createElement('div'); d.className = 'p' + (sv.status === 'ready' ? ' run' : ''); d.style.cursor = 'default';
    d.title = `${sv.scope} · $ ${sv.command}` + (sv.error ? `\n${sv.error}` : '') + (sv.tools.length ? `\ntools: ${sv.tools.join(', ')}` : '');
    d.innerHTML = `<span class="st"></span><span class="nm">${esc(sv.name)}</span><span class="cm">${esc(sv.status)} · ${sv.tools.length} tools${sv.error ? ' · ' + esc(sv.error) : ''}</span><span class="del" title="quitar este server (lo saca del mcp.json y apaga su proceso)">✕</span>`;
    d.querySelector('.del').onclick = (ev) => { ev.stopPropagation(); inlineConfirm(d.querySelector('.del'), '¿quitar?', async () => { await api('/api/mcp/remove', { name: sv.name }); loadMcp(); }); };
    box.appendChild(d);
  }
  const addRow = document.createElement('div'); addRow.className = 'p'; addRow.innerHTML = `<span class="nm" style="color:var(--accent)">+ conectar un server…</span>`;
  addRow.title = 'también podés editar a mano ' + mcpFiles.global + ' (global) o ' + mcpFiles.project + ' (proyecto), o pedírselo al agente';
  addRow.onclick = openMcpAdd;
  box.appendChild(addRow);
}
function openMcpAdd() {
  Panel.open({
    id: 'mcp-add', eyebrow: 'mcp', title: 'Conectar un server MCP', layout: 'form', size: 'sm',
    form: {
      html: `<p class="lead">El comando arranca el server por stdio (formato Claude Code/Cursor). Queda guardado en <code data-file>${esc(mcpFiles.global)}</code> y sus tools entran al catálogo del agente como <code>mcp_&lt;server&gt;_&lt;tool&gt;</code>.</p>
        <label>nombre <input name="name" spellcheck="false" autocomplete="off" placeholder="github"></label>
        <label>comando <input name="command" spellcheck="false" autocomplete="off" placeholder="npx -y @modelcontextprotocol/server-github"></label>
        <label>env <input name="env" spellcheck="false" autocomplete="off" placeholder="opcional: GITHUB_TOKEN=… · separá con espacios"></label>
        <label>alcance <select name="scope"><option value="global">global — todos los proyectos</option><option value="project">proyecto — solo este repo</option></select></label>`,
      footer: `<button class="primary" data-go>Conectar</button><button data-cancel>Cancelar</button>`,
      wire: (b) => {
        const f = n => b.querySelector(`[name="${n}"]`);
        f('scope').onchange = () => { b.querySelector('[data-file]').textContent = f('scope').value === 'project' ? mcpFiles.project : mcpFiles.global; };
        b.querySelector('[data-cancel]').onclick = Panel.close;
        b.querySelector('[data-go]').onclick = async () => {
          const name = f('name').value.trim(), command = f('command').value.trim();
          if (!name || !command) { Panel.err('falta nombre o comando'); return; }
          const env = {};
          for (const tok of f('env').value.trim().split(/\s+/).filter(Boolean)) { const i = tok.indexOf('='); if (i > 0) env[tok.slice(0, i)] = tok.slice(i + 1); }
          Panel.err('conectando…');
          const r = await api('/api/mcp/add', { name, command, env, scope: f('scope').value });
          if (!r.ok) { Panel.err(r.data.error || ('error ' + r.status)); return; }
          Panel.close(); add('meta', '⌁ ' + esc(r.data.result || 'server conectado')); loadMcp();
        };
      }
    }
  });
}
