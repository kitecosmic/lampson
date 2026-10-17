// teams-home.js — equipos y objetivos de todos los proyectos (public/teams-home.html, servido por el hub en /equipos).
// Lee GET /api/teams-home (el resumen que escribe cada workspace) cada 4 s. Responder, aprobar o denegar va directo al
// workspace por el proxy del hub: /w/<slug>/api/approve y /w/<slug>/api/objectives/<id>/reply.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATUS = { active: 'trabajando', waiting: 'te espera', done: 'hecho', failed: 'falló', cancelled: 'cancelado', paused: 'sin presupuesto' };
const short = (slug) => slug.replace(/-[0-9a-f]{8}$/, '');
let data = [];

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let d = {}; try { d = await r.json(); } catch (e) {}
  if (r.status === 401) location.href = '/login';
  return { ok: r.ok, data: d };
}
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('lampson.theme', t); } catch (e) {} $('#theme').textContent = t === 'dark' ? '☀' : '☾'; }
setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
$('#theme').onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

// ---------- lo que te espera, de todos los proyectos ----------
function renderAttention() {
  const box = $('#attention');
  const keep = {}; box.querySelectorAll('input[data-k]').forEach((i) => (keep[i.dataset.k] = i.value));
  let html = '';
  for (const w of data) {
    for (const o of w.objectives.filter((o) => o.status === 'waiting')) {
      const ap = o.question_kind === 'approval'; const k = w.slug + ':' + o.id;
      html += `<div class="ask ${ap ? 'approval' : ''}"><span class="who">${esc(short(w.slug))} · ${esc(o.agent)} ${ap ? 'pide aprobación' : 'pregunta'}</span>
        <div class="q"><a class="ref" href="/w/${esc(w.slug)}/equipos?o=${o.id}">${esc(o.ref)}</a> ${esc(o.question)}</div>
        <div class="acts">${ap ? `<input data-k="${esc(k)}" placeholder="nota (opcional)"><button class="ok" data-ok="${esc(k)}">Aprobar</button><button class="no" data-no="${esc(k)}">Denegar</button>`
          : `<input data-k="${esc(k)}" placeholder="tu respuesta"><button class="primary" data-ans="${esc(k)}">Responder</button>`}</div></div>`;
    }
    for (const a of w.approvals) {
      const who = (String(a.why || '').match(/agent (\S+)/) || [])[1] || 'un agente';
      html += `<div class="ask approval"><span class="who">${esc(short(w.slug))} · ${esc(who)} pide aprobación</span><div class="q"><code>${esc(a.message)}</code><br><span class="ref">${esc(String(a.why || '').replace(/ · agent \S+$/, ''))}</span></div>
        <div class="acts"><button class="ok" data-qok="${esc(w.slug)}|${esc(a.id)}">Aprobar</button><button class="no" data-qno="${esc(w.slug)}|${esc(a.id)}">Denegar</button></div></div>`;
    }
  }
  box.hidden = html === '';
  box.innerHTML = html;
  // el mismo contador que la pestaña muestra en el inicio
  const total = data.reduce((n, w) => n + w.objectives.filter((o) => o.status === 'waiting').length + w.approvals.length, 0);
  $('#teamsBadge').hidden = !total; $('#teamsBadge').textContent = total ? '⚑ ' + total : '';
  box.querySelectorAll('input[data-k]').forEach((i) => { if (keep[i.dataset.k]) i.value = keep[i.dataset.k]; });
  const note = (k) => (box.querySelector(`input[data-k="${k}"]`) || {}).value || '';
  const reply = async (k, text, approved) => { const [slug, id] = k.split(':'); await post(`/w/${slug}/api/objectives/${id}/reply`, { text, approved }); refresh(); };
  box.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => reply(b.dataset.ok, note(b.dataset.ok), true)));
  box.querySelectorAll('[data-no]').forEach((b) => (b.onclick = () => reply(b.dataset.no, note(b.dataset.no), false)));
  box.querySelectorAll('[data-ans]').forEach((b) => (b.onclick = () => { const t = note(b.dataset.ans); if (t.trim()) reply(b.dataset.ans, t, false); }));
  const q = async (v, decision) => { const [slug, id] = v.split('|'); await post(`/w/${slug}/api/approve`, { id, decision }); refresh(); };
  box.querySelectorAll('[data-qok]').forEach((b) => (b.onclick = () => q(b.dataset.qok, true)));
  box.querySelectorAll('[data-qno]').forEach((b) => (b.onclick = () => q(b.dataset.qno, false)));
}

