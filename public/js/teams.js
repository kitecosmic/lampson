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
if (new URLSearchParams(location.search).get('new')) { try { localStorage.setItem('lampson.teams.tab', 'teams'); } catch (e) {} }
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
$('#crProj').textContent = BASE ? BASE.slice(3).replace(/-[0-9a-f]{8}$/, '') : 'local';
$('#crProj').href = BASE || '/';
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
    return `<li class="${isNew ? 'fresh' : ''}"><span class="t">${hhmm(r.at)}</span><span class="a">${esc(r.actor)}</span><span class="k ${esc(r.kind.split(' ')[0])}">${esc(KIND[r.kind] || r.kind)} ${esc(r.ref)}</span>${r.text && r.text !== 'null' ? `<span class="x">${esc(r.text)}</span>` : ''}</li>`;
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
  // ?objetivo=<equipo> (desde /equipos → «Darle un objetivo»): el formulario abierto con ese equipo elegido
  const forTeam = new URLSearchParams(location.search).get('objetivo');
  if (forTeam && !state.objOpened) {
    state.objOpened = true;
    if (sel.querySelector(`option[value="team:${CSS.escape(forTeam)}"]`)) sel.value = 'team:' + forTeam;
    $('#objForm').hidden = false; $('#fText').focus();
    history.replaceState(null, '', location.pathname + '?tab=objectives');
  }
  if (!state.obj && state.objectives.length) state.obj = state.objectives[0].id;
  renderObjList(); renderAttention();
  return true;
}

