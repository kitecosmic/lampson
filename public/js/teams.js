// teams.js — la pantalla de equipos y objetivos (public/teams.html). Página propia: no depende de los módulos del
// agente de programación. Se actualiza sola (cada 2,5 s) desde la API privada del workspace:
//   GET  api/objectives · api/objectives/:id · api/teams
//   POST api/objectives/add · api/objectives/:id/reply · api/objectives/:id/cancel · api/teams/save
//   GET  api/approvals + POST api/approve (las aprobaciones de la cola: p. ej. un merge a main desde la copia de un agente)
const $ = (s) => document.querySelector(s);
const BASE = (location.pathname.match(/^\/w\/[^/]+/) || [''])[0];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LANES = [['todo', 'por hacer'], ['doing', 'en curso'], ['review', 'en revisión'], ['done', 'hecho'], ['blocked', 'bloqueada']];
const STATUS = { active: 'trabajando', waiting: 'te espera', done: 'hecho', failed: 'falló', cancelled: 'cancelado', paused: 'sin presupuesto' };
const KIND = { added: 'agregó', claimed: 'tomó', updated: 'movió', message: 'escribió', report: 'informó', asked: 'preguntó', 'approval requested': 'pide aprobación', approved: 'aprobó', denied: 'denegó', answered: 'respondió', done: 'terminó', failed: 'falló', cancelled: 'canceló', paused: 'pausado', budget: 'presupuesto', objective: 'nuevo objetivo', error: 'error' };

const PRESETS = [['code', 'código (leer, editar, comandos)'], ['read', 'leer y correr comandos (no edita)'], ['none', 'ninguna (solo coordina)']];
const state = { approvals: [], teamsMeta: [], draft: null, sel: null, tab: new URLSearchParams(location.search).get('tab') || localStorage.getItem('lampson.teams.tab') || 'objectives', obj: Number(new URLSearchParams(location.search).get('o')) || null, team: null, objectives: [], agents: [], teams: [], seen: new Set() };

async function api(path, body) {
  const r = await fetch(BASE + '/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (r.status === 401) location.href = '/login';
  return { ok: r.ok, status: r.status, data };
}
const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - t); return s < 60 ? 'recién' : s < 3600 ? Math.floor(s / 60) + ' min' : s < 86400 ? Math.floor(s / 3600) + ' h' : Math.floor(s / 86400) + ' d'; };
const hhmm = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const k = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n);

