// tasks-home.js — tareas programadas de todos los proyectos (public/tasks-home.html, servido por el hub en /tareas).
// Lee GET /api/tasks-home (el schedules.json de cada workspace, también de los apagados) cada 5 s. Encender, apagar y
// correr van al workspace por el proxy del hub (/w/<slug>/api/schedules/…); si está apagado, primero se enciende.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let data = [], busy = 0;

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let d = {}; try { d = await r.json(); } catch (e) {}
  if (r.status === 401) location.href = '/login';
  return { ok: r.ok, data: d };
}
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('lampson.theme', t); } catch (e) {} $('#theme').textContent = t === 'dark' ? '☀' : '☾'; }
setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
$('#theme').onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

// el plan en palabras (lo mismo que describe_plan de lib/schedule.syn)
const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const pad2 = (n) => String(n).padStart(2, '0');
function describePlan(p, raw) {
  if (!p) return raw || '';
  const hhmm = pad2(p.hh) + ':' + pad2(p.mm);
  if (p.kind === 'once') {
    if (p.delay > 0) return 'una vez, en ' + (p.delay >= 3600 ? Math.floor(p.delay / 3600) + ' h' : Math.floor(p.delay / 60) + ' min');
    if (p.rel) return 'una vez, ' + (p.rel === 'today' ? 'hoy' : 'mañana') + ' a las ' + hhmm;
    return 'una vez, el ' + p.date + ' a las ' + hhmm;
  }
  if (p.kind === 'every') {
    const s = p.seconds;
    if (s >= 86400 && s % 86400 === 0) return 'cada ' + (s / 86400) + (s === 86400 ? ' día' : ' días');
    if (s >= 3600 && s % 3600 === 0) return 'cada ' + (s / 3600) + ' h';
    return 'cada ' + Math.floor(s / 60) + ' min';
  }
  if (p.kind === 'daily') return 'todos los días a las ' + hhmm;
  return (p.days || []).map((d) => DAY_NAMES[d - 1]).join(', ') + ' a las ' + hhmm;
}
function describeAction(a) {
  if (!a) return '';
  if (a.type === 'plugin' || a.type === 'lamp') return 'plugin ' + (a.plugin || a.lamp) + '.' + a.tool;
  if (a.type === 'bash') return '$ ' + a.command;
  return (a.agent ? 'agente ' + a.agent + ': ' : 'agente: ') + String(a.prompt || '').replace(/\s+/g, ' ');
}
function fmtTs(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000), now = new Date(), hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return 'hoy ' + hm; if (diff === 1) return 'mañana ' + hm; if (diff === -1) return 'ayer ' + hm;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hm;
}
const failed = (t) => String(t.last_status || '').startsWith('error');

function render() {
  const withTasks = data.filter((w) => w.tasks.length), rest = data.filter((w) => !w.tasks.length);
  if (!withTasks.length) {
    $('#list').innerHTML = `<div class="vempty"><p><b>Todavía no hay tareas programadas.</b></p><p>Abrí un proyecto y pedíselo al agente, o programala vos:</p><div class="vpick">${data.map((w) => `<a href="/w/${esc(w.slug)}#tareas=nueva">${esc(w.name)}</a>`).join('')}</div></div>`;
    return;
  }
  // primero lo que falló, después lo encendido por próxima corrida, al final lo apagado
  const order = (t) => (failed(t) && t.enabled ? 0 : t.running ? 1 : t.enabled ? 2 : 3);
  $('#list').innerHTML = withTasks.map((w) => `
    <section class="pblock">
      <div class="projhead"><a href="/w/${esc(w.slug)}#tareas" class="pname">${esc(w.name)}</a><span class="ppath">${esc(w.path)}</span>
        <span class="spacer"></span><span class="dot${w.alive ? ' on' : ''}" title="${w.alive ? 'activo' : 'apagado'}"></span><a class="open" href="/w/${esc(w.slug)}#tareas=nueva">+ tarea</a><a class="open" href="/w/${esc(w.slug)}#tareas">abrir →</a></div>
      ${w.tasks.slice().sort((a, b) => order(a) - order(b) || (a.next_run || 9e12) - (b.next_run || 9e12)).map((t) => `
      <div class="taskrow${t.enabled ? '' : ' off'}">
        <label class="sw" title="${t.enabled ? 'apagarla' : 'encenderla'}"><input type="checkbox" role="switch" data-toggle="${esc(w.slug)}|${esc(t.id)}" ${t.enabled ? 'checked' : ''}><span class="swt" aria-hidden="true"></span><span class="swl">${t.enabled ? 'encendida' : 'apagada'}</span></label>
        <a class="tmain" href="/w/${esc(w.slug)}#tareas=${encodeURIComponent(t.id)}"><b>${esc(t.name)}</b><span class="tplan">${esc(describePlan(t.plan, t.when))}</span><span class="tact">${esc(describeAction(t.action))}</span></a>
        <div class="tstate">
          ${t.running ? '<span class="st active">corriendo</span>' : failed(t) ? '<span class="st waiting">falló</span>' : t.last_status === 'ok' ? '<span class="st done">ok</span>' : ''}
          <span class="twhen">${t.enabled && t.next_run ? 'próxima ' + esc(fmtTs(t.next_run)) : ''}${t.enabled && t.next_run && t.last_run ? '<br>' : ''}${t.last_run ? 'última ' + esc(fmtTs(t.last_run)) : ''}</span>
          ${failed(t) && t.last_summary ? `<span class="terr" title="${esc(t.last_summary)}">${esc(t.last_summary)}</span>` : ''}
        </div>
        <button data-run="${esc(w.slug)}|${esc(t.id)}" title="correrla ahora"${t.running ? ' disabled' : ''}>▶ correr</button>
      </div>`).join('')}
    </section>`).join('') +
    (rest.length ? `<p class="others">Sin tareas: ${rest.map((w) => `<a href="/w/${esc(w.slug)}#tareas=nueva">${esc(w.name)}</a>`).join(' · ')}</p>` : '');
  document.querySelectorAll('[data-toggle]').forEach((i) => (i.onchange = () => act(i.dataset.toggle, 'toggle', { enabled: i.checked }, i)));
  document.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => { b.disabled = true; b.textContent = '⟳ arrancando…'; act(b.dataset.run, 'run', {}, b); }));
}

// encender/apagar/correr: el workspace atiende su API solo si está vivo; apagado, se enciende primero
async function act(key, what, extra, el) {
  const [slug, id] = key.split('|'); const w = data.find((x) => x.slug === slug);
  busy++;
  try {
    if (w && !w.alive) { const s = await post('/api/workspaces/start', { slug }); if (!s.ok || !s.data.ok) { el.title = 'el proyecto no arrancó'; return; } }
    await post(`/w/${slug}/api/schedules/${what}`, { id, ...extra });
  } finally { busy--; setTimeout(refresh, what === 'run' ? 1500 : 300); }
}

async function refresh() {
  try {
    const r = await fetch('/api/tasks-home');
    if (r.status === 401) { location.href = '/login'; return; }
    data = (await r.json()).workspaces || [];
    // no repintar mientras se espera la respuesta de un clic (el botón queda en «arrancando…»)
    if (!busy) render();
    $('#live').classList.remove('off');
  } catch (e) { $('#live').classList.add('off'); }
}
refresh();
setInterval(refresh, 5000);
