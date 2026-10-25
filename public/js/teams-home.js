// teams-home.js — equipos y objetivos de todos los proyectos (public/teams-home.html, servido por el hub en /equipos).
// Lee GET /api/teams-home (el resumen que escribe cada workspace) cada 4 s. Responder, aprobar o denegar va directo al
// workspace por el proxy del hub: /w/<slug>/api/approve y /w/<slug>/api/objectives/<id>/reply.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATUS = { active: 'trabajando', waiting: 'te espera', done: 'hecho', failed: 'falló', cancelled: 'cancelado', paused: 'sin presupuesto' };
const short = (slug) => slug.replace(/-[0-9a-f]{8}$/, '');
// la carpeta del usuario como ~ (igual que en el inicio): el nombre de usuario no aparece al compartir pantalla
const shortPath = (p) => String(p || '').replace(/^[a-z]:[\\/]users[\\/][^\\/]+/i, '~').replace(/^\/(home|Users)\/[^/]+/, '~');
// la página de un objetivo en su proyecto: dentro de su equipo, o la de un agente solo
const objUrl = (w, o) => '/w/' + esc(w.slug) + (o.team ? '/equipos/' + encodeURIComponent(o.team) + '/objetivos/' : '/objetivos/') + o.id;
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

// lo que te espera, de todos los proyectos: la bandeja ⚑ de la cabecera (js/inbox.js)

