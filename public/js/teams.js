// teams.js — la pantalla de equipos, objetivos y rutinas de un proyecto (public/teams.html). Página propia: no depende
// de los módulos del agente de programación. Cada nivel tiene su URL (ver el comentario de teams.html) y «atrás» vuelve
// al anterior: el router lee location.pathname. Se actualiza sola (cada 2,5 s) desde la API privada del workspace:
//   GET  api/objectives · api/objectives/:id · api/teams · api/schedules (las rutinas son tareas con acción objective)
//   POST api/objectives/add · api/objectives/:id/reply · api/objectives/:id/cancel · api/teams/save
//        api/schedules/add · api/schedules/toggle · api/schedules/run · api/schedules/remove
//   GET  api/approvals + POST api/approve (las aprobaciones de la cola: p. ej. un merge a main desde la copia de un agente)
const $ = (s) => document.querySelector(s);
const BASE = (location.pathname.match(/^\/w\/[^/]+/) || [''])[0];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LANES = [['todo', 'por hacer'], ['doing', 'en curso'], ['review', 'en revisión'], ['done', 'hecho'], ['blocked', 'bloqueada']];
const STATUS = { active: 'en curso', waiting: 'te espera', done: 'hecho', failed: 'falló', cancelled: 'cancelado', paused: 'sin presupuesto' };
const KIND = { added: 'agregó', claimed: 'tomó', updated: 'movió', message: 'escribió', report: 'informó', asked: 'preguntó', 'approval requested': 'pide aprobación', approved: 'aprobó', denied: 'denegó', answered: 'respondió', done: 'terminó', failed: 'falló', cancelled: 'canceló', paused: 'pausado', budget: 'presupuesto', 'over cap': 'pasó su tope diario', objective: 'nuevo objetivo', error: 'error' };
const PRESETS = [['code', 'código (leer, editar, comandos)'], ['read', 'leer y correr comandos (no edita)'], ['none', 'ninguna (solo coordina)']];
const ROUTINE = 'rutina:';   // created_by de las ejecuciones de una rutina (lib/schedule.syn → run_routine)
const state = { approvals: [], teamsMeta: [], draft: null, sel: null, route: { page: 'list' }, team: null, objectives: [], agents: [], teams: [], routines: [], seen: new Set() };

async function api(path, body) {
  const r = await fetch(BASE + '/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (r.status === 401) location.href = '/login';
  return { ok: r.ok, status: r.status, data };
}
const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - t); return s < 60 ? 'recién' : s < 3600 ? 'hace ' + Math.floor(s / 60) + ' min' : s < 86400 ? 'hace ' + Math.floor(s / 3600) + ' h' : 'hace ' + Math.floor(s / 86400) + ' d'; };
const hhmm = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const k = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n);
const proj = BASE ? BASE.slice(3).replace(/-[0-9a-f]{8}$/, '') : 'local';
const enc = encodeURIComponent;

// ---------- rutas: cada nivel con su URL; «atrás» del navegador vuelve al anterior ----------
const url = {
  list: () => BASE + '/equipos', newTeam: () => BASE + '/equipos/nuevo',
  team: (t) => BASE + '/equipos/' + enc(t), edit: (t) => BASE + '/equipos/' + enc(t) + '/editar',
  obj: (t, n) => (t ? BASE + '/equipos/' + enc(t) + '/objetivos/' : BASE + '/objetivos/') + n,
  newObj: (t) => BASE + '/equipos/' + enc(t) + '/objetivos/nuevo', newRoutine: (t) => BASE + '/equipos/' + enc(t) + '/rutinas/nueva',
  routine: (t, id) => BASE + '/equipos/' + enc(t) + '/rutinas/' + enc(id),
};
function parseRoute() {
  const seg = location.pathname.slice(BASE.length).split('/').filter(Boolean).map(decodeURIComponent);
  if (seg[0] === 'objetivos' && seg[1]) return { page: 'obj', obj: +seg[1] };
  if (!seg[1]) return { page: 'list' };
  if (seg[1] === 'nuevo') return { page: 'newteam' };
  const team = seg[1];
  if (seg[2] === 'editar') return { page: 'edit', team };
  if (seg[2] === 'objetivos' && seg[3] === 'nuevo') return { page: 'team', team, form: 'once' };
  if (seg[2] === 'objetivos' && seg[3]) return { page: 'obj', team, obj: +seg[3] };
  if (seg[2] === 'rutinas' && seg[3] === 'nueva') return { page: 'team', team, form: 'repeat' };
  if (seg[2] === 'rutinas' && seg[3]) return { page: 'routine', team, routine: seg[3] };
  return { page: 'team', team };
}
// las URLs de antes (?tab=…, ?o=…, ?new=1, ?edit=…, ?objetivo=…) llevan a las de ahora
function legacyRedirect() {
  const q = new URLSearchParams(location.search); if (![...q.keys()].length) return;
  let to = location.pathname;
  if (q.get('new')) to = url.newTeam();
  else if (q.get('edit')) to = url.edit(q.get('edit'));
  else if (q.get('objetivo')) to = url.newObj(q.get('objetivo'));
  else if (q.get('o')) to = url.obj('', +q.get('o'));
  else if (q.get('tab')) to = url.list();
  history.replaceState(null, '', to);
}
function go(href, replace) { history[replace ? 'replaceState' : 'pushState'](null, '', href); route(); }
window.addEventListener('popstate', route);
// los enlaces internos (data-nav) navegan sin recargar; con Ctrl/⌘ o rueda, en otra pestaña como siempre
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault(); go(a.getAttribute('href'));
});
const teamOf = (id) => state.teams.find((t) => t.id === id);
const teamName = (id) => { const t = teamOf(id) || (state.teamsMeta || []).find((x) => x.id === id); return (t && t.name) || id; };

// las migas: Proyectos › proyecto › Equipos › equipo › (O-n | rutina | editar | nuevo)
function renderCrumbs() {
  const r = state.route, parts = [['/', 'Proyectos'], [BASE || '/', proj], [url.list(), 'Equipos']];
  if (r.page === 'newteam') parts.push(['', 'Equipo nuevo']);
  if (r.team) parts.push([url.team(r.team), teamName(r.team)]);
  if (r.page === 'edit') parts.push(['', 'Editar']);
  if (r.form) parts.push(['', r.form === 'repeat' ? 'Rutina nueva' : 'Objetivo nuevo']);
  if (r.page === 'routine') { const rt = state.routines.find((x) => x.id === r.routine); parts.push(['', rt ? rt.name : 'Rutina']); }
  if (r.page === 'obj') {
    const o = state.objectives.find((x) => x.id === r.obj), rid = o && String(o.created_by || '').startsWith(ROUTINE) ? o.created_by.slice(ROUTINE.length) : '';
    const rt = rid && state.routines.find((x) => x.id === rid);
    if (rt && r.team) parts.push([url.routine(r.team, rid), rt.name]);
    if (!r.team) parts.push(['', 'Un solo agente']);
    parts.push(['', 'O-' + r.obj]);
  }
  $('#crumbs').innerHTML = parts.map(([h, t], i) => (i ? '<span class="sep">›</span>' : '') + (h && i < parts.length - 1 ? `<a href="${esc(h)}"${h.startsWith(BASE + '/') && BASE ? ' data-nav' : ''}>${esc(t)}</a>` : `<span class="here">${esc(t)}</span>`)).join('');
  document.title = 'Lampson · ' + parts.slice(2).map((p) => p[1]).join(' › ');
}
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('lampson.theme', t); } catch (e) {} $('#theme').textContent = t === 'dark' ? '☀' : '☾'; }
setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
$('#theme').onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

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
      <div class="q"><a class="ref" data-nav href="${esc(url.obj(o.team, o.id))}">${esc(o.ref)}</a> ${esc(o.question)}</div>
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
  box.querySelectorAll('[data-approve]').forEach((b) => (b.onclick = () => reply(+b.dataset.approve, note(b.dataset.approve), true)));
  box.querySelectorAll('[data-deny]').forEach((b) => (b.onclick = () => reply(+b.dataset.deny, note(b.dataset.deny), false)));
  box.querySelectorAll('[data-answer]').forEach((b) => (b.onclick = () => { const t = note(b.dataset.answer); if (t.trim()) reply(+b.dataset.answer, t, false); }));
}
async function reply(id, text, approved) { await api(`objectives/${id}/reply`, { text, approved }); refresh(); }