// ---------- cada proyecto: sus equipos y sus objetivos ----------
function renderProjects() {
  const withStuff = data.filter((w) => w.teams.length || w.objectives.length);
  const rest = data.filter((w) => !w.teams.length && !w.objectives.length);
  $('#projects').innerHTML = (withStuff.length ? withStuff.map((w) => `
    <section class="pblock">
      <div class="projhead"><a href="/w/${esc(w.slug)}/equipos" class="pname">${esc(short(w.slug))}</a><span class="ppath">${esc(w.path)}</span>
        <span class="spacer"></span>${w.alive ? '<span class="dot on"></span>' : '<span class="dot"></span>'}<a class="open" href="/w/${esc(w.slug)}/equipos">abrir →</a></div>
      <div class="pcols">
        <div><h6>Equipos</h6>${w.teams.length ? w.teams.map((t) => `<a class="trow" href="/w/${esc(w.slug)}/equipos?tab=teams"><b>${esc(t.id)}</b> · ${t.members} agentes · lo lidera ${esc(t.lead)}${t.description ? `<span>${esc(t.description)}</span>` : ''}</a>`).join('') : '<p class="none">sin equipos</p>'}</div>
        <div><h6>Objetivos</h6>${w.objectives.length ? w.objectives.map((o) => `<a class="orow" href="/w/${esc(w.slug)}/equipos?o=${o.id}"><span class="st ${o.status}">${STATUS[o.status] || o.status}</span> <b>${esc(o.ref)}</b> ${o.team ? 'equipo ' + esc(o.team) : esc(o.agent)} — ${esc(o.text)}${o.progress && o.status === 'active' ? `<span>${esc(o.progress)}</span>` : ''}</a>`).join('') : '<p class="none">sin objetivos</p>'}</div>
      </div>
    </section>`).join('') : `<div class="empty">Todavía no hay equipos ni objetivos. Tocá <b>+ equipo</b> para armar el primero, o abrí un proyecto y dale un objetivo a uno de sus agentes.</div>`) +
    (rest.length ? `<p class="others">Otros proyectos: ${rest.map((w) => `<a href="/w/${esc(w.slug)}/equipos">${esc(short(w.slug))}</a>`).join(' · ')}</p>` : '');
  $('#nWs').innerHTML = data.map((w) => `<option value="${esc(w.slug)}">${esc(short(w.slug))} — ${esc(w.path)}</option>`).join('');
}

// ---------- + equipo ----------
$('#newTeam').onclick = () => { $('#newBox').hidden = false; $('#nName').focus(); };
// /equipos?new=1 (el «+ equipo» del inicio) abre el formulario de una
if (new URLSearchParams(location.search).has('new')) $('#newTeam').onclick();
$('#nCancel').onclick = () => ($('#newBox').hidden = true);
$('#nName').onfocus = () => (document.querySelector('input[name=where][value=new]').checked = true);
$('#nWs').onfocus = () => (document.querySelector('input[name=where][value=ws]').checked = true);
$('#nGo').onclick = async () => {
  const where = document.querySelector('input[name=where]:checked').value;
  const body = where === 'ws' ? { slug: $('#nWs').value } : { name: $('#nName').value.trim().toLowerCase() };
  if (where === 'new' && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(body.name)) { $('#nErr').textContent = 'Un nombre corto, en minúsculas (por ejemplo «ventas»).'; return; }
  $('#nGo').disabled = true; $('#nErr').textContent = '';
  const r = await post('/api/teams-home/new', body);
  $('#nGo').disabled = false;
  if (!r.ok) { $('#nErr').textContent = r.data.error || 'no se pudo crear'; return; }
  location.href = r.data.url;
};

async function refresh() {
  try {
    const r = await fetch('/api/teams-home');
    if (r.status === 401) { location.href = '/login'; return; }
    data = (await r.json()).workspaces || [];
    renderAttention(); renderProjects();
    $('#live').classList.remove('off');
  } catch (e) { $('#live').classList.add('off'); }
}
refresh();
setInterval(refresh, 4000);