// ---------- cabecera ----------
$('#proj').textContent = BASE ? BASE.slice(3).replace(/-[0-9a-f]{8}$/, '') : 'local';
$('#back').href = BASE || '/';
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('lampson.theme', t); } catch (e) {} $('#theme').textContent = t === 'dark' ? '☀' : '☾'; }
setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
$('#theme').onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
function showTab(t) {
  state.tab = t; try { localStorage.setItem('lampson.teams.tab', t); } catch (e) {}
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $('#v-objectives').hidden = t !== 'objectives'; $('#v-teams').hidden = t !== 'teams';
  refresh();
}
document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ---------- lo que espera a la persona ----------
function renderAttention() {
  const waiting = state.objectives.filter((o) => o.status === 'waiting');
  const pend = state.approvals.filter((a) => a.status === 'pending');
  const box = $('#attention');
  box.hidden = waiting.length === 0 && pend.length === 0;
  const keep = {};
  box.querySelectorAll('input[data-id]').forEach((i) => (keep[i.dataset.id] = i.value));
  box.innerHTML = waiting.map((o) => {
    const ap = o.question_kind === 'approval';
    return `<div class="ask ${ap ? 'approval' : ''}"><span class="who">${esc(o.agent)} ${ap ? 'pide aprobación' : 'pregunta'}</span>
      <div class="q"><span class="ref" data-open="${o.id}">${esc(o.ref)}</span> ${esc(o.question)}</div>
      <div class="acts">${ap
        ? `<input data-id="${o.id}" placeholder="nota (opcional)"><button class="ok" data-approve="${o.id}">Aprobar</button><button class="no" data-deny="${o.id}">Denegar</button>`
        : `<input data-id="${o.id}" placeholder="tu respuesta"><button class="primary" data-answer="${o.id}">Responder</button>`}</div></div>`;
  }).join('') + pend.map((a) => {
    const who = (String(a.why || '').match(/agent (\S+)/) || [])[1] || 'un agente';
    return `<div class="ask approval"><span class="who">${esc(who)} pide aprobación</span><div class="q"><code>${esc(a.message)}</code><br><span class="ref">${esc(String(a.why || '').replace(/ · agent \S+$/, ''))}</span></div>
      <div class="acts"><button class="ok" data-qok="${esc(a.id)}">Aprobar</button><button class="no" data-qno="${esc(a.id)}">Denegar</button></div></div>`;
  }).join('');
  box.querySelectorAll('[data-qok]').forEach((b) => (b.onclick = async () => { await api('approve', { id: b.dataset.qok, decision: true }); refresh(); }));
  box.querySelectorAll('[data-qno]').forEach((b) => (b.onclick = async () => { await api('approve', { id: b.dataset.qno, decision: false }); refresh(); }));
  box.querySelectorAll('input[data-id]').forEach((i) => { if (keep[i.dataset.id]) i.value = keep[i.dataset.id]; });
  const note = (id) => (box.querySelector(`input[data-id="${id}"]`) || {}).value || '';
  box.querySelectorAll('[data-open]').forEach((e) => (e.onclick = () => { showTab('objectives'); openObj(+e.dataset.open); }));
  box.querySelectorAll('[data-approve]').forEach((b) => (b.onclick = () => reply(+b.dataset.approve, note(b.dataset.approve), true)));
  box.querySelectorAll('[data-deny]').forEach((b) => (b.onclick = () => reply(+b.dataset.deny, note(b.dataset.deny), false)));
  box.querySelectorAll('[data-answer]').forEach((b) => (b.onclick = () => { const t = note(b.dataset.answer); if (t.trim()) reply(+b.dataset.answer, t, false); }));
}
async function reply(id, text, approved) { await api(`objectives/${id}/reply`, { text, approved }); refresh(); }

