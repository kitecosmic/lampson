// teams.js — la pantalla de equipos y objetivos (public/teams.html). Página propia: no depende de los módulos del
// agente de programación. Se actualiza sola (cada 2,5 s) desde la API privada del workspace:
//   GET  api/objectives · api/objectives/:id · api/teams
//   POST api/objectives/add · api/objectives/:id/reply · api/objectives/:id/cancel
const $ = (s) => document.querySelector(s);
const BASE = (location.pathname.match(/^\/w\/[^/]+/) || [''])[0];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LANES = [['todo', 'por hacer'], ['doing', 'en curso'], ['review', 'en revisión'], ['done', 'hecho'], ['blocked', 'bloqueada']];
const STATUS = { active: 'trabajando', waiting: 'te espera', done: 'hecho', failed: 'falló', cancelled: 'cancelado', paused: 'sin presupuesto' };
const KIND = { added: 'agregó', claimed: 'tomó', updated: 'movió', message: 'escribió', report: 'informó', asked: 'preguntó', 'approval requested': 'pide aprobación', approved: 'aprobó', denied: 'denegó', answered: 'respondió', done: 'terminó', failed: 'falló', cancelled: 'canceló', paused: 'pausado', budget: 'presupuesto', objective: 'nuevo objetivo', error: 'error' };

const state = { tab: new URLSearchParams(location.search).get('tab') || localStorage.getItem('lampson.teams.tab') || 'objectives', obj: Number(new URLSearchParams(location.search).get('o')) || null, team: null, objectives: [], agents: [], teams: [], seen: new Set() };

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
  const box = $('#attention');
  box.hidden = waiting.length === 0;
  const keep = {};
  box.querySelectorAll('input[data-id]').forEach((i) => (keep[i.dataset.id] = i.value));
  box.innerHTML = waiting.map((o) => {
    const ap = o.question_kind === 'approval';
    return `<div class="ask ${ap ? 'approval' : ''}"><span class="who">${esc(o.agent)} ${ap ? 'pide aprobación' : 'pregunta'}</span>
      <div class="q"><span class="ref" data-open="${o.id}">${esc(o.ref)}</span> ${esc(o.question)}</div>
      <div class="acts">${ap
        ? `<input data-id="${o.id}" placeholder="nota (opcional)"><button class="ok" data-approve="${o.id}">Aprobar</button><button class="no" data-deny="${o.id}">Denegar</button>`
        : `<input data-id="${o.id}" placeholder="tu respuesta"><button class="primary" data-answer="${o.id}">Responder</button>`}</div></div>`;
  }).join('');
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
    <div class="top"><span class="dot ${o.working ? 'on' : ''}"></span>${esc(o.ref)} · ${esc(o.agent)}<span class="spacer"></span><span class="st ${o.status}">${STATUS[o.status] || o.status}</span></div>
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
    <div class="dhead"><span class="ref">${esc(o.ref)}</span><span class="st ${o.status}">${STATUS[o.status] || o.status}</span><span class="dot ${o.working ? 'on' : ''}"></span>${o.working ? 'trabajando ahora' : ''}<span>· agente <b>${esc(o.agent)}</b></span></div>
    <div class="dtext">${esc(o.text)}</div>
    <div class="kv"><span>turnos <b>${o.turns}</b></span><span>gastado <b>${k(o.spent)}</b>${o.budget_tokens ? ' de ' + k(o.budget_tokens) : ''}</span><span>ronda cada <b>${o.round_seconds}s</b></span><span>actualizado <b>${ago(o.updated_at)}</b></span></div>
    ${o.budget_tokens ? `<div class="meter ${pct > 80 ? 'hot' : ''}"><i style="width:${pct}%"></i></div>` : ''}
    <div style="height:14px"></div>
    ${o.status === 'waiting' ? `<div class="box q"><h5>${o.question_kind === 'approval' ? 'pide aprobación' : 'pregunta'}</h5><p>${esc(o.question)}</p></div>` : ''}
    ${o.progress ? `<div class="box"><h5>último informe</h5><p>${esc(o.progress)}</p></div>` : ''}
    ${o.result ? `<div class="box res"><h5>${o.status === 'failed' ? 'por qué falló' : 'resultado'}</h5><p>${esc(o.result)}</p></div>` : ''}
    ${open ? `<div class="dacts">${o.status === 'paused' ? `<button data-resume>Seguir (presupuesto aparte)</button>` : ''}<button class="no" data-cancel>Cancelar objetivo</button></div>` : ''}
    <div class="secttl">Su tablero</div>
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
  const body = { agent: $('#fAgent').value, text: $('#fText').value.trim(), round_seconds: +$('#fRound').value || 20, budget_tokens: +$('#fBudget').value || 0 };
  if (!body.agent || !body.text) { $('#fErr').textContent = 'Elegí un agente y escribí qué tiene que lograr.'; return; }
  const r = await api('objectives/add', body);
  if (!r.ok) { $('#fErr').textContent = r.data.error || 'no se pudo crear'; return; }
  $('#fErr').textContent = ''; $('#fText').value = ''; $('#objForm').hidden = true;
  await refreshObjectives(); openObj(r.data.id);
};
async function refreshObjectives() {
  const r = await api('objectives');
  if (!r.ok) return false;
  state.objectives = r.data.objectives; state.agents = r.data.agents;
  const sel = $('#fAgent'); const cur = sel.value;
  sel.innerHTML = state.agents.map((a) => `<option value="${esc(a.id)}" title="${esc(a.description)}">${esc(a.id)}${a.description ? ' — ' + esc(a.description.slice(0, 50)) : ''}</option>`).join('');
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
}
function renderTeams() {
  const list = $('#teamList');
  list.innerHTML = state.teams.map((t) => `<li data-id="${esc(t.id)}" class="${t.id === state.team ? 'on' : ''}"><div class="top">${t.members.some((m) => m.working) ? '<span class="dot on"></span>' : '<span class="dot"></span>'}${esc(t.id)} · ${t.members.length} agentes</div><div class="txt">${esc(t.description || t.members.map((m) => m.role).join(', '))}</div></li>`).join('');
  list.querySelectorAll('li[data-id]').forEach((li) => (li.onclick = () => { state.team = li.dataset.id; renderTeams(); }));
  $('#teamHint').innerHTML = state.teams.length ? '' : 'Un equipo es un archivo del proyecto: <code>.lampson/teams/&lt;id&gt;.team.json</code> con sus agentes, sus roles y a quién reporta cada uno. Pronto también desde acá.';
  const team = state.teams.find((t) => t.id === state.team) || state.teams[0];
  if (team) state.team = team.id;
  renderGraph(team);
  $('#teamInfo').innerHTML = team ? `<span>equipo <b>${esc(team.id)}</b></span><span>rondas <b>${team.round_minutes ? 'cada ' + team.round_minutes + ' min' : 'no'}</b></span><span>tope diario <b>${team.budget_daily_tokens ? k(team.budget_daily_tokens) + ' por agente' : 'sin tope'}</b></span><span>línea llena: reporta a · punteada: también se hablan</span>` : '';
  $('#teamBoard').innerHTML = team ? boardHtml(team.tasks) : '';
  if (team) logHtml(team.ledger, $('#teamLog'));
}
async function refreshTeams() {
  const r = await api('teams');
  if (!r.ok) return false;
  state.teams = r.data.teams;
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
