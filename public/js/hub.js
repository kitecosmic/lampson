// hub.js — la pantalla de workspaces (public/hub.html): tarjetas + el mismo Panel de workspaces que usa la UI de un
// workspace (js/workspaces.js) para crear/encender/apagar. Sin core.js: acá no hay chat.
const $ = s => document.querySelector(s);
const BASE = '', WS_SLUG = '';
function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
async function api(path, body) { const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); let data = {}; try { data = await r.json(); } catch (e) {} return { ok: r.ok, status: r.status, data }; }
function fmtWhen(ts) { if (!ts) return '—'; return new Date(ts * 1000).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function inlineConfirm(el, label, onYes) {
  const prev = el.innerHTML; el.classList.add('ask');
  el.innerHTML = `<span class="q">${esc(label)}</span> <span class="yes">sí</span> · <span class="no">no</span>`;
  const restore = () => { el.innerHTML = prev; el.classList.remove('ask'); };
  el.querySelector('.yes').onclick = (ev) => { ev.stopPropagation(); onYes(); };
  el.querySelector('.no').onclick = (ev) => { ev.stopPropagation(); restore(); };
  setTimeout(() => { if (el.classList.contains('ask')) restore(); }, 6000);
}
// tema
const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.7v2.1M12 19.2v2.1M2.7 12h2.1M19.2 12h2.1M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"/></svg>';
const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z"/></svg>';
function paintTheme() { const light = document.documentElement.getAttribute('data-theme') === 'light'; $('#theme').innerHTML = light ? MOON : SUN; }
$('#theme').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'light' ? 'dark' : 'light'); try { localStorage.setItem('lampson.theme', r.getAttribute('data-theme')); } catch (e) {} paintTheme(); };
paintTheme();
// tarjetas: «necesita tu atención» arriba, después activos, recientes y los más antiguos plegados
const OLD_DAYS = 14;
let wsData = null, teamsData = null, tasksData = null, pluginsData = null, oldOpen = false;
function escA(s) { return esc(s).replace(/"/g, '&quot;'); }
// «hace 3 h» se lee de un vistazo; la fecha exacta queda en el title
function fmtAgo(ts) {
  if (!ts) return 'sin uso todavía';
  const m = Math.floor((Date.now() / 1000 - ts) / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (m < 1) return 'usado recién'; if (m < 60) return `usado hace ${m} min`; if (h < 24) return `usado hace ${h} h`;
  if (d < 2) return 'usado ayer'; if (d < 7) return `usado hace ${d} días`; if (d < 30) return `usado hace ${Math.floor(d / 7)} sem`;
  return 'usado el ' + new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
// la carpeta del usuario como ~ (la ruta completa queda en el title)
function shortPath(p) { return String(p || '').replace(/^[a-z]:\\users\\[^\\]+/i, '~').replace(/^\/(home|Users)\/[^/]+/, '~'); }
function wsCard(w) {
  const c = document.createElement('a'); c.className = 'card ws' + (w.alive ? ' on' : ' off'); c.href = w.url;
  const t = w.teams || {};
  const tline = (t.teams || t.active || t.waiting) ? `<p class="tm" data-href="${escA(w.url)}/equipos">${t.teams ? '◇ ' + t.teams + (t.teams === 1 ? ' equipo' : ' equipos') : '◇ objetivos'}${t.active ? ' · ' + t.active + ' trabajando' : ''}${t.waiting ? ' · <b>⚑ ' + t.waiting + ' te espera' + (t.waiting === 1 ? '' : 'n') + '</b>' : ''}</p>` : '';
  c.innerHTML = `<h3><span class="st">${w.alive ? '● activo' : '○ apagado'}${w.schedules_on ? ' · ⏰ ' + w.schedules_on : ''}</span><span class="more" role="button" tabindex="0" title="encender, apagar, política de vida, quitar" aria-label="opciones de ${escA(w.name)}">⋯</span></h3><p class="nm">${esc(w.name)}</p><p class="pth" title="${escA(w.path)}">${esc(shortPath(w.path))}</p><p class="meta" title="último uso ${escA(fmtWhen(w.last_used))}">${esc(fmtAgo(w.last_used))}</p>${tline}`;
  const tm = c.querySelector('.tm');
  if (tm) tm.onclick = (e) => { e.preventDefault(); e.stopPropagation(); location.href = tm.dataset.href; };
  const more = c.querySelector('.more');
  more.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openWorkspaces(w.slug); };
  more.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') more.onclick(e); };
  // entrar = usarlo: si está apagado se enciende acá mismo (con aviso en la tarjeta) y después se abre. La ruta
  // /w/<slug> del hub también lo enciende sola, así que un link directo funciona igual; esto solo da feedback.
  if (!w.alive) c.onclick = async (e) => {
    e.preventDefault(); if (c.dataset.busy) return; c.dataset.busy = '1';
    const h = c.querySelector('.st'); h.textContent = '⟳ encendiendo…'; c.classList.add('busy');
    try { const r = await api('/api/workspaces/start', { slug: w.slug }); if (!r.ok || !r.data.ok) { h.textContent = '○ no arrancó · mirá .lampson/ws/' + w.slug + '/.lampson/web.log'; c.classList.remove('busy'); delete c.dataset.busy; return; } } catch (err) {}
    location.href = w.url;
  };
  return c;
}
function wsGroup(title, list) {
  const sec = document.createElement('section'); sec.className = 'wsgroup';
  sec.innerHTML = `<p class="ghead">${esc(title)} <span class="n">${list.length}</span></p><div class="wsgrid"></div>`;
  const grid = sec.querySelector('.wsgrid'); for (const w of list) grid.appendChild(wsCard(w));
  return sec;
}
// cuántas cosas te esperan en un proyecto: preguntas de objetivos y aprobaciones de sus agentes (/api/teams-home);
// sin ese resumen, el conteo de /api/workspaces
function waitingIn(w) {
  const tw = teamsData && teamsData.find(x => x.slug === w.slug);
  if (tw) return tw.objectives.filter(o => o.status === 'waiting').length + (tw.approvals || []).length;
  return (w.teams || {}).waiting || 0;
}
// los productos de lampson en el inicio: un mosaico de alto fijo por producto (equipos, tareas, plugins) que lleva a
// su pestaña. No crece con la cantidad de equipos o tareas, así los proyectos siguen a la vista; sin uso todavía,
// el mosaico es la invitación.
function fmtNext(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000), now = new Date(), hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), diff = Math.round((day(d) - day(now)) / 86400000);
  return diff === 0 ? 'hoy ' + hm : diff === 1 ? 'mañana ' + hm : d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + hm;
}
function tile(ic, title, main, sub, href, cta, cls) {
  return `<a class="tile${cls ? ' ' + cls : ''}" href="${escA(href)}"><p class="th"><span class="ic">${ic}</span>${esc(title)}</p><p class="tm1">${main}</p><p class="tm2">${sub}</p><p class="go">${esc(cta)} →</p></a>`;
}
function paintTiles(q) {
  const box = $('#wsTiles');
  if (q) { box.innerHTML = ''; return; }
  const out = [];
  // equipos
  if (teamsData) {
    const nT = teamsData.reduce((n, w) => n + w.teams.length, 0);
    const act = teamsData.reduce((n, w) => n + w.objectives.filter(o => o.status === 'active').length, 0);
    const wait = teamsData.reduce((n, w) => n + w.objectives.filter(o => o.status === 'waiting').length + (w.approvals || []).length, 0);
    const solo = teamsData.reduce((n, w) => n + w.objectives.filter(o => !o.team && (o.status === 'active' || o.status === 'waiting')).length, 0);
    out.push(nT || solo
      ? tile('◇', 'Equipos', nT ? `${nT} equipo${nT === 1 ? '' : 's'}` : `${solo} agente${solo === 1 ? '' : 's'} con objetivo`, wait ? `<b class="warn">⚑ ${wait} te espera${wait === 1 ? '' : 'n'}</b>${act ? ' · ' + act + ' trabajando' : ''}` : act ? `${act} trabajando` : 'nada pendiente', '/equipos', 'ver equipos')
      : tile('◇', 'Equipos', 'Agentes que trabajan solos', 'Armá un equipo con roles, dale un objetivo y avanza mientras hacés otra cosa.', '/equipos?new=1', 'armar un equipo', 'invite'));
  }
  // tareas programadas
  if (tasksData) {
    const all = tasksData.flatMap(w => w.tasks.map(t => ({ ...t, ws: w })));
    const on = all.filter(t => t.enabled), failed = on.filter(t => String(t.last_status || '').startsWith('error'));
    const next = on.filter(t => t.next_run).sort((a, b) => a.next_run - b.next_run)[0];
    const off = all.length - on.length, pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    out.push(!all.length
      ? tile('◷', 'Tareas', 'El agente trabaja a su hora', '«Todos los días a las 9, corré los tests y avisame si algo se rompió.»', '/tareas', 'ver cómo', 'invite')
      : !on.length
        ? tile('◷', 'Tareas', `${pl(all.length, 'tarea')}, ${all.length === 1 ? 'apagada' : 'apagadas'}`, 'ninguna va a correr hasta que la enciendas', '/tareas', 'ver tareas')
        : tile('◷', 'Tareas', `${pl(on.length, 'programada')}${off ? ` <span class="dim">· ${pl(off, 'apagada')}</span>` : ''}`, failed.length ? `<b class="warn">✕ ${failed.length} falló en la última corrida</b>` : next ? `próxima: ${esc(fmtNext(next.next_run))} · ${esc(next.ws.name)}` : 'ninguna por correr', '/tareas', 'ver tareas'));
  }
  // plugins: lo instalado y dónde se usa (encender es por proyecto, dentro del proyecto)
  if (pluginsData) {
    const names = new Set(pluginsData.global.filter(p => !p.example).map(p => p.name)); pluginsData.workspaces.forEach(w => w.local.filter(p => !p.example).forEach(p => names.add(p.name)));
    const used = pluginsData.workspaces.filter(w => w.enabled.some(n => names.has(n))).length;
    const shown = [...names], list = shown.slice(0, 3).join(', ') + (shown.length > 3 ? ` y ${shown.length - 3} más` : '');
    out.push(used
      ? tile('⧉', 'Plugins', `${names.size} instalado${names.size === 1 ? '' : 's'}`, `encendidos en ${used} de ${pluginsData.workspaces.length} proyectos`, '/plugins', 'ver plugins')
      : tile('⧉', 'Plugins', 'Sumale cosas a tus agentes', shown.length ? `Conectá ${esc(list)} a un proyecto.` : 'Canales, herramientas y datos para tus agentes.', '/plugins', 'ver plugins', 'invite'));
  }
  box.innerHTML = out.join('');
}
function paintHome() {
  const attn = $('#wsAttn'), box = $('#wsGroups');
  if (!wsData) { attn.innerHTML = ''; $('#wsTiles').innerHTML = ''; box.innerHTML = '<p class="none">el hub no responde</p>'; return; }
  const all = (wsData.workspaces || []).slice().sort((a, b) => (b.last_used || 0) - (a.last_used || 0));
  // lo que te espera, de todos los proyectos (la búsqueda no lo esconde); el total va también en la pestaña equipos
  const waiting = all.map(w => ({ w, n: waitingIn(w) })).filter(x => x.n);
  attn.innerHTML = waiting.length ? `<p class="ghead warn">Necesita tu atención</p>` + waiting.map(({ w, n }) => `<a class="attn" href="/equipos"><span class="ic">⚑</span><span class="tx"><b>${esc(w.name)}</b> · ${n === 1 ? 'una cosa te espera' : n + ' cosas te esperan'}</span><span class="go">responder →</span></a>`).join('') : '';
  const q = ($('#wsSearch').value || '').trim().toLowerCase();
  paintTiles(q);
  const list = q ? all.filter(w => (w.name + ' ' + w.path).toLowerCase().includes(q)) : all;
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = q ? `<p class="none">ningún proyecto coincide con «${esc(q)}»</p>` : '<p class="none">Todavía no hay proyectos: creá uno con «+ nuevo proyecto».</p>'; return; }
  const cut = Date.now() / 1000 - OLD_DAYS * 86400;
  const active = list.filter(w => w.alive), recent = list.filter(w => !w.alive && (w.last_used || 0) >= cut), old = list.filter(w => !w.alive && (w.last_used || 0) < cut);
  if (active.length) box.appendChild(wsGroup('Activos', active));
  if (recent.length) box.appendChild(wsGroup('Recientes', recent));
  if (old.length) {
    const det = document.createElement('details'); det.className = 'wsgroup old'; det.open = oldOpen || !!q;
    det.innerHTML = `<summary class="ghead">Más antiguos <span class="n">${old.length}</span></summary><div class="wsgrid"></div>`;
    const grid = det.querySelector('.wsgrid'); for (const w of old) grid.appendChild(wsCard(w));
    det.ontoggle = () => { if (!q) oldOpen = det.open; };
    box.appendChild(det);
  }
}
async function paintGrid() {
  const get = (u) => fetch(BASE + u).then(r => r.ok ? r.json() : null).catch(() => null);
  const [ws, th, ta, pl] = await Promise.all([get('/api/workspaces'), get('/api/teams-home'), get('/api/tasks-home'), get('/api/plugins-home')]);
  wsData = ws; teamsData = th ? (th.workspaces || []) : null; tasksData = ta ? (ta.workspaces || []) : null; pluginsData = pl && pl.global ? pl : null;
  paintHome();
}
$('#wsSearch').oninput = paintHome;
$('#wsNew').onclick = () => openWorkspaces('__new');
$('#wsManage').onclick = () => openWorkspaces();
document.querySelectorAll('.cli .copy').forEach(el => {
  const go = async () => { try { await navigator.clipboard.writeText(el.dataset.copy); el.textContent = 'copiado'; } catch (e) { el.textContent = 'no se pudo copiar'; } setTimeout(() => { el.textContent = 'copiar'; }, 1500); };
  el.onclick = go; el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
});
paintGrid();
setInterval(paintGrid, 10000);
