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
let wsData = null, teamsData = null, oldOpen = false;
const TSTATUS = { active: 'trabajando', waiting: 'te espera', done: 'hecho', failed: 'falló', cancelled: 'cancelado', paused: 'sin presupuesto' };
const TRANK = { waiting: 0, active: 1, paused: 2 };
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
// equipos en el inicio: una fila por equipo (con su objetivo más urgente) y por agente solo con un objetivo en curso;
// sin ninguno, la invitación a armar el primero
const TEAM_ROWS = 5;
function paintTeams(q) {
  const box = $('#wsTeams');
  if (!teamsData || q) { box.innerHTML = ''; return; }
  const rows = [];
  for (const w of teamsData) {
    const byUrgency = (list) => list.slice().sort((a, b) => ((TRANK[a.status] ?? 9) - (TRANK[b.status] ?? 9)) || ((b.updated_at || 0) - (a.updated_at || 0)));
    for (const t of w.teams) {
      const o = byUrgency(w.objectives.filter(x => x.team === t.id))[0];
      rows.push({ w, name: t.id, sub: `${t.members} agente${t.members === 1 ? '' : 's'} · lo lidera ${t.lead}`, o, href: o ? `/w/${w.slug}/equipos?o=${o.id}` : `/w/${w.slug}/equipos?tab=teams` });
    }
    for (const o of w.objectives.filter(x => !x.team && (x.status === 'active' || x.status === 'waiting')))
      rows.push({ w, name: o.agent, sub: 'agente solo', o, href: `/w/${w.slug}/equipos?o=${o.id}` });
  }
  if (!rows.length) {
    box.innerHTML = `<div class="tinvite"><span class="ic">◇</span><div class="tx"><b>Equipos de agentes que trabajan solos</b><p>Armá un equipo con roles —por ejemplo un CEO, un CTO y un CMO—, dale un objetivo y avanza mientras hacés otra cosa. Te consulta cuando hace falta una decisión tuya.</p></div><a class="go" href="/equipos?new=1">armar un equipo →</a></div>`;
    return;
  }
  rows.sort((a, b) => ((TRANK[a.o && a.o.status] ?? 9) - (TRANK[b.o && b.o.status] ?? 9)) || (((b.o && b.o.updated_at) || 0) - ((a.o && a.o.updated_at) || 0)));
  const nTeams = teamsData.reduce((n, w) => n + w.teams.length, 0);
  box.innerHTML = `<div class="ghead gbar"><span>equipos <span class="n">${nTeams}</span></span><span class="spacer"></span><a href="/equipos?new=1">+ equipo</a><a href="/equipos">${rows.length > TEAM_ROWS ? 'ver los ' + rows.length + ' →' : 'ver todos →'}</a></div>` +
    rows.slice(0, TEAM_ROWS).map(r => `<a class="trow" href="${escA(r.href)}"><span class="ic">◇</span><span class="tx"><b>${esc(r.name)}</b><span class="where">${esc(r.w.name)} · ${esc(r.sub)}</span></span><span class="obj">${r.o ? `<span class="tst tst-${escA(r.o.status)}">${esc(TSTATUS[r.o.status] || r.o.status)}</span> <span class="ref">${esc(r.o.ref)}</span> ${esc(r.o.text)}` : '<span class="tst">sin objetivo</span> dale uno'}</span></a>`).join('');
}
function paintHome() {
  const attn = $('#wsAttn'), box = $('#wsGroups');
  if (!wsData) { attn.innerHTML = ''; $('#wsTeams').innerHTML = ''; box.innerHTML = '<p class="none">el hub no responde</p>'; return; }
  const all = (wsData.workspaces || []).slice().sort((a, b) => (b.last_used || 0) - (a.last_used || 0));
  // lo que te espera, de todos los proyectos (la búsqueda no lo esconde); el total va también en la pestaña Equipos
  const waiting = all.map(w => ({ w, n: waitingIn(w) })).filter(x => x.n);
  attn.innerHTML = waiting.length ? `<p class="ghead warn">necesita tu atención</p>` + waiting.map(({ w, n }) => `<a class="attn" href="/equipos"><span class="ic">⚑</span><span class="tx"><b>${esc(w.name)}</b> · ${n === 1 ? 'una cosa te espera' : n + ' cosas te esperan'}</span><span class="go">responder →</span></a>`).join('') : '';
  const total = waiting.reduce((s, x) => s + x.n, 0), badge = $('#teamsBadge');
  badge.hidden = !total; badge.textContent = total ? '⚑ ' + total : '';
  const q = ($('#wsSearch').value || '').trim().toLowerCase();
  paintTeams(q);
  const list = q ? all.filter(w => (w.name + ' ' + w.path).toLowerCase().includes(q)) : all;
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = q ? `<p class="none">ningún proyecto coincide con «${esc(q)}»</p>` : '<p class="none">Todavía no hay proyectos: creá uno con «+ nuevo proyecto».</p>'; return; }
  const cut = Date.now() / 1000 - OLD_DAYS * 86400;
  const active = list.filter(w => w.alive), recent = list.filter(w => !w.alive && (w.last_used || 0) >= cut), old = list.filter(w => !w.alive && (w.last_used || 0) < cut);
  if (active.length) box.appendChild(wsGroup('activos', active));
  if (recent.length) box.appendChild(wsGroup('recientes', recent));
  if (old.length) {
    const det = document.createElement('details'); det.className = 'wsgroup old'; det.open = oldOpen || !!q;
    det.innerHTML = `<summary class="ghead">más antiguos <span class="n">${old.length}</span></summary><div class="wsgrid"></div>`;
    const grid = det.querySelector('.wsgrid'); for (const w of old) grid.appendChild(wsCard(w));
    det.ontoggle = () => { if (!q) oldOpen = det.open; };
    box.appendChild(det);
  }
}
async function paintGrid() {
  const [ws, th] = await Promise.all([
    fetch(BASE + '/api/workspaces').then(r => r.json()).catch(() => null),
    fetch(BASE + '/api/teams-home').then(r => r.ok ? r.json() : null).catch(() => null)]);
  wsData = ws; teamsData = th ? (th.workspaces || []) : null;
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