// ---------- objetivos ----------
function renderObjList() {
  $('#objList').innerHTML = state.objectives.map((o) => `<li data-id="${o.id}" class="${o.id === state.obj ? 'on' : ''}">
    <div class="top"><span class="dot ${o.working ? 'on' : ''}"></span>${esc(o.ref)} · ${o.team ? 'equipo ' + esc(o.team) : esc(o.agent)}<span class="spacer"></span><span class="st ${o.status}">${STATUS[o.status] || o.status}</span></div>
    <div class="txt">${esc(o.text)}</div></li>`).join('') || '<li class="hint">Todavía no hay objetivos.</li>';
  $('#objList').querySelectorAll('li[data-id]').forEach((li) => (li.onclick = () => openObj(+li.dataset.id)));
}
function openObj(id) { state.obj = id; history.replaceState(null, '', '?o=' + id); renderObjList(); loadObj(); }
function boardHtml(tasks) {
  return LANES.map(([st, label]) => {
    const cs = tasks.filter((t) => t.status === st);
    return `<div class="lane"><h6><span>${label}</span><span>${cs.length}</span></h6><div class="cards">${cs.map((t) => `<div class="card"><div class="cid">#${t.id}</div>${esc(t.title)}${t.depends && t.depends.length ? `<div class="dep">depende de ${t.depends.map((d) => '#' + d).join(', ')}</div>` : ''}${t.notes ? `<div class="notes">${esc(t.notes)}</div>` : ''}${t.owner ? `<div class="own">${esc(t.owner)}</div>` : ''}</div>`).join('')}</div></div>`;
  }).join('');
}
function logHtml(rows, el) {
  const fresh = [];
  const html = rows.map((r) => {
    const key = el.id + ':' + r.id;
    const isNew = state.seen.size > 0 && !state.seen.has(key);
    fresh.push(key);
    return `<li class="${isNew ? 'fresh' : ''}"><span class="t">${hhmm(r.at)}</span><span class="a">${esc(r.actor)}</span><span class="k ${esc(r.kind.split(' ')[0])}">${esc(KIND[r.kind] || r.kind)} ${esc(r.ref)}</span>${r.text ? `<span class="x">${esc(r.text)}</span>` : ''}</li>`;
  }).join('');
  el.innerHTML = html || '<li class="hint">Nada todavía.</li>';
  fresh.forEach((x) => state.seen.add(x));
}
async function loadObj() {
  if (!state.obj) return;
  const r = await api('objectives/' + state.obj);
  if (!r.ok) { $('#objDetail').innerHTML = '<div class="empty">Ese objetivo no existe.</div>'; return; }
  const o = r.data;
  const pct = o.budget_tokens > 0 ? Math.min(100, Math.round((100 * o.spent) / o.budget_tokens)) : 0;
  const open = ['active', 'waiting', 'paused'].includes(o.status);
  $('#objDetail').innerHTML = `
    <div class="dhead"><span class="ref">${esc(o.ref)}</span><span class="st ${o.status}">${STATUS[o.status] || o.status}</span><span class="dot ${o.working ? 'on' : ''}"></span>${o.working ? 'trabajando ahora' : ''}<span>· ${o.team ? `equipo <b>${esc(o.team)}</b>, lo lidera <b>${esc(o.agent)}</b>` : `agente <b>${esc(o.agent)}</b>`}</span></div>
    <div class="dtext">${esc(o.text)}</div>
    <div class="kv"><span>turnos <b>${o.turns}</b></span><span>gastado <b>${k(o.spent)}</b>${o.budget_tokens ? ' de ' + k(o.budget_tokens) : ''}</span><span>ronda cada <b>${o.round_seconds}s</b></span><span>actualizado <b>${ago(o.updated_at)}</b></span></div>
    ${o.budget_tokens ? `<div class="meter ${pct > 80 ? 'hot' : ''}"><i style="width:${pct}%"></i></div>` : ''}
    <div style="height:14px"></div>
    ${o.status === 'waiting' ? `<div class="box q"><h5>${o.question_kind === 'approval' ? 'pide aprobación' : 'pregunta'}</h5><p>${esc(o.question)}</p></div>` : ''}
    ${o.progress ? `<div class="box"><h5>último informe</h5><p>${esc(o.progress)}</p></div>` : ''}
    ${o.result ? `<div class="box res"><h5>${o.status === 'failed' ? 'por qué falló' : 'resultado'}</h5><p>${esc(o.result)}</p></div>` : ''}
    ${open ? `<div class="dacts">${o.status === 'paused' ? `<button data-resume>Seguir (presupuesto aparte)</button>` : ''}<button class="no" data-cancel>Cancelar objetivo</button></div>` : ''}
    <div class="secttl">${o.team ? 'Tablero del equipo' : 'Su tablero'}</div>
    <div class="board">${boardHtml(o.tasks)}</div>`;
  const c = $('#objDetail [data-cancel]');
  if (c) c.onclick = async () => { if (c.dataset.sure) { await api(`objectives/${o.id}/cancel`, {}); refresh(); } else { c.dataset.sure = '1'; c.textContent = '¿seguro? cancelar'; } };
  const rs = $('#objDetail [data-resume]');
  if (rs) rs.onclick = () => reply(o.id, 'Seguí: te doy más presupuesto.', false);
  logHtml(o.ledger, $('#objLog'));
}
$('#newObj').onclick = () => { $('#objForm').hidden = !$('#objForm').hidden; if (!$('#objForm').hidden) $('#fText').focus(); };
$('#fCancel').onclick = () => ($('#objForm').hidden = true);
$('#objForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const target = $('#fAgent').value;
  const body = { text: $('#fText').value.trim(), round_seconds: +$('#fRound').value || 20, budget_tokens: +$('#fBudget').value || 0 };
  if (target.startsWith('team:')) body.team = target.slice(5); else body.agent = target;
  if (!target || !body.text) { $('#fErr').textContent = 'Elegí un agente o un equipo y escribí qué tiene que lograr.'; return; }
  const r = await api('objectives/add', body);
  if (!r.ok) { $('#fErr').textContent = r.data.error || 'no se pudo crear'; return; }
  $('#fErr').textContent = ''; $('#fText').value = ''; $('#objForm').hidden = true;
  await refreshObjectives(); openObj(r.data.id);
};
async function refreshObjectives() {
  const r = await api('objectives');
  if (!r.ok) return false;
  state.objectives = r.data.objectives; state.agents = r.data.agents; state.teamsMeta = r.data.teams || [];
  const ap = await api('approvals');
  if (ap.ok) state.approvals = ap.data.approvals || [];
  const sel = $('#fAgent'); const cur = sel.value;
  sel.innerHTML = (state.teamsMeta.length ? `<optgroup label="equipos">${state.teamsMeta.map((t) => `<option value="team:${esc(t.id)}">equipo ${esc(t.id)} (lo lidera ${esc(t.lead)})</option>`).join('')}</optgroup>` : '') +
    `<optgroup label="agentes">${state.agents.map((a) => `<option value="${esc(a.id)}" title="${esc(a.description)}">${esc(a.id)}${a.description ? ' — ' + esc(a.description.slice(0, 50)) : ''}</option>`).join('')}</optgroup>`;
  if (cur) sel.value = cur;
  if (!state.obj && state.objectives.length) state.obj = state.objectives[0].id;
  renderObjList(); renderAttention();
  return true;
}