// ---------- equipos: la lista de tarjetas; el lienzo (js/flow.js), al crear o editar uno ----------
// Cada miembro es un ASIENTO: su tarjeta muestra rol, para qué está y qué puede hacer. Unir dos asientos (el punto de
// abajo de uno hasta el otro) es la jerarquía: el de abajo le reporta. Siempre hay un líder (d.lead): no se elimina.
// Un asiento puede quedar suelto mientras se arma el equipo; al guardar, le reporta al líder. Las punteadas («también
// hablan») son de verdad: el editor las propone al unir dos asientos bajo el mismo jefe, y se borran como cualquiera.
const flow = Flow.create($('#graph'));
state.newAt = {};
const TOOLS_LABEL = { code: 'edita y corre comandos', read: 'lee y corre comandos', none: 'solo coordina' };
function hotPairs(team) {
  // conexiones que se encienden: mensajes de los últimos 25 s (registro: actor "message" ref "→ dest")
  const now = Date.now() / 1000; const hot = new Set();
  (team.ledger || []).filter((r) => r.kind === 'message' && now - r.at < 25).forEach((r) => { const d = String(r.ref).replace('→', '').trim(); hot.add([r.actor, d].sort().join('|')); });
  return hot;
}
const has = (d, a) => d.members.some((x) => x.agent === a);
const slugify = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const ID_OK = /^[a-z0-9][a-z0-9-]{0,39}$/;
// el líder del borrador existe y no le reporta a nadie; un jefe que ya no está deja suelto a su asiento
function normalize(d) {
  if (!has(d, d.lead)) d.lead = (d.members.find((m) => !m.reports_to) || d.members[0]).agent;
  d.members.forEach((m) => { if (m.agent === d.lead || !has(d, m.reports_to)) m.reports_to = ''; });
  d.talks = d.talks.filter((p) => p.every((a) => has(d, a)) && p[0] !== p[1]);
  return d.lead;
}
const loose = (d, m) => m.agent !== d.lead && !m.reports_to;
function renderGraph() {
  const d = state.draft, team = d && !d.isNew ? state.teams.find((t) => t.id === d.id) : null;
  if (!d) { state.lastMode = 'list'; return; }
  const members = d.members, talks = d.talks;
  const lead = normalize(d);
  // los que están trabajando ahora (del equipo guardado): se ven en el lienzo mientras se edita
  const live = Object.fromEntries((team ? team.members : []).map((m) => [m.agent, m]));
  const hot = team ? hotPairs(team) : new Set();
  const nodes = members.map((m) => ({ id: m.agent, title: m.role || m.agent, desc: m.description || (d ? 'Tocalo para darle nombre y decir para qué está.' : ''), lead: m.agent === lead, loose: d && loose(d, m),
    meta: m.missing ? 'falta su archivo de agente' : m.working ? 'trabajando…' : d && loose(d, m) ? 'suelto · al guardar le reporta al líder' : d ? TOOLS_LABEL[m.preset] || '' : (TOOLS_LABEL[presetOf(m.tools)] || '') + (m.spent_today ? ' · hoy ' + k(m.spent_today) : ''),
    avatar: (m.role || m.agent).normalize('NFD').replace(/\p{M}/gu, '').slice(0, 2), working: (live[m.agent] || {}).working, missing: (live[m.agent] || {}).missing, at: state.newAt[m.agent] }));
  const edges = members.filter((m) => m.reports_to && members.some((x) => x.agent === m.reports_to)).map((m) => ({ kind: 'reports', from: m.reports_to, to: m.agent, hot: hot.has([m.agent, m.reports_to].sort().join('|')) }))
    .concat(talks.map(([x, y]) => ({ kind: 'talk', from: x, to: y, hot: hot.has([x, y].sort().join('|')) })));
  // al abrir el lienzo (venía de la lista), encuadrar
  if (state.lastMode !== 'edit') { state.lastMode = 'edit'; requestAnimationFrame(() => flow.fit()); }
  flow.render({ nodes, edges, editable: true, selected: state.sel, storeKey: 'lampson.flow:' + BASE + ':' + (d.isNew ? '__nuevo' : d.id),
    onSelect: (id) => { state.sel = id; renderTeams(); },
    onConnect: (from, to) => connectDraft(from, to),
    onConnectEmpty: (from, pos) => addSeat(from, pos),
    onDeleteEdge: (e) => { const dd = state.draft; if (e.kind === 'reports') { const m = dd.members.find((x) => x.agent === e.to); if (m) m.reports_to = ''; } else dd.talks = dd.talks.filter((p) => !(p.includes(e.from) && p.includes(e.to))); renderTeams(); } });
  state.newAt = {};
}
// al quedar bajo un jefe: propone hablar con los que ya le reportan a ese jefe (punteadas que se pueden borrar)
function proposeTalks(d, agent) {
  const m = d.members.find((x) => x.agent === agent); if (!m || !m.reports_to) return;
  d.members.filter((x) => x.agent !== agent && x.reports_to === m.reports_to).forEach((x) => { if (!d.talks.some((p) => p.includes(agent) && p.includes(x.agent))) d.talks.push([x.agent, agent]); });
}
// ¿`a` está por encima de `b` (su jefe, el jefe de su jefe…)?
function above(d, a, b) {
  let up = (d.members.find((x) => x.agent === b) || {}).reports_to; const seen = new Set();
  while (up && !seen.has(up)) { if (up === a) return true; seen.add(up); up = (d.members.find((x) => x.agent === up) || {}).reports_to; }
  return false;
}
// unir dos asientos: el que recibe la línea le reporta al que la tiró. Pero arrastrar nunca cambia el liderazgo (para eso
// está «Hacer líder»): si se suelta sobre el líder, o sobre alguien que ya está por encima, se entiende al revés.
function connectDraft(from, to) {
  const d = state.draft; if (!d) return;
  if (to === d.lead || above(d, to, from)) [from, to] = [to, from];
  if (to === d.lead || above(d, to, from)) return;   // sin ciclos
  d.members.find((x) => x.agent === to).reports_to = from;
  d.talks = d.talks.filter((p) => !(p.includes(from) && p.includes(to)));
  proposeTalks(d, to);
  flow.placeUnder(to, from);
  renderTeams();
}
// + asiento: debajo del elegido; sin nada elegido, suelto en el lienzo
function addSeat(boss, at) {
  const d = state.draft; let n = 1; while (has(d, 'asiento-' + n)) n++;
  const id = 'asiento-' + n, top = boss === undefined ? state.sel || '' : boss || '';
  state.newAt[id] = at || flow.freeSpot(top || null);
  // nombre provisorio distinto para cada uno («Asiento 3»); el rol queda elegido para escribir el de verdad
  let r = d.members.length + 1; while (d.members.some((x) => x.role === 'Asiento ' + r)) r++;
  d.members.push({ agent: id, role: 'Asiento ' + r, reports_to: top, description: '', system: '', preset: 'code', permission: 'strict', dirty: true });
  proposeTalks(d, id);
  state.sel = id; renderTeams();
  if (top && flow.placeUnder(id, top)) renderGraph();
  const ri = $('#mRole'); if (ri) { ri.focus(); ri.select(); }
}
function removeSeat(id) {
  const d = state.draft; if (id === d.lead) return;
  const m = d.members.find((x) => x.agent === id);
  d.members = d.members.filter((x) => x !== m); d.members.forEach((x) => { if (x.reports_to === id) x.reports_to = m.reports_to; });
  d.talks = d.talks.filter((p) => !p.includes(id)); state.sel = null; renderTeams();
}
// «Hacer líder»: el elegido pasa arriba y el líder anterior le reporta
function makeLeader(id) {
  const d = state.draft; if (id === d.lead) return;
  const old = d.lead; d.lead = id;
  d.members.find((x) => x.agent === id).reports_to = '';
  d.members.find((x) => x.agent === old).reports_to = id;
  d.talks = d.talks.filter((p) => !(p.includes(id) && p.includes(old)));
  proposeTalks(d, old); renderTeams();
}
// ---------- plantillas: un equipo armado para empezar (después se edita en el lienzo) ----------
const TEMPLATES = [
  { id: 'software', title: 'Desarrollo de software', desc: 'Un CTO que decide y revisa, un desarrollador que construye y QA que prueba.', members: [
    ['cto', 'CTO', '', 'code', 'Decide cómo se construye, reparte el trabajo y revisa el código antes de mezclarlo.'],
    ['dev', 'Dev', 'cto', 'code', 'Implementa lo que se pide, con tests, en su propia rama.'],
    ['qa', 'QA', 'cto', 'read', 'Prueba lo que se hizo, corre los tests y reporta lo que falla.']], talks: [['dev', 'qa']] },
  { id: 'empresa', title: 'Empresa o startup', desc: 'Dirección, producto, tecnología y marketing hacia un mismo objetivo.', members: [
    ['ceo', 'CEO', '', 'read', 'Define las prioridades, reparte el objetivo entre el equipo y decide cuándo está terminado.'],
    ['cto', 'CTO', 'ceo', 'code', 'Lidera lo técnico: decide cómo se construye y revisa el código.'],
    ['cpo', 'CPO', 'ceo', 'code', 'Convierte el objetivo en requisitos claros y criterios de aceptación.'],
    ['cmo', 'CMO', 'ceo', 'code', 'Escribe cómo se comunica: anuncios, notas de versión, textos.'],
    ['dev', 'Dev', 'cto', 'code', 'Implementa lo que se pide, con tests, en su propia rama.']], talks: [['cpo', 'cto'], ['cmo', 'cpo'], ['cmo', 'cto']] },
  { id: 'contenido', title: 'Contenido y marketing', desc: 'Un editor que coordina, un redactor que escribe y diseño que arma lo visual.', members: [
    ['editor', 'Editor', '', 'code', 'Planifica el contenido, revisa y aprueba antes de publicar.'],
    ['redactor', 'Redactor', 'editor', 'code', 'Escribe los textos: artículos, publicaciones, guiones.'],
    ['disenio', 'Diseño', 'editor', 'code', 'Propone lo visual: estructura, imágenes y piezas gráficas.']], talks: [['redactor', 'disenio']] },
  { id: 'soporte', title: 'Atención al cliente', desc: 'Un coordinador que reparte y escala, y soporte que responde.', members: [
    ['coordinador', 'Coordinador', '', 'read', 'Reparte las consultas, sigue los casos abiertos y escala lo que no se puede resolver.'],
    ['soporte', 'Soporte', 'coordinador', 'read', 'Responde las consultas con la información del proyecto, con buen tono.']], talks: [] },
  { id: 'vacio', title: 'Un solo asiento', desc: 'Un líder que hace todo. Para probar, o para sumar asientos de a uno en el lienzo.', members: [['lider', 'Líder', '', 'code', 'Hace el trabajo y, si sumás asientos, coordina al resto.']], talks: [] },
];
function startNewTeam() { state.wizard = { tpl: 'software', name: '', desc: '' }; state.draft = null; state.sel = null; renderTeams(); setTimeout(() => $('#wName') && $('#wName').focus(), 0); }
function draftFromTemplate(tpl, name, desc) {
  const known = new Set((state.agents || []).map((a) => a.id));
  // un agente que el proyecto ya tiene conserva su archivo (no se pisa con el de la plantilla)
  return { isNew: true, id: name, lead: tpl.members[0][0], description: desc || (tpl.id === 'vacio' ? '' : tpl.title), round_minutes: 0, budget_daily_tokens: 300000, worktrees: true, talks: tpl.talks.map((p) => p.slice()),
    members: tpl.members.map(([agent, role, boss, preset, d]) => ({ agent, role, reports_to: boss, description: d, system: known.has(agent) ? '' : `Sos ${role} del equipo. ${d}`, preset, permission: 'strict', dirty: !known.has(agent) })) };
}
function wizardHtml() {
  const w = state.wizard;
  return `<div class="wcard"><h2>Un equipo nuevo</h2><p class="wlead">Elegí con qué empezar. Después sumás, quitás o reordenás asientos en el lienzo.</p>
    <div class="tpls">${TEMPLATES.map((t) => `<label class="tpl${w.tpl === t.id ? ' on' : ''}"><input type="radio" name="tpl" value="${t.id}" ${w.tpl === t.id ? 'checked' : ''}><b>${esc(t.title)}</b><span class="tdesc2">${esc(t.desc)}</span><span class="troles">${t.members.map((m) => `<i>${esc(m[1])}</i>`).join('')}</span></label>`).join('')}</div>
    <div class="wfoot"><label class="wname">Nombre del equipo <input id="wName" value="${esc(w.name)}" placeholder="por ejemplo: producto" autocomplete="off"><span id="wSlug">${w.name && slugify(w.name) !== w.name ? 'se guarda como ' + esc(slugify(w.name)) : 'como quieras: se guarda sin espacios ni acentos'}</span></label>
      <label class="wname grow">Para qué es <input id="wDesc" value="${esc(w.desc)}" placeholder="una línea: qué hace este equipo" autocomplete="off"><span>opcional · lo podés cambiar después</span></label></div>
    <div class="wacts"><button id="wCancel">Cancelar</button><button class="primary" id="wGo">Armar el equipo</button></div><p class="ferr" id="wErr"></p></div>`;
}
function bindWizard() {
  const keep = () => { state.wizard.name = $('#wName').value; state.wizard.desc = $('#wDesc').value; };
  document.querySelectorAll('input[name=tpl]').forEach((r) => (r.onchange = () => { keep(); state.wizard.tpl = r.value; $('#wizard').innerHTML = wizardHtml(); bindWizard(); }));
  $('#wName').oninput = () => { keep(); const sl = slugify(state.wizard.name); $('#wSlug').textContent = state.wizard.name && sl !== state.wizard.name ? 'se guarda como ' + sl : 'como quieras: se guarda sin espacios ni acentos'; };
  $('#wDesc').oninput = keep;
  $('#wCancel').onclick = () => { state.wizard = null; renderTeams(); };
  $('#wGo').onclick = () => {
    const raw = $('#wName').value.trim(), name = slugify(raw);
    if (!ID_OK.test(name)) { $('#wErr').textContent = 'Poné un nombre para el equipo (por ejemplo «producto»).'; return; }
    if (state.teams.some((t) => t.id === name)) { $('#wErr').textContent = `Ya hay un equipo «${name}» en este proyecto.`; return; }
    const tpl = TEMPLATES.find((t) => t.id === state.wizard.tpl);
    try { localStorage.removeItem('lampson.flow:' + BASE + ':__nuevo'); } catch (e) {}
    state.draft = draftFromTemplate(tpl, name, $('#wDesc').value.trim()); state.draft.name = raw; state.sel = null; state.wizard = null; renderTeams();
  };
}
// ---------- borrador: el equipo (miembros + datos de sus agentes) que se guarda entero ----------
function draftFrom(team) {
  return { isNew: false, id: team.id, name: team.name || team.id, lead: team.lead || (team.members.find((m) => !m.reports_to) || team.members[0]).agent, description: team.description, round_minutes: team.round_minutes, budget_daily_tokens: team.budget_daily_tokens, worktrees: team.worktrees !== false, talks: (team.talks || []).map((p) => p.slice()),
    members: team.members.map((m) => ({ agent: m.agent, role: m.role, reports_to: m.reports_to, description: m.description, system: m.system, preset: presetOf(m.tools), permission: m.permission || 'strict', dirty: false })) };
}
function presetOf(tools) { const t = tools || []; if (!t.length) return 'none'; if (t.includes('write') || t.includes('edit')) return 'code'; return 'read'; }
function slugName() { return (BASE ? BASE.slice(3) : 'equipo').replace(/-[0-9a-f]{8}$/, '').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'equipo'; }
// «ante algo riesgoso»: a quién le pregunta depende del asiento — cadena de mando (lib/loop.syn): solo el líder te pregunta
// a vos; los demás se lo piden a su jefe, que lo hace o lo sube hasta el líder
const permsFor = (lead, bossRole) => [['strict', 'no lo hace'], ['ask', lead ? 'te pregunta a vos' : 'se lo pide a su jefe' + (bossRole ? ' (' + bossRole + ')' : '')], ['yolo', 'lo hace sin preguntar']];
// la barra del equipo (debajo de la cabecera). Viendo: cuál, para qué y qué hacer; editando: nombre, para qué y guardar
// debajo del nombre: cómo se guarda (nuevo) o la clave que no cambia (uno que ya existe)
const slugNote = (d) => d.isNew ? (d.name && slugify(d.name) !== d.name ? 'se guarda como ' + esc(slugify(d.name)) : '') : (d.name !== d.id ? 'clave interna: ' + esc(d.id) + ' (no cambia)' : '');
// un «?» que despliega una explicación corta (se cierra con otro clic, afuera o con Escape)
const help = (text) => `<details class="qhelp"><summary aria-label="¿qué es?">?</summary><p>${esc(text)}</p></details>`;
function subbarHtml() {
  const d = state.draft, team = state.teams.find((t) => t.id === state.team);
  if (d) return `<div class="tsub-l"><button type="button" class="back" id="eBack" title="volver a los equipos sin guardar">← Equipos</button><div class="namebox"><label class="inl">Nombre <input id="eId" value="${esc(d.name ?? d.id)}" placeholder="producto" size="18" autocomplete="off"></label><span class="slug" id="eSlug">${slugNote(d)}</span></div>
      <label class="inl grow">Para qué es <input id="eDesc" value="${esc(d.description)}" placeholder="una línea: qué hace este equipo"></label>
      <details class="advpop"><summary>Opciones</summary><div class="advgrid">
        <div class="opt"><div class="oh"><label for="eRound">Rondas automáticas cada</label>${help('Cada cuánto un asiento retoma por su cuenta lo que tiene pendiente —sus tareas del tablero o novedades que lo involucran— aunque nadie le escriba. Los mensajes y los objetivos le llegan igual, al momento. Más seguido avanza más rápido, pero gasta más.')}</div>
          <span class="unit"><input id="eRound" type="number" min="0" value="${d.round_minutes}"> min</span><span class="ds">0 = sin rondas: trabajan cuando les llega un objetivo o un mensaje</span></div>
        <div class="opt"><div class="oh"><label for="eBudget">Gasto máximo por asiento, por día</label>${help('Cuántos tokens puede usar cada asiento en un día. Al llegar al tope no recibe más turnos hasta el día siguiente, y queda anotado en el registro. Sirve para que un equipo no gaste de más si algo se traba.')}</div>
          <span class="unit"><input id="eBudget" type="number" min="0" step="10000" value="${d.budget_daily_tokens}"> tokens</span><span class="ds">0 = sin tope</span></div>
        <div class="opt"><div class="oh"><label class="chk"><input id="eWt" type="checkbox" ${d.worktrees ? 'checked' : ''}> Cada asiento en su propia copia de git</label>${help('Si el proyecto usa git, cada asiento trabaja en su rama y en su propia copia de los archivos: nadie pisa el trabajo de otro. Llevar los cambios a la rama principal lo hace el líder, con tu aprobación.')}</div></div>
      </div></details></div>
    <div class="tsub-r"><span class="ferr" id="eErr"></span><button id="eCancel">${d.isNew ? 'Descartar' : 'Cancelar'}</button><button class="primary" id="eSave">${d.isNew ? 'Crear equipo' : 'Guardar cambios'}</button></div>`;
  return '';
}
// ---------- la lista: una tarjeta por equipo del proyecto, y «+ nuevo equipo» ----------
const OPEN_OBJ = ['waiting', 'active', 'paused'];
function firstSentence(t) {
  const x = String(t || '').replace(/\s+/g, ' ').trim(), m = x.match(/^(.{20,}?[.:;!?])(\s|$)/), out = m ? m[1] : x;
  return out.length > 140 ? out.slice(0, 137).replace(/\s+\S*$/, '') + '…' : out;
}
function teamCardHtml(t) {
  const lead = t.lead || (t.members.find((m) => !m.reports_to) || t.members[0] || {}).agent;
  const roles = [...t.members].sort((a, b) => (b.agent === lead) - (a.agent === lead));
  const now = (state.objectives || []).filter((o) => o.team === t.id && OPEN_OBJ.includes(o.status)).sort((a, b) => OPEN_OBJ.indexOf(a.status) - OPEN_OBJ.indexOf(b.status));
  const working = t.members.some((m) => m.working);
  return `<article class="tcard3" data-team="${esc(t.id)}" tabindex="0" title="editar el equipo">
    <div class="thead"><h3>${esc(t.name || t.id)}</h3>${working ? '<span class="tw">● trabajando</span>' : ''}</div>
    ${t.description ? `<p class="tdesc">${esc(t.description)}</p>` : ''}
    <div class="roles">${roles.map((m) => `<span class="role${m.agent === lead ? ' lead' : ''}${m.working ? ' on' : ''}" title="${esc(m.agent)}${m.agent === lead ? ' · líder' : ''}">${esc(m.role || m.agent)}</span>`).join('')}</div>
    <div class="tnow">${now.length ? now.map((o) => `<a class="oline" href="?tab=objectives&o=${o.id}"><span class="st ${o.status}">${STATUS[o.status] || o.status}</span><span>${esc(firstSentence(o.text))}</span></a>`).join('') : '<span class="idle">Nada en curso.</span>'}</div>
    <div class="tacts"><button class="primary" data-goal>Darle un objetivo</button><button data-edit>Editar</button></div>
  </article>`;
}
function listHtml() {
  const proj = BASE ? BASE.slice(3).replace(/-[0-9a-f]{8}$/, '') : 'este proyecto';
  return `<div class="tlhead"><h2>Equipos de ${esc(proj)}</h2><p>Cada equipo es un grupo de asientos con un líder. Un proyecto puede tener varios: uno que programa, otro que escribe, otro que atiende.</p></div>
    <div class="tgrid3">${state.teams.map(teamCardHtml).join('')}
      <button type="button" class="tnew" id="newTeamCard"><span class="plus">+</span><b>Nuevo equipo</b><span>Elegí una plantilla o empezá con un solo asiento.</span></button></div>`;
}
function bindList() {
  $('#newTeamCard').onclick = startNewTeam;
  document.querySelectorAll('.tcard3').forEach((c) => {
    const t = state.teams.find((x) => x.id === c.dataset.team);
    const edit = () => { state.draft = draftFrom(t); state.sel = null; renderTeams(); };
    c.onclick = (e) => { if (e.target.closest('button, a')) return; edit(); };
    c.onkeydown = (e) => { if (e.key === 'Enter' && e.target === c) edit(); };
    c.querySelector('[data-edit]').onclick = edit;
    c.querySelector('[data-goal]').onclick = () => { location.href = '?tab=objectives&objetivo=' + encodeURIComponent(t.id); };
  });
}
// al tocar un asiento, editando: su tarjeta de edición, dentro del lienzo
function inspectorHtml() {
  const d = state.draft; const m = d && d.members.find((x) => x.agent === state.sel);
  if (!m) return '';
  const L = d.lead, others = d.members.filter((x) => x !== m);
  const below = new Set(); const walk = (a) => d.members.filter((x) => x.reports_to === a).forEach((x) => { below.add(x.agent); walk(x.agent); }); walk(m.agent);
  const talksWith = d.talks.filter((p) => p.includes(m.agent)).map((p) => (p[0] === m.agent ? p[1] : p[0]));
  // con quién más puede hablar: todos menos su jefe y los que le reportan (con ellos ya habla); primero los de su nivel
  const cand = others.filter((x) => x.agent !== m.reports_to && x.reports_to !== m.agent).sort((a, b) => (b.reports_to === m.reports_to && !!m.reports_to) - (a.reports_to === m.reports_to && !!m.reports_to));
  return `<div class="ihead"><h3>${esc(m.role || m.agent)}</h3>${m.agent === L ? '<span class="fl-lead">líder</span>' : ''}<button type="button" class="iclose" id="mClose" title="cerrar">✕</button></div>
    <label>Rol <input id="mRole" value="${esc(m.role)}" placeholder="CTO"></label>
    <label>Para qué está <input id="mDesc" value="${esc(m.description)}" placeholder="una línea"></label>
    ${m.agent === L ? '<p class="ds">Es el líder: recibe los objetivos, reparte el trabajo y es el único que te pregunta a vos. Si está solo, lo hace todo.</p>' : `<label>Le reporta a <select id="mBoss"><option value="" ${m.reports_to ? '' : 'selected'}>nadie por ahora (al guardar, al líder)</option>${others.filter((x) => !below.has(x.agent)).map((x) => `<option value="${esc(x.agent)}" ${x.agent === m.reports_to ? 'selected' : ''}>${esc(x.role || x.agent)}${x.agent === L ? ' (líder)' : ''}</option>`).join('')}</select></label>`}
    <label>Qué puede hacer <select id="mPreset">${PRESETS.map(([v, l]) => `<option value="${v}" ${v === m.preset ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Ante algo riesgoso <select id="mPerm">${permsFor(m.agent === L, m.reports_to && (d.members.find((x) => x.agent === m.reports_to) || {}).role).map(([v, l]) => `<option value="${v}" ${v === m.permission ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="ds">${m.agent === L ? 'Es el único del equipo que te consulta a vos.' : 'Nunca te pregunta a vos: si su jefe no puede decidirlo, sube hasta el líder, que es el único que te consulta.'}</span></label>
    <label>Cómo trabaja <textarea id="mSys" rows="4" placeholder="Sos el CTO: decidís cómo se construye, revisás el código de los demás…">${esc(m.system)}</textarea></label>
    ${cand.length ? `<div class="talkbox"><div class="lbl">También habla con</div><div class="chips">${cand.map((x) => `<label class="chip"><input type="checkbox" data-talk="${esc(x.agent)}" ${talksWith.includes(x.agent) ? 'checked' : ''}>${esc(x.role || x.agent)}</label>`).join('')}</div><p class="ds">La línea punteada. Se propone sola al unir dos asientos bajo el mismo jefe; sacala si no hace falta.</p></div>` : ''}
    <details class="adv"><summary>Nombre interno</summary><label><input id="mId" value="${esc(m.agent)}"><span class="ds">el id del agente (se guarda sin espacios ni acentos)</span></label></details>
    <div class="acts">${m.agent === L ? '' : '<button id="mLead">Hacer líder</button><button class="no" id="mDel">Eliminar asiento</button>'}</div>`;
}
function bindEditor() {
  const d = state.draft; const m = d.members.find((x) => x.agent === state.sel);
  const on = (id, ev, fn) => { const e = $(id); if (e) e[ev] = fn; };
  // un equipo nuevo toma su clave del nombre; uno que ya existe cambia solo el nombre visible (la clave no se toca)
  on('#eId', 'oninput', (e) => { d.name = e.target.value; if (d.isNew) d.id = slugify(d.name); $('#eSlug').innerHTML = slugNote(d); });
  on('#eDesc', 'oninput', (e) => (d.description = e.target.value));
  on('#eRound', 'oninput', (e) => (d.round_minutes = +e.target.value || 0));
  on('#eBudget', 'oninput', (e) => (d.budget_daily_tokens = +e.target.value || 0));
  on('#eWt', 'onchange', (e) => (d.worktrees = e.target.checked));
  const leave = () => { state.draft = null; state.sel = null; renderTeams(); };
  on('#eCancel', 'onclick', leave);
  on('#eBack', 'onclick', leave);
  on('#eSave', 'onclick', saveDraft);
  on('#addSeat', 'onclick', () => addSeat());
  if (!m) return;
  const touch = () => (m.dirty = true);
  on('#mClose', 'onclick', () => { state.sel = null; renderTeams(); });
  on('#mId', 'onchange', (e) => { const v = slugify(e.target.value); if (!ID_OK.test(v) || d.members.some((x) => x !== m && x.agent === v)) { e.target.value = m.agent; return; } d.members.forEach((x) => { if (x.reports_to === m.agent) x.reports_to = v; }); d.talks = d.talks.map((p) => p.map((a) => (a === m.agent ? v : a))); if (d.lead === m.agent) d.lead = v; m.agent = v; state.sel = v; touch(); renderTeams(); });
  on('#mRole', 'oninput', (e) => { m.role = e.target.value; touch(); renderGraph(); });
  on('#mRole', 'onchange', () => renderTeams());
  on('#mDesc', 'oninput', (e) => { m.description = e.target.value; touch(); renderGraph(); });
  on('#mBoss', 'onchange', (e) => { if (e.target.value) connectDraft(e.target.value, m.agent); else { m.reports_to = ''; renderTeams(); } });
  on('#mSys', 'oninput', (e) => { m.system = e.target.value; touch(); });
  on('#mPreset', 'onchange', (e) => { m.preset = e.target.value; touch(); renderGraph(); });
  on('#mPerm', 'onchange', (e) => { m.permission = e.target.value; touch(); });
  on('#mLead', 'onclick', () => makeLeader(m.agent));
  on('#mDel', 'onclick', () => removeSeat(m.agent));
  document.querySelectorAll('[data-talk]').forEach((c) => (c.onchange = () => { const o = c.dataset.talk; d.talks = d.talks.filter((p) => !(p.includes(o) && p.includes(m.agent))); if (c.checked) d.talks.push([m.agent, o]); renderTeams(); }));
}
async function saveDraft() {
  const d = state.draft; normalize(d);
  if (!ID_OK.test(d.id || '') || !String(d.name ?? d.id).trim()) { $('#eErr').textContent = 'Poné un nombre para el equipo (por ejemplo «producto»).'; return; }
  if (d.isNew && state.teams.some((t) => t.id === d.id)) { $('#eErr').textContent = `Ya hay un equipo «${d.id}» en este proyecto: elegí otro nombre.`; return; }
  // los sueltos le reportan al líder; el líder va primero (lib/teams.syn → lead_of: el primero que no reporta a nadie)
  d.members.forEach((m) => { if (loose(d, m)) m.reports_to = d.lead; });
  const ordered = [d.members.find((m) => m.agent === d.lead), ...d.members.filter((m) => m.agent !== d.lead)];
  const body = { team: { id: d.id, name: String(d.name ?? d.id).trim(), description: d.description, members: ordered.map((m) => ({ agent: m.agent, role: m.role || m.agent, reports_to: m.reports_to })), talks: d.talks, round_minutes: d.round_minutes, budget_daily_tokens: d.budget_daily_tokens, worktrees: d.worktrees },
    agents: d.members.filter((m) => m.dirty || m.system).map((m) => ({ id: m.agent, description: m.description, system: m.system || `Sos ${m.role || m.agent} del equipo ${d.id}.`, preset: m.preset, permission: m.permission })) };
  const r = await api('teams/save', body);
  if (!r.ok) { $('#eErr').textContent = r.data.error || 'no se pudo guardar'; return; }
  // las posiciones del borrador pasan a ser las del equipo
  if (d.isNew) { try { const k0 = 'lampson.flow:' + BASE + ':__nuevo', v = localStorage.getItem(k0); if (v) localStorage.setItem('lampson.flow:' + BASE + ':' + d.id, v); localStorage.removeItem(k0); } catch (e) {} }
  // guardado: de vuelta a la lista, con la tarjeta al día
  state.team = d.id; state.draft = null; state.sel = null;
  state.teams = r.data.teams; renderTeams();
}

document.addEventListener('pointerdown', (e) => document.querySelectorAll('details.advpop[open], details.qhelp[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('details.advpop[open], details.qhelp[open]').forEach((d) => (d.open = false)); });
function renderTeams() {
  const d = state.draft;
  // sin borrador: la lista de equipos (las plantillas, encima, al tocar «+ nuevo equipo»); con borrador: el lienzo
  const wz = $('#wizard'); wz.hidden = !state.wizard;
  if (state.wizard) { wz.innerHTML = wizardHtml(); bindWizard(); }
  $('#tlist').hidden = !!d; $('#tedit').hidden = !d;
  if (!d) { $('#tlist').innerHTML = listHtml(); bindList(); }
  $('#tsub').innerHTML = d ? subbarHtml() : '';
  $('#ovAdd').innerHTML = d ? `<button class="primary" id="addSeat">+ asiento</button><span class="ahint">Arrastrá el punto de abajo hasta otro asiento: ese le reporta.</span>` : '';
  const insp = $('#inspector'); insp.hidden = !(d && state.sel); insp.innerHTML = insp.hidden ? '' : inspectorHtml();
  renderGraph();
  if (d) bindEditor();
}
async function refreshTeams() {
  const r = await api('teams');
  if (!r.ok) return false;
  state.teams = r.data.teams;
  // ?new=1 (desde /equipos → «+ equipo»): las plantillas, con el nombre del proyecto
  if (new URLSearchParams(location.search).get('new') && !state.newOpened) {
    state.newOpened = true; startNewTeam();
    history.replaceState(null, '', location.pathname + '?tab=teams'); return true;
  }
  // ?edit=<equipo> abre ese equipo para editar (enlaces directos, capturas)
  const ed = new URLSearchParams(location.search).get('edit');
  if (ed && !state.editOpened) { state.editOpened = true; const t = state.teams.find((x) => x.id === ed); if (t) { state.team = t.id; state.draft = draftFrom(t); state.sel = null; renderTeams(); history.replaceState(null, '', location.pathname + '?tab=teams'); return true; } }
  if (state.draft || state.wizard) return true;   // editando o eligiendo plantilla: el pulso no pisa nada
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
