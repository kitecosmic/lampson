// engine.js — Lampson como motor, en la UI: secciones «API» (keys de la API /v1 y del MCP) y «Canales» (Telegram,
// Chatwoot…) en el panel lateral, cada una con su vista browse del Panel. Backend: /api/keys* y /api/channels*
// (web.syn), sobre lib/apikeys.syn y lib/channels.syn — lo mismo que `lampson key …` y `lampson channel …`.
let keysData = { keys: [], api_url: '', mcp_url: '', public: false, agents: [] };
let channelsData = { channels: [], public: false };
const KEY_NEW = { id: '__new' };
// la key en claro existe solo en la respuesta de crearla: se guarda acá para mostrarla en su detalle mientras el panel
// siga abierto (al cerrar se olvida; no hay otra forma de volver a verla)
let justCreated = null;

// un 404 acá = la página es nueva pero el proceso del workspace arrancó con código anterior (no conoce estas rutas)
const STALE_MSG = 'este workspace corre una versión anterior de Lampson — reinicialo: lampson --hub restart';
async function fetchKeys() {
  try {
    const r = await fetch(BASE + '/api/keys');
    if (r.status === 404) keysData = { keys: [], stale: true }; else if (r.ok) keysData = await r.json();
  } catch (e) {}
  keysData.keys = keysData.keys || [];
  return keysData;
}
async function loadKeys() {
  const d = await fetchKeys();
  const box = $('#keysBox'); if (!box) return;
  box.innerHTML = '';
  $('#keysCount').textContent = d.keys.length || '';
  if (d.stale) { const e = document.createElement('div'); e.className = 'p none'; e.style.cursor = 'default'; e.textContent = STALE_MSG; box.appendChild(e); return; }
  for (const k of d.keys) {
    const row = document.createElement('div'); row.className = 'p' + (k.last_used ? ' run' : '');
    row.title = `agentes: ${k.agents.join(', ')}\nlímite: ${k.rate ? k.rate + '/min' : 'sin límite'}${k.callbacks.length ? '\ncallbacks: ' + k.callbacks.join(', ') : ''}\núltimo uso: ${k.last_used || 'nunca'}`;
    row.innerHTML = `<span class="st"></span><span class="nm">${esc(k.name || k.id)}</span><span class="cm">${esc(k.agents.join(', '))} · ${k.rate ? k.rate + '/min' : '∞'}</span>`;
    row.onclick = () => openKeys(k.id);
    box.appendChild(row);
  }
  const add = document.createElement('div'); add.className = 'p';
  add.innerHTML = `<span class="nm" style="color:var(--accent)">+ crear una API key…</span>`;
  add.title = 'para que una app, un bot o un agente use los agentes de este workspace por HTTP o MCP';
  add.onclick = () => openKeys('__new');
  box.appendChild(add);
  if (Panel.is('keys')) await Panel.refresh();
}
function keyForm() {
  const opts = (keysData.agents || []).map(a => `<label class="chk"><input type="checkbox" value="${esc(a)}"> ${esc(a)}</label>`).join(' ');
  return `<div class="dhead"><span class="nm serif">Crear una API key</span></div><div class="dform">
    <p class="lead">Una key deja que una app, un bot o <b>otro agente</b> use agentes de este workspace: por HTTP (<code>${esc(keysData.api_url)}</code>) o como herramienta MCP (<code>${esc(keysData.mcp_url)}</code>). Se muestra <b>una sola vez</b>.</p>
    <label>nombre <input name="name" spellcheck="false" autocomplete="off" placeholder="bot de whatsapp"></label>
    <div class="lf"><span class="lk">agentes que puede usar</span><div>${opts}</div><span class="ds">ninguno marcado = todos</span></div>
    <label>pedidos por minuto <input name="rate" type="number" min="0" placeholder="120 (0 = sin límite)"></label>
    <label>callbacks solo a <input name="callbacks" spellcheck="false" autocomplete="off" placeholder="opcional: https://hooks.mi-app.com/ · separá con espacios"></label>
    <div class="pfoot"><button class="primary" data-go>Crear</button><span class="derr"></span></div>
    </div>`;
}
function openKeys(selectId) {
  Panel.open({
    id: 'keys', eyebrow: 'api', title: 'API keys', onClose: () => { justCreated = null; }, sub: keysData.public ? 'URL pública configurada' : 'solo desde esta PC (sin URL pública)', layout: 'browse', select: selectId || null,
    browse: {
      placeholder: 'buscar key o agente…', listWidth: '260px', key: k => k.id,
      load: async (q) => { const d = await fetchKeys(); const list = d.keys.filter(k => !q || (k.name + ' ' + k.id + ' ' + k.agents.join(' ')).toLowerCase().includes(q.toLowerCase())); return q ? list : [...list, KEY_NEW]; },
      render: (k) => k === KEY_NEW ? `<span class="dot">+</span><div><div class="nm" style="color:var(--accent);font-weight:400">crear una API key…</div><div class="meta">para apps, bots y agentes</div></div>`
        : `<span class="dot">${k.last_used ? '●' : '○'}</span><div><div class="nm">${esc(k.name || k.id)}</div><div class="meta">${esc(k.agents.join(', '))} · ${k.rate ? k.rate + '/min' : 'sin límite'}</div></div>`,
      count: (rows) => { const n = rows.filter(r => r !== KEY_NEW).length; return `${n} key${n === 1 ? '' : 's'}`; },
      emptyHtml: 'nada coincide',
      detail: (k) => k === KEY_NEW ? keyForm() : `<div class="dhead"><span class="nm">${esc(k.name || k.id)}</span><span class="meta">${esc(k.id)}</span></div>
        <div class="ddesc">Agentes: ${k.agents.map(a => `<code>${esc(a)}</code>`).join(' ')}</div>
        <div class="dcap">límite: ${k.rate ? k.rate + ' pedidos por minuto' : 'sin límite'}${k.callbacks.length ? ' · callbacks solo a ' + k.callbacks.map(esc).join(', ') : ' · callbacks a cualquier URL'}</div>
        ${justCreated && justCreated.id === k.id ? `<div class="dnote"><b>Guardala ahora: no se vuelve a mostrar.</b></div><pre class="out">${esc(justCreated.key)}\n\nAPI: ${esc(keysData.api_url)}\nMCP: ${esc(keysData.mcp_url)}\nHeader: Authorization: Bearer ${esc(justCreated.key)}</pre>` : ''}
        <div class="dnote">API: <code>${esc(keysData.api_url)}</code><br>MCP: <code>${esc(keysData.mcp_url)}</code><br>creada ${esc(k.created)} · último uso ${esc(k.last_used || 'nunca')}</div>
        <div class="dfoot"><span>la key en claro no se guarda: si se perdió, creá otra</span><span class="del">revocar</span></div><div class="derr"></div>`,
      wire: (k, box) => {
        const err = (t) => { const e = box.querySelector('.derr'); if (e) e.textContent = t || ''; };
        if (k === KEY_NEW) {
          const f = n => box.querySelector(`[name="${n}"]`);
          box.querySelector('[data-go]').onclick = async () => {
            const agents = [...box.querySelectorAll('.chk input:checked')].map(i => i.value);
            const callbacks = f('callbacks').value.trim().split(/\s+/).filter(Boolean);
            err('creando…');
            const r = await api(BASE + '/api/keys/add', { name: f('name').value.trim(), agents, rate: f('rate').value, callbacks });
            if (!r.ok) { err(r.data.error || ('error ' + r.status)); return; }
            err('');
            justCreated = { id: r.data.id, key: r.data.key };
            await loadKeys();
            Panel.selectKey(r.data.id);
          };
          f('name').focus();
          return;
        }
        const del = box.querySelector('.dfoot .del');
        del.onclick = () => inlineConfirm(del, `¿revocar ${k.name || k.id}? Las apps que la usan dejan de entrar`, async () => {
          const r = await api(BASE + '/api/keys/remove', { id: k.id }); if (!r.ok) { err(r.data.error || 'error'); return; } loadKeys();
        });
      }
    }
  });
}