// ---------- tarjetas de objetivos y de rutinas ----------
const OPEN_OBJ = ['waiting', 'active', 'paused'];
function firstSentence(t, max = 140) {
  const x = String(t || '').replace(/\s+/g, ' ').trim(), m = x.match(/^(.{20,}?[.:;!?])(\s|$)/), out = m ? m[1] : x;
  return out.length > max ? out.slice(0, max - 3).replace(/\s+\S*$/, '') + '…' : out;
}
const routineOf = (o) => (String(o.created_by || '').startsWith(ROUTINE) ? o.created_by.slice(ROUTINE.length) : '');
function objCardHtml(o, opts = {}) {
  const rid = routineOf(o), rt = rid && state.routines.find((x) => x.id === rid);
  const now = o.status === 'waiting' ? `<p class="oq">«${esc(firstSentence(o.question, 160))}»</p>` : o.progress && o.status === 'active' ? `<p class="oprog">Ahora: ${esc(firstSentence(o.progress, 150))}</p>` : '';
  return `<a class="ocard ${o.status}" data-nav href="${esc(url.obj(o.team, o.id))}">
    <div class="oh"><span class="ref">${esc(o.ref)}</span><span class="st ${o.status}">${STATUS[o.status] || o.status}</span>${o.working ? '<span class="tw">● ahora</span>' : ''}${rt && !opts.inRoutine ? `<span class="from" title="una ejecución de esta rutina">⟳ ${esc(rt.name)}</span>` : ''}</div>
    <p class="otext">${esc(firstSentence(o.text))}</p>${now}
    <div class="ometa">${o.turns} ronda${o.turns === 1 ? '' : 's'} · ${k(o.spent)} tokens · ${ago(o.updated_at)}</div></a>`;
}
const MARK = { done: ['✓', 'hecho'], failed: ['✕', 'falló'], cancelled: ['–', 'cancelado'], active: ['●', 'trabajando'], waiting: ['⚑', 'te espera'], paused: ['‖', 'sin presupuesto'] };
const runsOf = (rid) => state.objectives.filter((o) => o.created_by === ROUTINE + rid);
function routineCardHtml(rt) {
  const runs = runsOf(rt.id);
  return `<a class="rcard${rt.enabled ? '' : ' off'}" data-nav href="${esc(url.routine(rt.action.team, rt.id))}">
    <div class="oh"><span class="when">⟳ ${esc(rt.plan)}</span>${rt.enabled ? '' : '<span class="st paused">pausada</span>'}</div>
    <p class="otext">${esc(firstSentence(rt.action.text))}</p>
    <div class="ometa">${rt.enabled && rt.next_run ? 'próxima: ' + esc(fmtWhen(rt.next_run)) : rt.enabled ? 'sin próxima' : 'no va a correr hasta que la enciendas'}${runs.length ? ` · últimas: <span class="marks">${runs.slice(0, 6).map((o) => `<i class="${o.status}" title="${esc(o.ref)} · ${MARK[o.status][1]}">${MARK[o.status][0]}</i>`).join('')}</span>` : ''}</div></a>`;
}
function fmtWhen(ts) {
  const d = new Date(ts * 1000), now = new Date(), hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), diff = Math.round((day(d) - day(now)) / 86400000);
  return diff === 0 ? 'hoy ' + hm : diff === 1 ? 'mañana ' + hm : diff === -1 ? 'ayer ' + hm : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hm;
}

// ---------- la página de un equipo: sus objetivos (en curso arriba, terminados plegados) y sus rutinas ----------
function teamPageHtml(t) {
  const mine = state.objectives.filter((o) => o.team === t.id), open = mine.filter((o) => OPEN_OBJ.includes(o.status)).sort((a, b) => OPEN_OBJ.indexOf(a.status) - OPEN_OBJ.indexOf(b.status)), done = mine.filter((o) => !OPEN_OBJ.includes(o.status));
  const lead = t.lead, roles = [...t.members].sort((a, b) => (b.agent === lead) - (a.agent === lead));
  const rts = state.routines.filter((r) => r.action.team === t.id);
  return `<div class="tphead"><div class="tpinfo"><h2>${esc(t.name || t.id)}</h2>${t.description ? `<p>${esc(t.description)}</p>` : ''}
      <div class="roles">${roles.map((m) => `<span class="role${m.agent === lead ? ' lead' : ''}${m.working ? ' on' : ''}">${esc(m.role || m.agent)}</span>`).join('')}</div></div>
    <div class="tpacts"><a class="btn" data-nav href="${esc(url.edit(t.id))}">Editar equipo</a><a class="btn primary" data-nav href="${esc(url.newObj(t.id))}">+ Nuevo objetivo</a></div></div>
    <section class="osec"><h3>En curso</h3><div class="ogrid">${open.map((o) => objCardHtml(o)).join('') || `<p class="oempty">Nada en curso. <a data-nav href="${esc(url.newObj(t.id))}">Dale un objetivo</a> y el equipo se reparte el trabajo.</p>`}</div></section>
    <section class="osec" id="rutinas"><h3>Rutinas <span class="hint2">objetivos que se repiten: cada vez que les toca, el equipo recibe uno nuevo</span></h3><div class="ogrid">${rts.map(routineCardHtml).join('')}
      <a class="rnew" data-nav href="${esc(url.newRoutine(t.id))}"><span class="plus">+</span><b>Nueva rutina</b><span>«Todos los lunes a las 9, armá el resumen de la semana».</span></a></div></section>
    ${done.length ? `<details class="osec done"${state.doneOpen ? ' open' : ''}><summary><h3>Terminados <span class="n">${done.length}</span></h3></summary><div class="ogrid">${done.map((o) => objCardHtml(o)).join('')}</div></details>` : ''}`;
}
// ---------- la página de una rutina: cuándo, encendida o pausada, y sus ejecuciones ----------
function routinePageHtml(rt) {
  const runs = runsOf(rt.id), t = rt.action.team;
  return `<div class="tphead"><div class="tpinfo"><p class="rwhen">⟳ ${esc(rt.plan)}${rt.enabled && rt.next_run ? ' · próxima ' + esc(fmtWhen(rt.next_run)) : ''}</p><h2>${esc(rt.name)}</h2><p class="rtext">${esc(rt.action.text)}</p></div>
    <div class="tpacts"><label class="sw2"><input type="checkbox" id="rtOn" ${rt.enabled ? 'checked' : ''}><span class="swt"></span><span>${rt.enabled ? 'encendida' : 'pausada'}</span></label><button id="rtRun">Correr ahora</button><button class="no" id="rtDel">Eliminar rutina</button></div></div>
    <section class="osec"><h3>Ejecuciones <span class="n">${runs.length}</span></h3><div class="ogrid">${runs.map((o) => objCardHtml(o, { inRoutine: true })).join('') || `<p class="oempty">Todavía no corrió.${rt.enabled && rt.next_run ? ' La primera, ' + esc(fmtWhen(rt.next_run)) + '.' : ''} Cada ejecución es un objetivo para el equipo, con su propio resultado.</p>`}</div></section>
    <p class="ferr" id="rtErr"></p>`;
}
function bindRoutinePage(rt) {
  $('#rtOn').onchange = async (e) => { const r = await api('schedules/toggle', { id: rt.id, enabled: e.target.checked }); if (!r.ok) $('#rtErr').textContent = r.data.error || 'no se pudo'; await refreshRoutines(); render(); };
  $('#rtRun').onclick = async () => { $('#rtRun').disabled = true; $('#rtRun').textContent = 'arrancando…'; await api('schedules/run', { id: rt.id }); setTimeout(refresh, 1500); };
  const del = $('#rtDel');
  del.onclick = async () => { if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = '¿seguro? eliminar'; return; } await api('schedules/remove', { id: rt.id }); await refreshRoutines(); go(url.team(rt.action.team), true); };
}