// ---------- equipos ----------
function layout(team) {
  // niveles por jefe (raíces arriba); dentro de cada nivel, en el orden del archivo
  const by = Object.fromEntries(team.members.map((m) => [m.agent, m]));
  const level = {};
  const lv = (a, seen = new Set()) => { if (level[a] !== undefined) return level[a]; const m = by[a]; if (!m || !m.reports_to || !by[m.reports_to] || seen.has(a)) return (level[a] = 0); seen.add(a); return (level[a] = lv(m.reports_to, seen) + 1); };
  team.members.forEach((m) => lv(m.agent));
  const rows = {};
  team.members.forEach((m) => (rows[level[m.agent]] = rows[level[m.agent]] || []).push(m.agent));
  // ancho según la fila más poblada: con pocos agentes el grafo no queda diminuto
  const widest = Math.max(...Object.values(rows).map((r) => r.length));
  const nodeW = 184, nodeH = 70, gap = 56, rowH = 130;
  const W = Math.max(560, widest * (nodeW + gap) + 80);
  const depth = Math.max(...Object.keys(rows).map(Number)) + 1;
  const pos = {};
  Object.entries(rows).forEach(([l, list]) => list.forEach((a, i) => (pos[a] = { x: W / 2 + (i - (list.length - 1) / 2) * (nodeW + gap), y: 60 + Number(l) * rowH })));
  return { pos, W, H: 60 + depth * rowH, nodeW, nodeH };
}
function hotPairs(team) {
  // flechas que se encienden: mensajes de los últimos 25 s (registro: actor "message" ref "→ dest")
  const now = Date.now() / 1000; const hot = new Set();
  team.ledger.filter((r) => r.kind === 'message' && now - r.at < 25).forEach((r) => { const d = String(r.ref).replace('→', '').trim(); hot.add([r.actor, d].sort().join('|')); });
  return hot;
}
function renderGraph(team) {
  const svg = $('#graph');
  if (!team) { svg.innerHTML = ''; return; }
  const { pos, W, H, nodeW, nodeH } = layout(team);
  svg.setAttribute('viewBox', `0 0 ${W} ${Math.max(H, 260)}`);
  const hot = hotPairs(team);
  let edges = '';
  team.members.forEach((m) => { if (m.reports_to && pos[m.reports_to]) { const a = pos[m.reports_to], b = pos[m.agent]; const h = hot.has([m.agent, m.reports_to].sort().join('|')); edges += `<path class="edge ${h ? 'hot' : ''}" d="M${a.x},${a.y + nodeH / 2} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y - nodeH / 2}"/>`; } });
  (team.talks || []).forEach(([x, y]) => { if (pos[x] && pos[y]) { const a = pos[x], b = pos[y]; const h = hot.has([x, y].sort().join('|')); edges += `<path class="edge talk ${h ? 'hot' : ''}" d="M${a.x},${a.y} Q${(a.x + b.x) / 2},${Math.min(a.y, b.y) - 50} ${b.x},${b.y}"/>`; } });
  const nodes = team.members.map((m) => { const p = pos[m.agent]; return `<g class="node ${m.working ? 'working' : ''} ${m.missing ? 'missing' : ''}" transform="translate(${p.x - nodeW / 2},${p.y - nodeH / 2})"><title>${esc(m.description || m.agent)}${m.missing ? ' — falta su archivo de agente' : ''}</title><rect width="${nodeW}" height="${nodeH}"/><circle class="pip" cx="${nodeW - 14}" cy="14" r="4"/><text class="role" x="14" y="26">${esc(m.role)}</text><text class="id" x="14" y="45">${esc(m.agent)}</text><text class="state" x="14" y="61">${m.missing ? 'sin archivo' : m.working ? 'trabajando…' : 'hoy ' + k(m.spent_today)}</text></g>`; }).join('');
  svg.innerHTML = edges + nodes;
  svg.querySelectorAll('.node').forEach((g, i) => { const a = team.members[i].agent; g.classList.toggle('sel', state.draft && state.sel === a); g.onclick = () => { if (state.draft) { state.sel = a; renderTeams(); } }; });
}
// ---------- editor: un borrador del equipo (miembros + datos de sus agentes) que se guarda entero ----------
function draftFrom(team) {
  return { isNew: false, id: team.id, description: team.description, round_minutes: team.round_minutes, budget_daily_tokens: team.budget_daily_tokens, worktrees: team.worktrees !== false, talks: (team.talks || []).map((p) => p.slice()),
    members: team.members.map((m) => ({ agent: m.agent, role: m.role, reports_to: m.reports_to, description: m.description, system: m.system, preset: presetOf(m.tools), permission: m.permission || 'strict', dirty: false })) };
}
function presetOf(tools) { const t = tools || []; if (!t.length) return 'none'; if (t.includes('write') || t.includes('edit')) return 'code'; return 'read'; }
function startNewTeam() {
  state.draft = { isNew: true, id: '', description: '', round_minutes: 0, budget_daily_tokens: 300000, worktrees: true, talks: [], members: [{ agent: 'lider', role: 'Líder', reports_to: '', description: '', system: '', preset: 'code', permission: 'strict', dirty: true }] };
  state.sel = 'lider'; renderTeams();
}
function draftTeamView() {
  const d = state.draft;
  return { id: d.id || 'nuevo', description: d.description, talks: d.talks, round_minutes: d.round_minutes, budget_daily_tokens: d.budget_daily_tokens, tasks: [], ledger: [],
    members: d.members.map((m) => ({ agent: m.agent, role: m.role || m.agent, reports_to: m.reports_to, description: m.description, missing: false, working: false, spent_today: 0 })) };
}
function editorHtml() {
  const d = state.draft; const m = d.members.find((x) => x.agent === state.sel);
  const others = d.members.filter((x) => x !== m).map((x) => x.agent);
  const talksWith = m ? d.talks.filter((p) => p.includes(m.agent)).map((p) => (p[0] === m.agent ? p[1] : p[0])) : [];
  return `<div class="editor">
    <div class="edcol">
      <h5>Equipo</h5>
      <label>id <input id="eId" value="${esc(d.id)}" ${d.isNew ? '' : 'disabled'} placeholder="empresa"></label>
      <label>descripción <input id="eDesc" value="${esc(d.description)}"></label>
      <div class="row2"><label>rondas (min, 0 = no) <input id="eRound" type="number" min="0" value="${d.round_minutes}"></label><label>tope diario por agente <input id="eBudget" type="number" min="0" step="10000" value="${d.budget_daily_tokens}"></label></div>
      <label class="chk"><input id="eWt" type="checkbox" ${d.worktrees ? 'checked' : ''}> cada agente en su copia de git (rama y autor propios)</label>
      <div class="row2"><button id="eAdd">+ agente</button><button class="primary" id="eSave">Guardar equipo</button></div>
      <div class="row2"><button id="eCancel">Descartar cambios</button></div>
      <p class="ferr" id="eErr"></p>
    </div>
    <div class="edcol">${m ? `
      <h5>Agente · tocá un nodo del grafo para elegir otro</h5>
      <div class="row2"><label>id <input id="mId" value="${esc(m.agent)}"></label><label>rol <input id="mRole" value="${esc(m.role)}" placeholder="CTO"></label></div>
      <label>reporta a <select id="mBoss"><option value="">(nadie: lidera)</option>${others.map((a) => `<option ${a === m.reports_to ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      <label>también habla con <span class="chips">${others.map((a) => `<label class="chip"><input type="checkbox" data-talk="${esc(a)}" ${talksWith.includes(a) ? 'checked' : ''}>${esc(a)}</label>`).join('') || '<i>nadie más</i>'}</span></label>
      <label>descripción (una línea: para qué está) <input id="mDesc" value="${esc(m.description)}"></label>
      <label>personalidad y cómo trabaja <textarea id="mSys" rows="6" placeholder="Sos el CTO: decidís cómo se construye, revisás el código de los demás…">${esc(m.system)}</textarea></label>
      <div class="row2"><label>herramientas <select id="mPreset">${PRESETS.map(([v, l]) => `<option value="${v}" ${v === m.preset ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>permiso <select id="mPerm">${['strict', 'ask', 'yolo'].map((p) => `<option ${p === m.permission ? 'selected' : ''}>${p}</option>`).join('')}</select></label></div>
      ${d.members.length > 1 ? '<button class="no" id="mDel">Quitar del equipo</button>' : ''}` : '<div class="empty">Tocá un nodo del grafo.</div>'}
    </div></div>`;
}
function bindEditor() {
  const d = state.draft; const m = d.members.find((x) => x.agent === state.sel);
  const on = (id, ev, fn) => { const e = $(id); if (e) e[ev] = fn; };
  on('#eId', 'oninput', (e) => (d.id = e.target.value.trim().toLowerCase()));
  on('#eDesc', 'oninput', (e) => (d.description = e.target.value));
  on('#eRound', 'oninput', (e) => (d.round_minutes = +e.target.value || 0));
  on('#eBudget', 'oninput', (e) => (d.budget_daily_tokens = +e.target.value || 0));
  on('#eWt', 'onchange', (e) => (d.worktrees = e.target.checked));
  on('#eCancel', 'onclick', () => { state.draft = null; state.sel = null; renderTeams(); });
  on('#eAdd', 'onclick', () => { let n = 1; while (d.members.some((x) => x.agent === 'agente-' + n)) n++; const boss = (d.members.find((x) => !x.reports_to) || {}).agent || ''; d.members.push({ agent: 'agente-' + n, role: 'Rol', reports_to: boss, description: '', system: '', preset: 'code', permission: 'strict', dirty: true }); state.sel = 'agente-' + n; renderTeams(); });
  on('#eSave', 'onclick', saveDraft);
  if (!m) return;
  const touch = () => (m.dirty = true);
  on('#mId', 'onchange', (e) => { const v = e.target.value.trim().toLowerCase(); if (!v || d.members.some((x) => x !== m && x.agent === v)) { e.target.value = m.agent; return; } d.members.forEach((x) => { if (x.reports_to === m.agent) x.reports_to = v; }); d.talks = d.talks.map((p) => p.map((a) => (a === m.agent ? v : a))); m.agent = v; state.sel = v; touch(); renderTeams(); });
  on('#mRole', 'oninput', (e) => { m.role = e.target.value; renderGraph(draftTeamView()); });
  on('#mBoss', 'onchange', (e) => { m.reports_to = e.target.value; renderGraph(draftTeamView()); });
  on('#mDesc', 'oninput', (e) => { m.description = e.target.value; touch(); });
  on('#mSys', 'oninput', (e) => { m.system = e.target.value; touch(); });
  on('#mPreset', 'onchange', (e) => { m.preset = e.target.value; touch(); });
  on('#mPerm', 'onchange', (e) => { m.permission = e.target.value; touch(); });
  on('#mDel', 'onclick', () => { d.members = d.members.filter((x) => x !== m); d.members.forEach((x) => { if (x.reports_to === m.agent) x.reports_to = m.reports_to; }); d.talks = d.talks.filter((p) => !p.includes(m.agent)); state.sel = d.members[0].agent; renderTeams(); });
  document.querySelectorAll('[data-talk]').forEach((c) => (c.onchange = () => { const o = c.dataset.talk; d.talks = d.talks.filter((p) => !(p.includes(o) && p.includes(m.agent))); if (c.checked) d.talks.push([m.agent, o]); renderGraph(draftTeamView()); }));
}
async function saveDraft() {
  const d = state.draft;
  const body = { team: { id: d.id, description: d.description, members: d.members.map((m) => ({ agent: m.agent, role: m.role || m.agent, reports_to: m.reports_to })), talks: d.talks, round_minutes: d.round_minutes, budget_daily_tokens: d.budget_daily_tokens, worktrees: d.worktrees },
    agents: d.members.filter((m) => m.dirty || m.system).map((m) => ({ id: m.agent, description: m.description, system: m.system || `Sos ${m.role || m.agent} del equipo ${d.id}.`, preset: m.preset, permission: m.permission })) };
  const r = await api('teams/save', body);
  if (!r.ok) { $('#eErr').textContent = r.data.error || 'no se pudo guardar'; return; }
  state.team = d.id; state.draft = null; state.sel = null;
  state.teams = r.data.teams; renderTeams();
}

function renderTeams() {
  const list = $('#teamList');
  list.innerHTML = state.teams.map((t) => `<li data-id="${esc(t.id)}" class="${t.id === state.team ? 'on' : ''}"><div class="top">${t.members.some((m) => m.working) ? '<span class="dot on"></span>' : '<span class="dot"></span>'}${esc(t.id)} · ${t.members.length} agentes</div><div class="txt">${esc(t.description || t.members.map((m) => m.role).join(', '))}</div></li>`).join('');
  list.querySelectorAll('li[data-id]').forEach((li) => (li.onclick = () => { if (state.draft) return; state.team = li.dataset.id; renderTeams(); }));
  $('#teamHint').innerHTML = (state.teams.length ? '' : 'Todavía no hay equipos. ') + '<button id="newTeam">+ equipo</button>';
  $('#newTeam').onclick = startNewTeam;
  const team = state.teams.find((t) => t.id === state.team) || state.teams[0];
  if (team) state.team = team.id;
  if (state.draft) {
    renderGraph(draftTeamView());
    $('#teamInfo').innerHTML = '<span><b>editando</b> — los cambios se guardan con «Guardar equipo»</span>';
    $('#teamBoard').innerHTML = editorHtml(); bindEditor();
    return;
  }
  renderGraph(team);
  $('#teamInfo').innerHTML = team ? `<button id="editTeam">editar</button><span>equipo <b>${esc(team.id)}</b></span><span>rondas <b>${team.round_minutes ? 'cada ' + team.round_minutes + ' min' : 'no'}</b></span><span>tope diario <b>${team.budget_daily_tokens ? k(team.budget_daily_tokens) + ' por agente' : 'sin tope'}</b></span><span>línea llena: reporta a · punteada: también se hablan</span>` : '';
  $('#teamBoard').innerHTML = team ? boardHtml(team.tasks) : '';
  if (team) { $('#editTeam').onclick = () => { state.draft = draftFrom(team); state.sel = team.lead || team.members[0].agent; renderTeams(); }; logHtml(team.ledger, $('#teamLog')); }
}
async function refreshTeams() {
  const r = await api('teams');
  if (!r.ok) return false;
  state.teams = r.data.teams;
  // ?edit=<equipo> abre el editor de ese equipo (enlaces directos, capturas)
  const ed = new URLSearchParams(location.search).get('edit');
  if (ed && !state.editOpened) { state.editOpened = true; const t = state.teams.find((x) => x.id === ed); if (t) { state.team = t.id; state.draft = draftFrom(t); state.sel = t.lead || t.members[0].agent; renderTeams(); return true; } }
  if (state.draft) return true;   // editando: el pulso no pisa el formulario
  renderTeams();
  return true;
}

// ---------- pulso ----------
async function refresh() {
  let ok = await refreshObjectives();
  if (state.tab === 'objectives') await loadObj();
  else ok = (await refreshTeams()) && ok;
  $('#live').classList.toggle('off', !ok);
}
showTab(state.tab);
setInterval(refresh, 2500);