// ---------- una tarjeta por equipo: quiénes son, qué están haciendo ahora y qué podés hacer vos ----------
// Revelación progresiva: el objetivo en curso en una oración (el texto completo está en la pantalla del equipo), los
// terminados plegados. Lo que espera una respuesta está en la bandeja ⚑ (js/inbox.js).
const OPEN = ['waiting', 'active', 'paused'];
const doneOpen = new Set();
function firstSentence(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim(), m = s.match(/^(.{20,}?[.:;!?])(\s|$)/);
  const out = m ? m[1] : s;
  return out.length > 150 ? out.slice(0, 147).replace(/\s+\S*$/, '') + '…' : out;
}
// texto a dos líneas como máximo, así las tarjetas vecinas quedan alineadas; si no entra (o hay más que la primera
// oración) dice «ver más» y el texto completo aparece en el lugar al pasar el mouse o con el foco
function clip(shown, full) {
  const all = String(full ?? shown ?? '').replace(/\s+/g, ' ').trim();
  return `<span class="clip"><span class="ct">${esc(shown)}</span><span class="cmore" aria-hidden="true">ver más</span><span class="cfull" role="tooltip">${esc(all.length > 600 ? all.slice(0, 597).replace(/\s+\S*$/, '') + '…' : all)}</span></span>`;
}
function markClipped(root) {
  root.querySelectorAll('.clip').forEach((c) => {
    const t = c.querySelector('.ct'), cut = t.scrollHeight > t.clientHeight + 1 || t.textContent !== c.querySelector('.cfull').textContent;
    c.classList.toggle('cut', cut);
    if (!c.closest('a')) c.tabIndex = cut ? 0 : -1;
  });
}
function objLine(w, o) {
  return `<a class="oline" href="${objUrl(w, o)}"><span class="st ${o.status}">${STATUS[o.status] || o.status}</span><span class="otext">${clip(firstSentence(o.text), o.text)}</span></a>`;
}
function teamCard(w, t) {
  const mine = w.objectives.filter((o) => o.team === t.id);
  const now = mine.filter((o) => OPEN.includes(o.status)).sort((a, b) => OPEN.indexOf(a.status) - OPEN.indexOf(b.status)), done = mine.filter((o) => !OPEN.includes(o.status));
  const roles = t.roles && t.roles.length ? t.roles : null, key = w.slug + ':' + t.id;
  return `<article class="tcard">
    <div class="thead"><h2>${esc(t.name || t.id)}</h2><a class="tproj" href="/w/${esc(w.slug)}/equipos" title="${esc(shortPath(w.path))}"><span class="dot${w.alive ? ' on' : ''}"></span>${esc(w.name || short(w.slug))}</a></div>
    <p class="tdesc">${t.description ? clip(t.description) : ''}</p>
    <div class="roles">${roles ? roles.map((r, i) => `<span class="role${i === 0 ? ' lead' : ''}"${i === 0 ? ' title="lo lidera"' : ''}>${esc(r)}</span>`).join('') : `<span class="role">${t.members} agente${t.members === 1 ? '' : 's'}</span><span class="role lead">lo lidera ${esc(t.lead)}</span>`}</div>
    <div class="tnow">${now.length ? now.map((o) => objLine(w, o) + (o.progress && o.status === 'active' ? `<p class="oprog">${clip(firstSentence(o.progress), o.progress)}</p>` : '')).join('') : '<p class="tidle">Nada en curso. Dale un objetivo y el equipo se reparte el trabajo.</p>'}</div>
    <div class="tacts"><a class="btn${now.length ? '' : ' primary'}" href="/w/${esc(w.slug)}/equipos/${encodeURIComponent(t.id)}/objetivos/nuevo">Darle un objetivo</a><a class="lnk" href="/w/${esc(w.slug)}/equipos/${encodeURIComponent(t.id)}">Ver el equipo</a></div>
    ${done.length ? `<details class="tdone" data-key="${esc(key)}"${doneOpen.has(key) ? ' open' : ''}><summary>${done.length} objetivo${done.length === 1 ? '' : 's'} terminado${done.length === 1 ? '' : 's'}</summary>${done.map((o) => objLine(w, o)).join('')}</details>` : '<div class="tdone"></div>'}
  </article>`;
}
let lastProjects = '';
function renderProjects() {
  const cards = data.flatMap((w) => w.teams.map((t) => teamCard(w, t)));
  // objetivos de un agente solo (sin equipo) que siguen abiertos
  const solo = data.flatMap((w) => w.objectives.filter((o) => !o.team && OPEN.includes(o.status)).map((o) => ({ w, o })));
  const html = (cards.length ? `<div class="tgrid">${cards.join('')}</div>`
      : `<div class="tinvite"><h2>Armá tu primer equipo</h2><p>Un equipo son agentes con roles —por ejemplo un CEO, un CTO y un desarrollador— que trabajan solos hacia un objetivo, se coordinan entre ellos y te consultan antes de lo irreversible.</p><button class="primary" data-new>+ equipo</button></div>`) +
    (solo.length ? `<h3 class="solohead">Agentes con un objetivo</h3><div class="solo">${solo.map(({ w, o }) => `<div class="srow"><span class="swho">${esc(o.agent)} <span>en ${esc(w.name || short(w.slug))}</span></span>${objLine(w, o)}</div>`).join('')}</div>` : '');
  // sin cambios no se rehace: si no, cada 4 s se cerraba el texto completo que estabas leyendo
  if (html !== lastProjects) { $('#projects').innerHTML = html; lastProjects = html; markClipped($('#projects')); }
  document.querySelectorAll('details.tdone').forEach((d) => (d.ontoggle = () => { if (d.open) doneOpen.add(d.dataset.key); else doneOpen.delete(d.dataset.key); markClipped(d); }));
  const nb = document.querySelector('[data-new]'); if (nb) nb.onclick = () => $('#newTeam').onclick();
  // el selector del formulario se rehace cada 4 s: sin esto perdía lo que la persona había elegido
  const ws = $('#nWs'), cur = ws.value;
  ws.innerHTML = data.map((w) => `<option value="${esc(w.slug)}">${esc(w.name || short(w.slug))} — ${esc(shortPath(w.path))}</option>`).join('');
  if (cur) ws.value = cur;
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
    renderProjects();
    $('#live').classList.remove('off');
  } catch (e) { $('#live').classList.add('off'); }
}
refresh();
setInterval(refresh, 4000);
// al cambiar el ancho, un texto puede pasar a entrar (o dejar de entrar) en dos líneas
let clipRaf = 0;
addEventListener('resize', () => { cancelAnimationFrame(clipRaf); clipRaf = requestAnimationFrame(() => markClipped($('#projects'))); });