// ---------- objetivo o rutina nuevos (un formulario, «una vez» o «se repite») ----------
const DAYS = [['mon', 'lun'], ['tue', 'mar'], ['wed', 'mié'], ['thu', 'jue'], ['fri', 'vie'], ['sat', 'sáb'], ['sun', 'dom']];
function objFormHtml(t, mode) {
  const f = state.form;
  return `<div class="wcard oform"><h2>${mode === 'repeat' ? 'Rutina nueva' : 'Objetivo nuevo'} <span class="for">para ${esc(t.name || t.id)}</span></h2>
    <div class="seg" role="tablist"><button type="button" data-mode="once" class="${mode === 'once' ? 'on' : ''}">Una vez</button><button type="button" data-mode="repeat" class="${mode === 'repeat' ? 'on' : ''}">Se repite</button></div>
    <label class="big">¿Qué tiene que lograr?<textarea id="nText" rows="6" placeholder="${mode === 'repeat' ? 'Revisá las ventas de la semana y armá un resumen corto con lo que cambió y qué conviene hacer.' : 'Agregá a la API filtrar las tareas por estado, con tests. Trabajá en tu rama y pedí aprobación antes de mezclar.'}">${esc(f.text)}</textarea></label>
    ${mode === 'repeat' ? `<div class="whenbox"><label>Cuándo <select id="nFreq"><option value="daily" ${f.freq === 'daily' ? 'selected' : ''}>todos los días</option><option value="days" ${f.freq === 'days' ? 'selected' : ''}>ciertos días de la semana</option><option value="every" ${f.freq === 'every' ? 'selected' : ''}>cada tantas horas</option></select></label>
      ${f.freq === 'every' ? `<label>Cada <span class="unit"><input id="nEvery" type="number" min="1" max="168" value="${f.every}"> h</span></label>` : `<label>A las <input id="nAt" type="time" value="${esc(f.at)}"></label>`}
      ${f.freq === 'days' ? `<div class="days">${DAYS.map(([v, l]) => `<label class="chip"><input type="checkbox" data-day="${v}" ${f.days.includes(v) ? 'checked' : ''}>${l}</label>`).join('')}</div>` : ''}
      <p class="ds">Cada vez que le toca, el equipo recibe un objetivo nuevo con este texto. Si el anterior sigue abierto, esa vez se saltea.</p></div>` : ''}
    <details class="adv"><summary>Opciones</summary><div class="advgrid">
      <div class="opt"><div class="oh"><label for="nBudget">Gasto máximo ${mode === 'repeat' ? 'por ejecución' : ''}</label>${help('El total de tokens que puede usar el equipo en este objetivo. Al llegar, se pausa y te avisa: podés darle más para que siga.')}</div><span class="unit"><input id="nBudget" type="number" min="0" step="50000" value="${f.budget}"> tokens</span></div>
    </div></details>
    <div class="wacts"><button type="button" id="nCancel">Cancelar</button><button type="button" class="primary" id="nGo">${mode === 'repeat' ? 'Crear rutina' : 'Empezar'}</button></div><p class="ferr" id="nErr"></p></div>`;
}
function bindObjForm(t, mode) {
  const f = state.form, keep = () => { f.text = $('#nText').value; if ($('#nAt')) f.at = $('#nAt').value; if ($('#nEvery')) f.every = +$('#nEvery').value || 1; f.budget = +$('#nBudget').value || 0; f.days = [...document.querySelectorAll('[data-day]:checked')].map((c) => c.dataset.day); };
  const redraw = () => { keep(); $('#objNew').innerHTML = objFormHtml(t, mode); bindObjForm(t, mode); };
  document.querySelectorAll('#objNew [data-mode]').forEach((b) => (b.onclick = () => { keep(); if (b.dataset.mode !== mode) go(b.dataset.mode === 'repeat' ? url.newRoutine(t.id) : url.newObj(t.id), true); }));
  if ($('#nFreq')) $('#nFreq').onchange = (e) => { keep(); f.freq = e.target.value; redraw(); };
  $('#nCancel').onclick = () => { state.form = null; go(url.team(t.id)); };
  $('#nGo').onclick = async () => {
    keep();
    if (!f.text.trim()) { $('#nErr').textContent = 'Escribí qué tiene que lograr el equipo.'; return; }
    $('#nGo').disabled = true;
    if (mode === 'once') {
      const r = await api('objectives/add', { team: t.id, text: f.text.trim(), budget_tokens: f.budget });
      $('#nGo').disabled = false;
      if (!r.ok) { $('#nErr').textContent = r.data.error || 'no se pudo crear'; return; }
      state.form = null; await refreshObjectives(); go(url.obj(t.id, r.data.id), true); return;
    }
    // la rutina: una tarea programada (lib/schedule.syn) cuya acción le da este objetivo al equipo
    if (f.freq === 'days' && !f.days.length) { $('#nGo').disabled = false; $('#nErr').textContent = 'Elegí al menos un día.'; return; }
    const when = f.freq === 'every' ? 'every ' + Math.max(1, f.every) + 'h' : (f.freq === 'days' ? f.days.join(',') + ' ' : 'daily ') + (f.at || '09:00');
    const r = await api('schedules/add', { name: firstSentence(f.text, 60), when, action: { type: 'objective', team: t.id, text: f.text.trim(), budget_tokens: f.budget } });
    $('#nGo').disabled = false;
    if (!r.ok) { $('#nErr').textContent = r.data.error || 'no se pudo crear la rutina'; return; }
    state.form = null; await refreshRoutines(); go(url.routine(t.id, r.data.task.id), true);
  };
  setTimeout(() => $('#nText') && $('#nText').focus(), 0);
}