async function fetchChannels() {
  try {
    const r = await fetch(BASE + '/api/channels');
    if (r.status === 404) channelsData = { channels: [], stale: true }; else if (r.ok) channelsData = await r.json();
  } catch (e) {}
  channelsData.channels = channelsData.channels || [];
  return channelsData;
}
async function loadChannels() {
  const d = await fetchChannels();
  const box = $('#channelsBox'); if (!box) return;
  box.innerHTML = '';
  const on = d.channels.filter(c => c.enabled).length;
  $('#channelsCount').textContent = d.channels.length ? (on ? `${on} ● · ${d.channels.length}` : `${d.channels.length}`) : '';
  if (!d.channels.length) { const e = document.createElement('div'); e.className = 'p none'; e.style.cursor = 'default'; e.textContent = d.stale ? STALE_MSG : 'sin canales instalados'; box.appendChild(e); }
  for (const c of d.channels) {
    const row = document.createElement('div'); row.className = 'p' + (c.enabled ? ' run' : '');
    row.title = c.description || '';
    row.innerHTML = `<span class="st"></span><span class="nm">${esc(c.name)}</span><span class="cm">${c.error ? 'roto' : (c.enabled ? esc(c.agent) + ' · ' + (c.mode === 'poll' ? 'sin URL pública' : 'webhook') : 'apagado')}</span>`;
    row.onclick = () => openChannels(c.name);
    box.appendChild(row);
  }
  if (Panel.is('channels')) await Panel.refresh();
}
function openChannels(selectName) {
  Panel.open({
    id: 'channels', eyebrow: 'canales', title: 'Canales', sub: channelsData.public ? 'URL pública configurada' : 'sin URL pública: los que lo permiten piden los mensajes solos', layout: 'browse', select: selectName || null,
    browse: {
      placeholder: 'buscar canal…', listWidth: '240px', key: c => c.name,
      load: async (q) => { const d = await fetchChannels(); return d.channels.filter(c => !q || (c.name + ' ' + (c.description || '')).toLowerCase().includes(q.toLowerCase())); },
      render: (c) => `<span class="dot">${c.error ? '!' : (c.enabled ? '●' : '○')}</span><div><div class="nm">${esc(c.name)}</div><div class="meta">${c.enabled ? esc(c.agent) + ' · ' + (c.mode === 'poll' ? 'sin URL pública' : 'webhook') : 'apagado'}</div></div>`,
      count: (rows) => `${rows.length} canal${rows.length === 1 ? '' : 'es'}`,
      emptyHtml: 'sin canales instalados',
      detail: (c) => `<div class="dhead"><span class="nm">${esc(c.name)}</span><span class="meta">${esc(c.scope)}</span><label class="sw ${c.enabled ? 'on' : ''}" title="${c.error ? 'no se puede encender: está roto' : (c.enabled ? 'apagar' : 'encender')}"><input type="checkbox" ${c.enabled ? 'checked' : ''} ${c.error ? 'disabled' : ''}>${c.enabled ? 'encendido' : 'apagado'}</label></div>`
        + (c.description ? `<div class="ddesc">${esc(c.description)}</div>` : '')
        + (c.error ? `<div class="dcap err">roto: ${esc(c.error)}</div>` : `<div class="dcap">agente: <code>${esc(c.agent)}</code> · modo: ${c.mode === 'poll' ? 'sin URL pública (Lampson le pide los mensajes a la plataforma)' : 'webhook'}</div>`)
        + `<div class="dnote">${c.mode === 'poll' ? 'No hace falta URL pública: el workspace pide los mensajes mientras esté encendido.' : `URL del webhook: <code>${esc(c.webhook_url)}</code>${c.public ? '' : '<br><b>Sin URL pública</b>: la plataforma no llega a esta PC.' + (c.poll ? ' «Configurar» pasa este canal a modo sin URL pública.' : ' Usá <code>lampson --domain …</code> o un túnel.')}`}<br>El agente que atiende se cambia con <code>LAMPSON_CHANNEL_${esc(c.name.toUpperCase().replace(/-/g, '_'))}_AGENT</code> en el <code>.env</code>.</div>`
        + (c.enabled ? `<div class="go"><button class="primary" data-setup>configurar</button><span class="st"></span></div><pre class="out" data-out style="display:none"></pre>` : '')
        + `<div class="lf" style="margin-top:16px"><span class="lk">últimos eventos</span><pre class="out">${c.log.length ? esc(c.log.join('\n')) : 'nada todavía'}</pre></div><div class="derr"></div>`,
      wire: (c, box) => {
        const err = (t) => { const e = box.querySelector('.derr'); if (e) e.textContent = t || ''; };
        const sw = box.querySelector('.sw input');
        if (sw) sw.onchange = async () => { const r = await api(BASE + '/api/channels/toggle', { name: c.name, on: sw.checked }); if (!r.ok) { err(r.data.error || 'error'); sw.checked = !sw.checked; return; } loadChannels(); };
        const su = box.querySelector('[data-setup]');
        if (su) su.onclick = async () => {
          const st = box.querySelector('.go .st'); st.textContent = 'configurando…'; su.disabled = true;
          const r = await api(BASE + '/api/channels/setup', { name: c.name });
          su.disabled = false; st.textContent = r.ok && r.data.code === 0 ? 'listo' : 'falló';
          const out = box.querySelector('[data-out]'); out.style.display = ''; out.textContent = r.ok ? r.data.out : (r.data.error || 'error ' + r.status);
          loadChannels();
        };
      }
    }
  });
}