// ---------- un objetivo (o una ejecución de una rutina) ----------
// Arriba lo que importa: el resultado (o qué pasa ahora). Después qué hizo cada asiento, con sus pasos en palabras
// normales — salen de la traza de su sesión (.lampson/trace/<sid>.log vía api/trace), recortada a la ventana del
// objetivo — y el tablero de este objetivo, que se resalta cuando algo cambia.
function boardHtml(tasks, moved) {
  return LANES.map(([st, label]) => {
    const cs = tasks.filter((t) => t.status === st);
    return `<div class="lane"><h6><span>${label}</span><span>${cs.length}</span></h6><div class="cards">${cs.map((t) => `<div class="card${moved && moved.has(t.id) ? ' moved' : ''}"><div class="cid">#${t.id}</div>${esc(t.title)}${t.depends && t.depends.length ? `<div class="dep">depende de ${t.depends.map((d) => '#' + d).join(', ')}</div>` : ''}${t.notes ? `<div class="notes">${esc(t.notes)}</div>` : ''}${t.owner ? `<div class="own">${esc(t.owner)}</div>` : ''}</div>`).join('')}</div></div>`;
  }).join('');
}
// «over cap» (lib/teams.syn → team_turn_end): «670000 of 600000 daily tokens — …», dicho para la persona
function overText(r) {
  const m = String(r.text || '').match(/^(\d+) of (\d+)/); if (!m) return r.text;
  return `hoy lleva ${k(+m[1])} de ${k(+m[2])}` + (/no more turns/.test(r.text) ? ': sin más turnos hoy' : ': sigue porque el objetivo tiene presupuesto');
}
// ¿un asiento pasó su tope diario? (solo cuenta para objetivos de hoy: el gasto es del día)
const overCap = (o, s) => s.cap > 0 && s.today >= s.cap && new Date(o.created_at * 1000).toDateString() === new Date().toDateString();
function logHtml(rows, el) {
  const fresh = [];
  const html = rows.map((r) => {
    const key = el.id + ':' + r.id;
    const isNew = state.seen.size > 0 && !state.seen.has(key);
    fresh.push(key);
    return `<li class="${isNew ? 'fresh' : ''}"><span class="t">${hhmm(r.at)}</span><span class="a">${esc(r.actor)}</span><span class="k ${esc(r.kind.split(' ')[0])}">${esc(KIND[r.kind] || r.kind)} ${esc(r.ref)}</span>${r.text && r.text !== 'null' ? `<span class="x">${esc(r.kind === 'over cap' ? overText(r) : r.text)}</span>` : ''}</li>`;
  }).join('');
  el.innerHTML = html || '<li class="hint">Nada todavía.</li>';
  fresh.forEach((x) => state.seen.add(x));
}
// la traza de una sesión → pasos con fecha completa. Las líneas traen solo la hora (UTC); la fecha sale del id de la
// sesión (AAAAMMDD-…) y avanza un día cada vez que la hora vuelve para atrás
function parseTrace(sid, txt) {
  const m0 = String(sid).match(/^(\d{4})(\d{2})(\d{2})/); if (!m0) return [];
  let day = Date.UTC(+m0[1], +m0[2] - 1, +m0[3]) / 1000, prev = -1;
  const out = [];
  for (const line of String(txt || '').split('\n')) {
    const m = line.match(/^(\d\d):(\d\d):(\d\d)\.(\d{3}) .{6}s {2}(\S+)\s+(.*)$/); if (!m) continue;
    const secs = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    if (prev >= 0 && secs < prev - 60) day += 86400;
    prev = secs;
    out.push({ at: day + secs, kind: m[5], text: m[6] });
  }
  return out;
}
const TASK_ST = { todo: 'por hacer', doing: 'en curso', review: 'en revisión', done: 'hecha', blocked: 'bloqueada' };
const short = (s, n = 90) => { const t = String(s ?? '').replace(/\s*⏎\s*/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
// una llamada a una herramienta, dicha como lo haría una persona
function sayCall(name, a) {
  a = a || {};
  const p = a.path || a.file || '';
  switch (name) {
    // si el corte de la traza se llevó la ruta, se dice en general (sin un hueco)
    case 'read': return p ? `leyó <code>${esc(p)}</code>` : 'leyó un archivo';
    case 'write': return p ? `escribió <code>${esc(p)}</code>` : 'escribió un archivo';
    case 'edit': return p ? `editó <code>${esc(p)}</code>` : 'editó un archivo';
    case 'ls': return `miró la carpeta <code>${esc(p || '.')}</code>`;
    case 'find': case 'grep': return `buscó «${esc(short(a.pattern || a.query || a.name || '', 60))}»`;
    case 'bash': return a.command ? `corrió <code>${esc(short(a.command, 80))}</code>` : 'corrió un comando';
    case 'todo': return 'actualizó su lista de pendientes';
    case 'fetch': return `consultó <code>${esc(short(a.url, 70))}</code>`;
    case 'memory': return 'anotó algo en la memoria';
    case 'send': return (a.recipient ? `le escribió a <b>${esc(a.recipient)}</b>` : 'mandó un mensaje') + (a.message ? `: «${esc(short(a.message, 140))}»` : '');
    case 'board': {
      const act = a.action;
      if (act === 'list') return 'miró el tablero';
      if (act === 'add') return `creó la tarea «${esc(short(a.title, 80))}»${a.owner ? ' para <b>' + esc(a.owner) + '</b>' : ''}`;
      if (act === 'claim') return `tomó la tarea #${esc(a.id)}`;
      if (act === 'update') return `movió la tarea #${esc(a.id)}${a.status ? ' a «' + esc(TASK_ST[a.status] || a.status) + '»' : ''}${a.notes ? ': ' + esc(short(a.notes, 100)) : ''}`;
      return `revisó el tablero (${esc(act || '')})`;
    }
    case 'objective': {
      const msg = esc(short(a.message, 160)), act = a.action;
      if (act === 'report') return `informó: «${msg}»`;
      if (act === 'ask') return `te preguntó: «${msg}»`;
      if (act === 'request_approval') return `pidió tu aprobación: «${msg}»`;
      if (act === 'done') return 'cerró el objetivo con su informe';
      if (act === 'fail') return `lo dio por fallido: «${msg}»`;
      return 'miró el objetivo';
    }
    default: return `usó <code>${esc(name)}</code>`;
  }
}
// la traza corta cada línea a 600 caracteres: en un edit el texto nuevo va primero y la ruta queda después del corte.
// Si el JSON llegó cortado, se rescatan uno por uno los campos que se muestran (lo que sí alcanzó a quedar)
function salvageArgs(raw) {
  const out = {};
  for (const key of ['path', 'file', 'command', 'recipient', 'message', 'title', 'owner', 'id', 'status', 'action', 'notes', 'pattern', 'query', 'url']) {
    const m = String(raw).match(new RegExp(String.raw`"${key}":\s*("(?:[^"\\]|\\.)*"|-?\d+)`));
    if (m) { try { out[key] = JSON.parse(m[1]); } catch (x) {} continue; }
    // un texto que el corte dejó sin cerrar: lo que alcanzó a quedar, con «…»
    const c = String(raw).match(new RegExp(String.raw`"${key}":\s*"((?:[^"\\]|\\.)*?)\\?$`));
    if (c) { try { out[key] = JSON.parse('"' + c[1] + '"') + '…'; } catch (x) {} }
  }
  return out;
}
// los pasos de un asiento, agrupados por turno: qué lo despertó, qué dijo, qué hizo (con el detalle técnico a un clic)
function stepsOf(evs) {
  const turns = []; let cur = null, last = null;
  for (const e of evs) {
    if (e.kind === 'USER') {
      const t = e.text.replace(/^\[[^\]]*\]\s*/, '');
      const why = /^\[round\]/.test(t) ? 'ronda: revisó si tenía algo pendiente' : /^\[message from ([^\]]+)\]/.test(t) ? 'le llegó un mensaje de ' + t.match(/^\[message from ([^\]]+)\]/)[1] : /^\[objective O-/.test(t) ? 'recibió el objetivo' : 'empezó un turno';
      cur = { at: e.at, why, items: [], tokens: 0 }; turns.push(cur); continue;
    }
    if (!cur) { cur = { at: e.at, why: 'turno', items: [], tokens: 0 }; turns.push(cur); }
    if (e.kind === 'SAY') cur.items.push({ at: e.at, html: `«${mdInline(short(e.text, 400))}»`, cls: 'say' });
    else if (e.kind === 'CALL') {
      const sp = e.text.indexOf(' '), name = sp < 0 ? e.text : e.text.slice(0, sp); let args = {};
      try { args = JSON.parse(e.text.slice(sp + 1)); } catch (x) { args = salvageArgs(e.text.slice(sp + 1)); }
      last = { at: e.at, html: sayCall(name, args), raw: e.text, cls: 'call' }; cur.items.push(last);
    } else if ((e.kind === 'OK' || e.kind === 'FAIL') && last) { last.out = e.text.replace(/^\S+ → /, ''); if (e.kind === 'FAIL') last.cls += ' bad'; }
    else if (e.kind === 'DENY') cur.items.push({ at: e.at, html: 'no se le permitió: ' + esc(short(e.text, 200)), cls: 'bad' });
    else if (e.kind === 'ERR') cur.items.push({ at: e.at, html: 'error: ' + esc(short(e.text, 200)), cls: 'bad' });
    // gasto con la misma regla que el del objetivo (lib/runtime.syn): lo que ya estaba en caché cuenta un décimo
    else if (e.kind === 'STEP') { const m = e.text.match(/in=(\d+)(?: \(cache (\d+)\))? out=(\d+)/); if (m) cur.tokens += +m[1] - (+m[2] || 0) + Math.floor((+m[2] || 0) / 10) + +m[3]; }
  }
  return turns;
}
function seatTimelineHtml(turns, agent) {
  if (!turns.length) return '<p class="ihint">No trabajó en este objetivo.</p>';
  const raw = state.openRaw || new Set();
  return turns.map((t) => `<div class="turn"><div class="twhy"><span class="t">${hhmm(t.at)}</span>${esc(t.why)}${t.tokens ? `<span class="tk">${k(t.tokens)} tokens</span>` : ''}</div>
    <ol>${t.items.map((i) => i.raw ? `<li class="${i.cls}"><details data-k="${esc(agent + ':' + i.at)}"${raw.has(agent + ':' + i.at) ? ' open' : ''}><summary><span class="t">${hhmm(i.at)}</span>${i.html}</summary><pre>${esc(i.raw)}${i.out ? '\n→ ' + esc(i.out) : ''}</pre></details></li>` : `<li class="${i.cls}"><span class="t">${hhmm(i.at)}</span>${i.html}</li>`).join('')}</ol></div>`).join('');
}
// ¿está trabajando ahora? (el buzón del agente en la conversación del objetivo: api/teams para un equipo, el objetivo si es solo)
const workingNow = (o, agent) => o.team ? ((teamOf(o.team) || { members: [] }).members.find((m) => m.agent === agent) || {}).working : o.working;
// la traza de cada asiento, recortada a la ventana del objetivo (mientras está abierto se relee: cada 3 s si alguien trabaja, si no cada 10)
async function loadSeatWork(o) {
  const end = OPEN_OBJ.includes(o.status) ? Date.now() / 1000 + 60 : o.updated_at + 60;
  const key = o.id + ':' + o.status;
  const busy = (o.seats || []).some((x) => workingNow(o, x.agent)), every = busy ? 3000 : 10000;
  if (state.work && state.work.key === key && OPEN_OBJ.includes(o.status) && Date.now() - state.work.at < every) return state.work.seats;
  if (state.work && state.work.key === key && !OPEN_OBJ.includes(o.status)) return state.work.seats;
  const seats = await Promise.all((o.seats || []).map(async (s) => {
    if (!s.session) return { ...s, turns: [] };
    const r = await api('trace?session=' + enc(s.session) + '&tail=100000');
    const evs = parseTrace(s.session, r.ok ? r.data.trace : '').filter((e) => e.at >= o.created_at - 2 && e.at <= end);
    return { ...s, turns: stepsOf(evs) };
  }));
  state.work = { key, at: Date.now(), seats };
  return seats;
}
// el informe: cada línea en su párrafo, y las rutas de archivos como código
// markdown chico: lo que escriben los agentes (**negrita**, `código`, rutas) se ve con formato y no con los signos
function mdInline(t) {
  return esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(«])((?:[\w.-]+\/)+[\w.-]+|[\w-]+\.(?:md|js|ts|tsx|jsx|json|py|syn|css|html|yml|yaml|txt|csv))(?=[\s),.;:»]|$)/g, (m, a, b) => a + '<code>' + b + '</code>');
}
// el informe: un párrafo por línea; «- …» como lista; las partes «**Algo:**» como títulos chicos
function reportHtml(txt) {
  const lines = String(txt || '').replace(/\s+-\s+(?=\*\*)/g, '\n- ').split(/\n+|(?=\s✓\s)/).map((l) => l.trim()).filter(Boolean);
  let html = '', list = false;
  for (const l of lines) {
    const li = l.match(/^[-•*]\s+(.*)$/);
    if (li && !list) { html += '<ul>'; list = true; }
    if (!li && list) { html += '</ul>'; list = false; }
    html += li ? `<li>${mdInline(li[1])}</li>` : `<p>${mdInline(l)}</p>`;
  }
  return html + (list ? '</ul>' : '');
}
async function loadObj() {
  const id = state.route.obj; if (!id) return;
  const r = await api('objectives/' + id);
  if (!r.ok) { $('#objDetail').innerHTML = '<div class="empty">Ese objetivo no existe.</div>'; return; }
  const o = r.data;
  // la URL con el equipo (un enlace viejo o /objetivos/<n> de un objetivo que es de un equipo)
  if (o.team && state.route.team !== o.team) { history.replaceState(null, '', url.obj(o.team, o.id)); state.route = parseRoute(); renderCrumbs(); }
  if (state.route.obj !== id) return;
  // lo desplegado (pasos de un asiento, el detalle de un paso, el pedido entero) sobrevive al pulso; otro objetivo, de cero
  if (state.openFor !== id) { state.openFor = id; state.openSeats = new Set(); state.openRaw = new Set(); state.askOpen = false; }
  if (OPEN_OBJ.includes(o.status)) { await renderLive(o); return; }
  if (state.liveKey) { state.liveKey = null; $('#objDetail').classList.remove('lvmode'); }
  const seats = await loadSeatWork(o);
  if (state.route.obj !== id) return;
  // qué cambió en el tablero desde el último pulso: se resalta un instante
  const prev = state.boardSeen && state.boardSeen.id === id ? state.boardSeen.map : null, moved = new Set();
  (o.tasks || []).forEach((t) => { if (prev && prev[t.id] !== t.status) moved.add(t.id); });
  state.boardSeen = { id, map: Object.fromEntries((o.tasks || []).map((t) => [t.id, t.status])) };
  const open = OPEN_OBJ.includes(o.status), pct = o.budget_tokens > 0 ? Math.min(100, Math.round((100 * o.spent) / o.budget_tokens)) : 0;
  const rid = routineOf(o), rt = rid && state.routines.find((x) => x.id === rid);
  const long = o.text.length > 280, openSeats = state.openSeats || (state.openSeats = new Set());
  const ordered = [...seats].sort((a, b) => b.lead - a.lead);
  const seatRow = (s) => {
    const mine = (o.tasks || []).filter((t) => t.owner === s.agent), done = mine.filter((t) => t.status === 'done');
    const tokens = s.turns.reduce((n, t) => n + t.tokens, 0), calls = s.turns.reduce((n, t) => n + t.items.filter((i) => i.raw).length, 0);
    const lastSay = [...s.turns].reverse().flatMap((t) => [...t.items].reverse()).find((i) => i.cls === 'say');
    const what = done.length ? 'hizo ' + done.map((t) => '«' + esc(short(t.title, 70)) + '»').join(', ') : mine.length ? 'trabaja en ' + mine.map((t) => '«' + esc(short(t.title, 70)) + '»').join(', ') : lastSay ? lastSay.html : s.turns.length ? 'participó sin tareas propias' : 'no trabajó en este objetivo';
    const isOpen = openSeats.has(s.agent), live = open && workingNow(o, s.agent);
    const lastStep = live ? [...s.turns].reverse().flatMap((t) => [...t.items].reverse())[0] : null;
    // el «ahora» se ilumina solo cuando hay un paso nuevo, no en cada pulso
    const seen = state.liveSeen || (state.liveSeen = {}), fresh = !!lastStep && seen[s.agent] !== lastStep.at; if (lastStep) seen[s.agent] = lastStep.at;
    return `<div class="seat${s.turns.length ? '' : ' idle'}"><div class="shead"><span class="av">${esc((s.role || s.agent).normalize('NFD').replace(/\p{M}/gu, '').slice(0, 2))}</span>
      <div class="sbody"><div class="sname"><b>${esc(s.role || s.agent)}</b>${s.lead ? '<span class="fl-lead">líder</span>' : ''}${live ? '<span class="tw">● trabajando</span>' : ''}</div>${live && lastStep ? `<p class="snow${fresh ? ' fresh' : ''}"><span class="t">${hhmm(lastStep.at)}</span>ahora: ${lastStep.html}</p>` : ''}<p class="swhat">${what}</p>
      <p class="smeta">${mine.length ? `${done.length} de ${mine.length} tarea${mine.length === 1 ? '' : 's'} · ` : ''}${calls} paso${calls === 1 ? '' : 's'} · ${k(tokens)} tokens${overCap(o, s) ? ` · <span class="over">hoy lleva ${k(s.today)} de ${k(s.cap)}: pasó su tope diario</span>` : ''}</p></div>
      ${s.turns.length ? `<button class="lnk" data-seat="${esc(s.agent)}">${isOpen ? 'ocultar pasos' : 'ver sus pasos'}</button>` : ''}</div>
      ${isOpen ? `<div class="steps">${seatTimelineHtml(s.turns, s.agent)}</div>` : ''}</div>`;
  };
  const now = o.status === 'waiting' ? `<div class="box q"><h5>${o.question_kind === 'approval' ? 'te pide aprobación' : 'te pregunta'}</h5><p>${esc(o.question)}</p><p class="ds">Respondé arriba, en la franja de lo que te espera.</p></div>`
    : o.result ? `<div class="box res${o.status === 'failed' ? ' bad' : ''}"><h5>${o.status === 'failed' ? 'Por qué no se pudo' : 'Resultado'} <span class="who">informe de ${esc((seats.find((s) => s.lead) || {}).role || o.agent)}</span></h5>${reportHtml(o.result)}</div>`
    : o.progress ? `<div class="box"><h5>Ahora</h5>${reportHtml(o.progress)}</div>` : open ? '<div class="box"><h5>Ahora</h5><p>Arrancando: el líder está repartiendo el trabajo.</p></div>' : '';
  $('#objDetail').innerHTML = `
    <div class="dhead"><span class="ref">${esc(o.ref)}</span><span class="st ${o.status}">${STATUS[o.status] || o.status}</span>${o.working ? '<span class="tw">● trabajando ahora</span>' : ''}
      <span class="dmeta">${rt ? `⟳ ejecución de <a data-nav href="${esc(url.routine(o.team, rid))}">${esc(rt.name)}</a> · ` : ''}${fmtWhen(o.created_at)} · ${o.turns} ronda${o.turns === 1 ? '' : 's'} · ${k(o.spent)}${o.budget_tokens ? ' de ' + k(o.budget_tokens) : ''} tokens</span>
      <span class="spacer"></span><button data-log>Registro</button>${open ? `${o.status === 'paused' ? '<button data-resume>Seguir (más presupuesto)</button>' : ''}<button class="no" data-cancel>Cancelar</button>` : ''}</div>
    ${o.budget_tokens && open ? `<div class="meter ${pct > 80 ? 'hot' : ''}"><i style="width:${pct}%"></i></div>` : ''}
    <div class="rgrid"><div class="rmain">
      <div class="ask0${long && !state.askOpen ? ' clamp' : ''}"><h5>Qué se pidió</h5><p>${esc(o.text)}</p>${long ? `<button class="lnk" data-ask>${state.askOpen ? 'ver menos' : 'ver todo'}</button>` : ''}</div>
      ${now}</div>
      <div class="rside"><h4 class="secttl">Qué hizo cada asiento</h4>${overNote(o)}<div class="seats">${ordered.map(seatRow).join('')}</div></div></div>
    <h4 class="secttl">Tablero de este objetivo ${open ? '<span class="live2">● en vivo</span>' : ''}</h4>
    ${(o.tasks || []).length ? `<div class="board">${boardHtml(o.tasks, moved)}</div>` : '<p class="ihint">Todavía no hay tareas: el líder las crea al repartir el trabajo.</p>'}`;
  bindObjButtons(o);
  if (state.drawer) renderDrawer(o);
  document.querySelectorAll('#objDetail [data-seat]').forEach((b) => (b.onclick = () => { const a = b.dataset.seat; if (openSeats.has(a)) openSeats.delete(a); else openSeats.add(a); loadObj(); }));
  document.querySelectorAll('#objDetail details[data-k]').forEach((d) => (d.ontoggle = () => { if (d.open) state.openRaw.add(d.dataset.k); else state.openRaw.delete(d.dataset.k); }));
}
// quién pasó su tope diario: una nota con a dónde ir a revisarlo (qué se le pide, sus herramientas, el tope)
function overNote(o) {
  const over = (o.seats || []).filter((s) => overCap(o, s)); if (!over.length) return '';
  const names = over.map((s) => `<b>${esc(s.role || s.agent)}</b>`).join(', ');
  return `<p class="overnote">${names} ${over.length === 1 ? 'pasó su' : 'pasaron su'} tope diario de tokens. Mirá sus pasos para ver en qué se le fue${o.team ? ` y, si hace falta, <a data-nav href="${esc(url.edit(o.team))}">ajustá el equipo</a>` : ''}.</p>`;
}
async function refreshObjectives() {
  const r = await api('objectives');
  if (!r.ok) return false;
  state.objectives = r.data.objectives; state.agents = r.data.agents; state.teamsMeta = r.data.teams || [];
  const ap = await api('approvals');
  if (ap.ok) state.approvals = ap.data.approvals || [];
  renderAttention();
  return true;
}
// las rutinas son tareas programadas con acción «objective» (lib/schedule.syn)
async function refreshRoutines() {
  const r = await api('schedules');
  if (!r.ok) return false;
  state.routines = (r.data.tasks || []).filter((t) => t.action && t.action.type === 'objective');
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
  d.members.push({ agent: id, role: 'Asiento ' + r, reports_to: top, description: '', system: '', preset: 'code', permission: 'ask', dirty: true });
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
// Plantillas de equipo. Cada asiento: [agente, rol, jefe, herramientas, qué hace (se ve en el editor), cómo trabaja (su
// instrucción)]. Pensadas como equipos reales: cada uno hace SU parte y no rehace la de otro (el que construye no se
// revisa solo; el que revisa no reconstruye; el líder reparte y controla, no ejecuta), con traspasos cortos. Así el
// trabajo no se duplica y gasta menos. Ante algo riesgoso, cada asiento le pregunta a su jefe; el líder, a la persona.
const WAYS = 'Cómo trabaja este equipo: hacé solo tu parte y no rehagas la de otro; si algo de otro está mal, decíselo con lo concreto (qué, dónde, cómo verlo). Mensajes cortos: qué hiciste, dónde quedó, qué falta. Leé solo lo que necesitás para tu tarea. Si algo te bloquea o es riesgoso, preguntale a quien te reporta.';
const TEMPLATES = [
  { id: 'startup', title: 'Startup', desc: 'Dirección, producto, tecnología y comunicación: cada uno en lo suyo, hacia un mismo objetivo.', members: [
    ['ceo', 'CEO', '', 'read', 'Reparte el objetivo, sigue el avance y decide cuándo está terminado. No ejecuta: delega y controla.',
      'Dirigís. Convertí el objetivo en tareas del tablero, cada una con un dueño claro, y mandale a cada uno lo que necesitás de él. Después seguí el avance y destrabá lo que se frene. No implementás, no revisás código ni escribís documentos: eso lo hace cada responsable. Cerrás cuando cada responsable confirmó su parte; los merges a main los hacés vos cuando el CTO aprobó.'],
    ['cpo', 'CPO', 'ceo', 'code', 'Convierte el objetivo en requisitos cortos y criterios de aceptación verificables.',
      'Escribís los requisitos: un documento corto con qué tiene que hacer y cómo se comprueba (criterios de aceptación verificables), y las decisiones de producto que hagan falta. No implementás ni revisás código. Cuando esté, avisales al CTO y al Dev dónde quedó.'],
    ['cto', 'CTO', 'ceo', 'code', 'Decide el enfoque técnico y verifica lo que entrega el Dev: revisa y prueba. No implementa.',
      'Sos el responsable técnico. Si hace falta, decidí el enfoque y decíselo al Dev en pocas líneas. Cuando el Dev entrega, revisá el cambio contra los requisitos y escribí y corré las pruebas que lo verifican. No implementás la funcionalidad: si algo falla, devolvéselo al Dev con lo concreto. Cuando aprobás, avisale al CEO que está listo para main.'],
    ['dev', 'Dev', 'cto', 'code', 'Implementa en su rama y entrega algo que corre. Las pruebas de verificación las hace el CTO.',
      'Implementás lo que pide tu tarea, en tu rama. Antes de entregar comprobá que funciona: que corre, sin errores ni advertencias, y que lo que ya andaba sigue andando. Las pruebas de verificación las escribe el CTO: no las dupliques. Entregá con un commit y un mensaje corto al CTO: qué cambiaste y dónde.'],
    ['cmo', 'CMO', 'ceo', 'code', 'Documenta y comunica lo que se hizo: guía para usuarios, notas de versión, anuncios.',
      'Comunicás lo que se hizo: documentación para quien lo usa, notas de versión y anuncios. Escribí a partir de lo ya entregado y aprobado (leé el código y lo que informó el CTO), no de supuestos. No tocás el código ni lo verificás: eso ya lo hizo el CTO. No levantes servidores ni corras pruebas.']],
    talks: [['cpo', 'cto'], ['cmo', 'cto']] },
  { id: 'software', title: 'Desarrollo de software', desc: 'Un líder técnico que reparte y aprueba, desarrollo que construye y QA que verifica.', members: [
    ['lider', 'Líder técnico', '', 'read', 'Reparte el trabajo, decide el enfoque y da el OK final. No implementa ni prueba.',
      'Liderás. Repartí el trabajo en tareas con dueño, decidí el enfoque cuando haga falta (en pocas líneas) y seguí el avance. No implementás ni probás: delegás y controlás. Cuando QA aprueba, hacés el merge a main y cerrás.'],
    ['dev', 'Dev', 'lider', 'code', 'Implementa en su rama y entrega algo que corre. Las pruebas de verificación las hace QA.',
      'Implementás lo que pide tu tarea, en tu rama. Antes de entregar comprobá que funciona: que corre, sin errores ni advertencias, y que lo que ya andaba sigue andando. Las pruebas de verificación las escribe QA: no las dupliques. Entregá con un commit y un mensaje corto a QA: qué cambiaste y dónde.'],
    ['qa', 'QA', 'lider', 'code', 'Verifica lo que entrega el Dev contra lo pedido: revisa, escribe y corre las pruebas.',
      'Verificás lo que entrega el Dev contra lo pedido: revisá el cambio y escribí y corré las pruebas que lo comprueban. No arreglás el código: si algo falla, devolvéselo al Dev con qué falla y cómo reproducirlo. Cuando pasa, avisale al líder que está listo.']],
    talks: [['dev', 'qa']] },
  { id: 'contenido', title: 'Contenido y marketing', desc: 'Un editor que planifica y aprueba, un redactor que escribe y un corrector que pule.', members: [
    ['editor', 'Editor', '', 'read', 'Planifica qué se publica, encarga cada pieza con un brief y aprueba. No redacta.',
      'Editás. Decidí qué piezas hacen falta y encargalas con un brief corto: para quién es, qué tiene que lograr, tono y largo. Seguí el avance y aprobá cuando el corrector la dio por buena. No redactás ni corregís: delegás y controlás.'],
    ['redactor', 'Redactor', 'editor', 'code', 'Escribe las piezas según el brief: artículos, publicaciones, guiones, newsletters.',
      'Escribís las piezas según el brief del editor, en archivos del proyecto. Basate en información real del proyecto, no inventes datos. Cuando terminás un borrador, pasáselo al corrector diciéndole dónde está.'],
    ['corrector', 'Corrector', 'editor', 'code', 'Revisa cada pieza: datos, claridad, tono, ortografía y SEO. Corrige lo puntual, no reescribe.',
      'Revisás cada borrador: que los datos sean ciertos, que se entienda, el tono, la ortografía y lo básico de SEO. Corregí lo puntual vos mismo; si hace falta reescribir algo, devolvéselo al redactor con lo concreto. Cuando está bien, avisale al editor.']],
    talks: [['redactor', 'corrector']] },
  { id: 'soporte', title: 'Base de conocimiento de soporte', desc: 'No atiende clientes: escribe lo que se usa para responderles (preguntas frecuentes, ayuda, respuestas modelo).', members: [
    ['coordinador', 'Coordinador', '', 'read', 'Decide qué falta documentar según las dudas frecuentes y el producto, reparte y aprueba.',
      'Coordinás la base de conocimiento que usan las personas y los agentes que atienden clientes: preguntas frecuentes, artículos de ayuda y respuestas modelo. Decidí qué falta o qué quedó viejo (por las dudas frecuentes, los cambios del producto o lo que te pidan), encargalo con un brief corto y aprobá. No escribís los artículos.'],
    ['redactor', 'Redactor de ayuda', 'coordinador', 'code', 'Escribe preguntas frecuentes, artículos de ayuda y respuestas modelo, claros y paso a paso.',
      'Escribís el material de ayuda: preguntas frecuentes, artículos paso a paso y respuestas modelo, en archivos del proyecto. Lenguaje simple, para alguien que no conoce el producto. Cuando terminás, pasáselo al verificador diciéndole dónde está.'],
    ['verificador', 'Verificador', 'coordinador', 'read', 'Comprueba contra el producto real que lo escrito sea cierto y esté al día.',
      'Comprobás que lo que escribió el redactor sea cierto contra el producto real (su código, su configuración, su documentación) y que los pasos funcionen. No reescribís: si algo no coincide, devolvéselo al redactor con lo concreto. Cuando está bien, avisale al coordinador.']],
    talks: [['redactor', 'verificador']] },
  { id: 'seguridad', title: 'Auditoría de seguridad', desc: 'Busca vulnerabilidades sin tocar el código y entrega un informe priorizado. Ideal como rutina semanal.', members: [
    ['jefe', 'Jefe de seguridad', '', 'code', 'Define qué se revisa, reparte y consolida un informe priorizado. No corrige el código.',
      'Dirigís la auditoría. Definí el alcance (qué partes, qué cambió desde la última), repartilo y consolidá lo que encuentren en un informe priorizado por gravedad, con dónde está cada problema, por qué importa y cómo arreglarlo. Escribí el informe en un archivo con la fecha. No corregís el código ni lo hacen ellos: el informe es la entrega.'],
    ['codigo', 'Auditor de código', 'jefe', 'read', 'Revisa el código: entradas sin validar, inyecciones, autenticación, permisos, secretos.',
      'Revisás el código buscando vulnerabilidades: entradas sin validar, inyecciones, autenticación y permisos, manejo de secretos, datos sensibles expuestos. Para cada hallazgo: dónde está (archivo y línea), qué tan grave, cómo se explota y cómo se arregla. Solo hallazgos reales, sin relleno. No tocás el código. Pasale los hallazgos al jefe.'],
    ['dependencias', 'Auditor de dependencias', 'jefe', 'read', 'Revisa dependencias, configuración y secretos en el repositorio.',
      'Revisás las dependencias (versiones con vulnerabilidades conocidas, paquetes abandonados), la configuración (permisos, opciones inseguras, CI) y si hay secretos en el repositorio o en su historia. Usá las herramientas de auditoría que ya tenga el proyecto. Para cada hallazgo: dónde, qué tan grave y cómo se arregla. No tocás nada. Pasale los hallazgos al jefe.']],
    talks: [['codigo', 'dependencias']] },
  { id: 'vacio', title: 'Un solo asiento', desc: 'Un líder que hace todo. Para probar, o para sumar asientos de a uno en el lienzo.', members: [['lider', 'Líder', '', 'code', 'Hace el trabajo y, si sumás asientos, coordina al resto.', 'Hacés el trabajo vos; si el equipo crece, repartilo y controlá.']], talks: [] },
];
function startNewTeam() { go(url.newTeam()); }
function draftFromTemplate(tpl, name, desc) {
  // cada asiento, su propio agente: si el proyecto ya tiene uno con ese nombre (de otro equipo), este se llama
  // <equipo>-<asiento>. Compartirlo arrastraba sus instrucciones viejas y su gasto del día (el tope es por agente):
  // visto 2026-10-17, un equipo nuevo arrancó con todos «pasados de tope» y el CEO se asignó todo
  const known = new Set([...(state.agents || []).map((a) => a.id), ...state.teams.flatMap((t) => t.members.map((m) => m.agent))]);
  const ids = {}; tpl.members.forEach(([agent]) => { ids[agent] = known.has(agent) ? slugify(name).slice(0, 39 - agent.length).replace(/-+$/, '') + '-' + agent : agent; });
  return { isNew: true, id: name, lead: ids[tpl.members[0][0]], description: desc || (tpl.id === 'vacio' ? '' : tpl.title), round_minutes: 0, budget_daily_tokens: 300000, worktrees: true, talks: tpl.talks.map(([x, y]) => [ids[x], ids[y]]),
    members: tpl.members.map(([agent, role, boss, preset, d, how]) => ({ agent: ids[agent], role, reports_to: boss ? ids[boss] : '', description: d, system: `Sos ${role} del equipo. ${how || d}\n\n${WAYS}`, preset, permission: 'ask', dirty: true })) };
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
  $('#wCancel').onclick = () => { state.wizard = null; go(url.list(), true); };
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
  if (d) return `<div class="tsub-l"><button type="button" class="back" id="eBack" title="volver sin guardar">← ${esc(d.isNew ? 'Equipos' : teamName(d.id))}</button><div class="namebox"><label class="inl">Nombre <input id="eId" value="${esc(d.name ?? d.id)}" placeholder="producto" size="18" autocomplete="off"></label><span class="slug" id="eSlug">${slugNote(d)}</span></div>
      <label class="inl grow">Para qué es <input id="eDesc" value="${esc(d.description)}" placeholder="una línea: qué hace este equipo"></label>
      <details class="advpop"><summary>Opciones</summary><div class="advgrid">
        <div class="opt"><div class="oh"><label for="eRound">Rondas automáticas cada</label>${help('Cada cuánto un asiento retoma por su cuenta lo que tiene pendiente —sus tareas del tablero o novedades que lo involucran— aunque nadie le escriba. Los mensajes y los objetivos le llegan igual, al momento. Más seguido avanza más rápido, pero gasta más.')}</div>
          <span class="unit"><input id="eRound" type="number" min="0" value="${d.round_minutes}"> min</span><span class="ds">0 = sin rondas: trabajan cuando les llega un objetivo o un mensaje</span></div>
        <div class="opt"><div class="oh"><label for="eBudget">Gasto máximo por asiento, por día</label>${help('Cuántos tokens puede usar cada asiento en un día. Al llegar al tope no recibe más turnos hasta el día siguiente, y queda anotado en el registro. Sirve para que un equipo no gaste de más si algo se traba.')}</div>
          <span class="unit"><input id="eBudget" type="number" min="0" step="10000" value="${d.budget_daily_tokens}"> tokens</span><span class="ds">0 = sin tope</span></div>
        <div class="opt"><div class="oh"><label class="chk"><input id="eWt" type="checkbox" ${d.worktrees ? 'checked' : ''}> Cada asiento en su propia copia de git</label>${help('Si el proyecto usa git, cada asiento trabaja en su rama y en su propia copia de los archivos: nadie pisa el trabajo de otro. Llevar los cambios a la rama principal lo hace el líder, con tu aprobación.')}</div></div>
        ${d.isNew ? '' : deleteBoxHtml(d)}
      </div></details></div>
    <div class="tsub-r"><span class="ferr" id="eErr"></span><button id="eCancel">${d.isNew ? 'Descartar' : 'Cancelar'}</button><button class="primary" id="eSave">${d.isNew ? 'Crear equipo' : 'Guardar cambios'}</button></div>`;
  return '';
}
// borrar el equipo: dos pasos, diciendo antes qué pasa con lo suyo (lib/api.syn → delete_team)
function deleteBoxHtml(d) {
  const open = state.objectives.filter((o) => o.team === d.id && OPEN_OBJ.includes(o.status)).length, rts = state.routines.filter((r) => r.action.team === d.id).length;
  // sus agentes se van con él (se crearon para este equipo); solo queda el que también está en otro equipo
  const shared = d.members.map((m) => [m, state.teams.find((t) => t.id !== d.id && t.members.some((x) => x.agent === m.agent))]).filter(([, t]) => t);
  const own = d.members.length - shared.length;
  const what = [own ? `se borra${own === 1 ? '' : 'n'} ${own === 1 ? 'su agente' : 'sus ' + own + ' agentes'}` : '', open ? `se cancela${open === 1 ? '' : 'n'} ${open} objetivo${open === 1 ? '' : 's'} en curso` : '', rts ? `se borra${rts === 1 ? '' : 'n'} ${rts} rutina${rts === 1 ? '' : 's'}` : ''].filter(Boolean);
  const said = what.length ? what.slice(0, -1).join(', ') + (what.length > 1 ? ' y ' : '') + what[what.length - 1] : '';
  return `<div class="opt danger"><div class="oh"><b>Eliminar este equipo</b></div>
    <p class="ds">${said ? said[0].toUpperCase() + said.slice(1) + '. ' : ''}${shared.length ? shared.map(([m, t]) => `${esc(m.role || m.agent)} queda porque también está en «${esc(t.name || t.id)}». `).join('') : ''}El historial de sus objetivos queda, y el trabajo que no llegó a la rama principal queda guardado en ramas <code>archive/</code>. Un equipo nuevo con el mismo nombre arranca de cero.</p>
    <button type="button" class="no" id="eDelete">Eliminar equipo</button></div>`;
}
// ---------- la lista: una tarjeta por equipo del proyecto, y «+ nuevo equipo» ----------
// la tarjeta de un equipo: quién es y tres puertas (objetivos, rutinas, editar). Lo único que se ve sin entrar es si
// algo te espera; los números salen de lo que la pantalla ya tiene cargado (no suma pedidos)
function teamCardHtml(t) {
  const lead = t.lead || (t.members.find((m) => !m.reports_to) || t.members[0] || {}).agent;
  const roles = [...t.members].sort((a, b) => (b.agent === lead) - (a.agent === lead));
  const mine = (state.objectives || []).filter((o) => o.team === t.id), waiting = mine.filter((o) => o.status === 'waiting').length;
  const working = t.members.some((m) => m.working), rts = state.routines.filter((r) => r.action.team === t.id).length;
  const cnt = (n) => (n ? ` <span class="cnt">${n}</span>` : '');
  return `<article class="tcard3" data-team="${esc(t.id)}" tabindex="0" title="ver sus objetivos y rutinas">
    <div class="thead"><h3>${esc(t.name || t.id)}</h3>${waiting ? `<span class="tw wait">⚑ te espera${waiting > 1 ? 'n ' + waiting : ''}</span>` : working ? '<span class="tw">● trabajando</span>' : ''}</div>
    ${t.description ? `<p class="tdesc">${esc(t.description)}</p>` : ''}
    <div class="roles">${roles.map((m) => `<span class="role${m.agent === lead ? ' lead' : ''}${m.working ? ' on' : ''}" title="${esc(m.agent)}${m.agent === lead ? ' · líder' : ''}">${esc(m.role || m.agent)}</span>`).join('')}</div>
    <div class="tacts"><a class="btn primary" data-nav href="${esc(url.team(t.id))}">Objetivos${cnt(mine.length)}</a><a class="btn" data-nav href="${esc(url.team(t.id))}#rutinas">Rutinas${cnt(rts)}</a><a class="btn" data-nav href="${esc(url.edit(t.id))}">Editar</a></div>
  </article>`;
}
function listHtml() {
  const proj = BASE ? BASE.slice(3).replace(/-[0-9a-f]{8}$/, '') : 'este proyecto';
  return `<div class="tlhead"><h2>Equipos de ${esc(proj)}</h2><p>Cada equipo es un grupo de asientos con un líder. Un proyecto puede tener varios: uno que programa, otro que escribe, otro que atiende.</p></div>
    <div class="tgrid3">${state.teams.map(teamCardHtml).join('')}
      <button type="button" class="tnew" id="newTeamCard"><span class="plus">+</span><b>Nuevo equipo</b><span>Elegí una plantilla o empezá con un solo asiento.</span></button></div>
`;
}
function bindList() {
  $('#newTeamCard').onclick = () => go(url.newTeam());
  document.querySelectorAll('.tcard3').forEach((c) => {
    const open = () => go(url.team(c.dataset.team));
    c.onclick = (e) => { if (e.target.closest('button, a')) return; open(); };
    c.onkeydown = (e) => { if (e.key === 'Enter' && e.target === c) open(); };
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
  const del = $('#eDelete');
  if (del) del.onclick = async () => {
    if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = `¿Seguro? Eliminar «${d.name || d.id}»`; return; }
    del.disabled = true; del.textContent = 'eliminando…';
    const r = await api('teams/delete', { id: d.id, agents: true });
    if (!r.ok) { del.disabled = false; del.textContent = 'Eliminar equipo'; delete del.dataset.sure; $('#eErr').textContent = 'No se pudo eliminar: ' + ((r.data && r.data.error) || r.error || ''); return; }
    try { localStorage.removeItem('lampson.flow:' + BASE + ':' + d.id); } catch (e) {}
    state.draft = null; await refresh(); go(url.list(), true);
  };
  const leave = () => { const back = d.isNew ? url.list() : url.team(d.id); state.draft = null; state.sel = null; go(back, true); };
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
  state.draft = null; state.sel = null; state.teams = r.data.teams;
  go(url.team(d.id), true);
}

document.addEventListener('pointerdown', (e) => document.querySelectorAll('details.advpop[open], details.qhelp[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('details.advpop[open], details.qhelp[open]').forEach((d) => (d.open = false)); });
// ---------- la página de la ruta ----------
function route() {
  state.route = parseRoute(); const r = state.route;
  if (r.page !== 'edit' && r.page !== 'newteam') { state.draft = null; state.sel = null; }
  if (r.page === 'edit' && state.draft && state.draft.id !== r.team) state.draft = null;
  if (r.page === 'newteam' && !state.draft && !state.wizard) state.wizard = { tpl: 'software', name: '', desc: '' };
  if (r.page !== 'newteam') state.wizard = null;
  const fkey = r.form ? r.team + ':' + r.form : '';
  if (fkey && (!state.form || state.form.team !== r.team)) state.form = { team: r.team, text: '', freq: 'daily', at: '09:00', every: 6, days: ['mon'], budget: 600000 };
  if (!fkey) state.form = null;
  state.formKey = null; state.drawer = null; state.liveKey = null;
  $('#objDetail').classList.remove('lvmode'); $('#objDrawer').hidden = true;
  render();
  if (r.page === 'obj') loadObj();
  // …/equipos/<equipo>#rutinas: directo a esa sección; si no, arriba de todo
  const anchor = location.hash && document.getElementById(location.hash.slice(1));
  if (anchor) anchor.scrollIntoView({ block: 'start' }); else { window.scrollTo(0, 0); document.querySelectorAll('.tlist').forEach((x) => (x.scrollTop = 0)); }
}
// light: el pulso — repinta las páginas de lectura (lista, equipo, rutina) sin tocar formularios ni el lienzo
function render(light) {
  const r = state.route;
  renderCrumbs();
  if (r.page === 'edit' && !state.draft) { const t = teamOf(r.team); if (t) state.draft = draftFrom(t); }
  const d = state.draft, editing = (r.page === 'edit' || r.page === 'newteam') && !!d, listing = r.page === 'list' || (r.page === 'newteam' && !d);
  $('#tlist').hidden = !listing; $('#tpage').hidden = r.page !== 'team'; $('#rpage').hidden = r.page !== 'routine'; $('#opage').hidden = r.page !== 'obj'; $('#tedit').hidden = !editing;
  const loaded = state.loaded;
  if (listing) { $('#tlist').innerHTML = listHtml(); bindList(); }
  if (r.page === 'team') {
    const t = teamOf(r.team);
    $('#tpage').innerHTML = t ? teamPageHtml(t) : loaded ? `<div class="oempty">No hay un equipo «${esc(r.team)}» en este proyecto. <a data-nav href="${esc(url.list())}">Ver los equipos</a></div>` : '';
    const dn = $('#tpage details.done'); if (dn) dn.ontoggle = () => (state.doneOpen = dn.open);
  }
  if (r.page === 'routine') {
    const rt = state.routines.find((x) => x.id === r.routine);
    if (!(light && $('#rpage').contains(document.activeElement) && document.activeElement.id === 'rtDel')) {
      $('#rpage').innerHTML = rt ? routinePageHtml(rt) : loaded ? `<div class="oempty">Esa rutina ya no existe. <a data-nav href="${esc(url.team(r.team))}">Volver al equipo</a></div>` : '';
      if (rt) bindRoutinePage(rt);
    }
  }
  if (light) return;
  // las plantillas (equipo nuevo) y el formulario de objetivo o rutina: encima de la página
  const wz = $('#wizard'); wz.hidden = !state.wizard;
  if (state.wizard) { wz.innerHTML = wizardHtml(); bindWizard(); }
  const fo = $('#objNew'), fkey = r.form ? r.team + ':' + r.form : '';
  fo.hidden = !fkey;
  if (fkey && state.formKey !== fkey) { const t = teamOf(r.team); if (t) { state.formKey = fkey; fo.innerHTML = objFormHtml(t, r.form); bindObjForm(t, r.form); } }
  // el lienzo
  $('#tsub').innerHTML = editing ? subbarHtml() : '';
  $('#ovAdd').innerHTML = editing ? `<button class="primary" id="addSeat">+ asiento</button><span class="ahint">Arrastrá el punto de abajo hasta otro asiento: ese le reporta.</span>` : '';
  const insp = $('#inspector'); insp.hidden = !(editing && state.sel); insp.innerHTML = insp.hidden ? '' : inspectorHtml();
  if (editing) { renderGraph(); bindEditor(); } else state.lastMode = 'list';
}
const renderTeams = () => render();
async function refreshTeams() {
  const r = await api('teams');
  if (!r.ok) return false;
  state.teams = r.data.teams;
  return true;
}

// ---------- pulso ----------
async function refresh() {
  const ok = (await Promise.all([refreshObjectives(), refreshTeams(), refreshRoutines()])).every(Boolean);
  state.loaded = true;
  render(true);
  if (state.route.page === 'obj') await loadObj();
  $('#live').classList.toggle('off', !ok);
}
legacyRedirect();
state.route = parseRoute();
renderCrumbs();
refresh().then(route);
setInterval(refresh, 2500);
