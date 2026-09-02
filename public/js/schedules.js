// schedules.js — tareas programadas (lib/schedule.syn): sección del panel lateral + vista browse del Panel
// (tareas a la izquierda; a la derecha: qué hace, corridas, log, traza en vivo mientras corre, ▶ / ⏻ / quitar;
// «+ programar» es una fila más cuyo detalle es el formulario). Corren en cualquier lampson abierto (web o
// terminal, tick cada 30 s) o con `lampson --daemon start` con todo cerrado.
let schedData = [], schedPlugins = [], schedTick = 30, schedMountOk = true, schedLiveTimer = null;
async function fetchSched() {
  let r; try { r = await (await fetch(BASE + '/api/schedules')).json(); } catch (e) { return schedData; }
  schedData = r.tasks || []; schedPlugins = r.plugins || []; schedTick = r.tick || 30; schedMountOk = r.mount_ok !== false;
  return schedData;
}
async function loadSched() {
  await fetchSched();
  const box = $('#schedBox'); box.innerHTML = '';
  const on = schedData.filter(t => t.enabled).length, running = schedData.filter(t => t.running).length;
  $('#schedCount').textContent = schedData.length ? (running ? `${running} ● · ${schedData.length}` : `${on} · ${schedData.length}`) : ''; autoSec('sched', running > 0);
  const dm = document.createElement('div'); dm.className = 'daemon' + (schedMountOk ? '' : ' off');
  dm.textContent = schedMountOk ? `corren solas mientras esta web esté abierta · tick cada ${schedTick} s` : '⚠ ./workspace apunta a otro proyecto: tareas en pausa · lampson --daemon restart desde esta carpeta';
  dm.title = 'las tareas programadas corren en este proceso (web o terminal). Para que corran con todo cerrado: lampson --daemon start';
  box.appendChild(dm);
  if (!schedData.length) { const e = document.createElement('div'); e.className = 'p none'; e.style.cursor = 'default'; e.textContent = 'ninguna'; box.appendChild(e); }
  for (const t of schedData) {
    const d = document.createElement('div'); d.className = 'p sched';
    const st = t.running ? 'busy' : (t.enabled ? (t.last_status && t.last_status !== 'ok' ? 'bad' : 'on') : '');
    d.title = `${t.action_text}\npermisos: ${t.permission}` + (t.last_run ? `\núltima: ${t.last_local} · ${t.last_status}: ${t.last_summary}` : '');
    d.innerHTML = `<span class="st ${st}"></span><span class="nm">${esc(t.name)}</span><span class="cm">${esc(t.plan)}</span>`
      + `<span class="sub">${t.running ? 'corriendo…' : (t.enabled ? 'próxima ' + esc(fmtWhen(t.next_run)) : 'apagada')}${t.last_run ? ' · última ' + esc(t.last_status) : ''} · ${esc(t.action.type)} · ${esc(t.permission)}</span>`;
    d.onclick = () => openSched(t.id);
    box.appendChild(d);
  }
  const addRow = document.createElement('div'); addRow.className = 'p'; addRow.innerHTML = `<span class="nm" style="color:var(--accent)">+ programar una tarea…</span>`;
  addRow.title = 'un plugin, un comando o el agente con instrucciones · también se lo podés pedir al agente en el chat';
  addRow.onclick = () => openSched('__new');
  box.appendChild(addRow);
  if (Panel.is('schedules')) Panel.refresh();
}
const SCHED_NEW = { id: '__new' };
function schedStatusDot(t) { return t.running ? '◐' : (t.enabled ? (t.last_status && t.last_status !== 'ok' ? '!' : '●') : '○'); }
function openSched(selectId) {
  Panel.open({
    id: 'schedules', eyebrow: 'programadas', title: 'Tareas programadas', sub: schedMountOk ? `tick cada ${schedTick} s · lampson --daemon start para correr con todo cerrado` : '⚠ ./workspace apunta a otro proyecto: en pausa', layout: 'browse', select: selectId || null,
    onClose: () => clearTimeout(schedLiveTimer),
    browse: {
      placeholder: 'buscar tarea…', listWidth: '300px', key: t => t.id,
      load: async (q) => { const all = await fetchSched(); const list = all.filter(t => !q || (t.name + ' ' + t.plan + ' ' + t.action_text).toLowerCase().includes(q.toLowerCase())); return q ? list : [...list, SCHED_NEW]; },
      render: (t) => t === SCHED_NEW ? `<span class="dot">+</span><div><div class="nm" style="color:var(--accent);font-weight:400">programar una tarea…</div><div class="meta">plugin, comando o el agente</div></div>` : `<span class="dot">${schedStatusDot(t)}</span><div><div class="nm">${esc(t.name)}</div><div class="meta">${esc(t.plan)} · ${t.running ? 'corriendo' : (t.enabled ? 'próxima ' + esc(fmtWhen(t.next_run)) : 'apagada')}</div></div>`,
      count: (rows) => { const n = rows.filter(r => r !== SCHED_NEW).length; return `${n} tarea${n === 1 ? '' : 's'}`; },
      emptyHtml: 'nada coincide',
      detail: async (t) => {
        if (t === SCHED_NEW) return schedForm();
        let r; try { r = await (await fetch(BASE + '/api/schedules/log?id=' + encodeURIComponent(t.id) + '&tail=300')).json(); } catch (e) { r = {}; }
        // r.task = el registro crudo (plan como objeto, session, history fresco); t = el resumen (plan y horarios en texto)
        const raw = r.task || t; const task = Object.assign({}, raw, t, { running: raw.running, session: raw.session, history: raw.history, enabled: raw.enabled });
        let live = '';
        if (task.running && task.session) { try { const tr = await (await fetch(BASE + '/api/trace?session=' + encodeURIComponent(task.session) + '&tail=80')).json(); live = tr.trace || '(arrancando…)'; } catch (e) { live = '(arrancando…)'; } }
        else if (task.running) live = task.action.type === 'prompt' ? 'arrancando el agente…' : 'corriendo ' + task.action.type + '…';
        const hist = (task.history || []).slice().reverse().map(h => `<div class="dmsg ${h.status === 'ok' ? '' : 'dm-bad'}"><span class="who">${esc(new Date(h.started * 1000).toLocaleString())} · ${esc(h.status)}${h.late ? ' · atrasada' : ''}${h.steps != null ? ' · ' + h.steps + ' pasos' : ''}${h.session ? ` · <a href="#" data-session="${esc(h.session)}">sesión ⏰</a>` : ''}</span>${esc(h.summary || '')}</div>`).join('');
        return `<div class="dhead"><span class="nm">${esc(task.name)}</span><span class="meta">${esc(task.plan)} · ${task.running ? '● corriendo' : (task.enabled ? 'próxima ' + esc(fmtWhen(task.next_run)) : 'apagada')}</span></div>
          <div class="ddesc">${esc(task.action_text)}</div>
          <div class="dcap">permisos <b>${esc(task.permission)}</b>${task.notify ? ' · avisa a ' + esc(task.notify) : ''}${task.last_run ? ' · última ' + esc(task.last_local) + ' → ' + esc(task.last_status) : ''}</div>
          <div class="dacts"><button class="primary" data-run ${task.running ? 'disabled' : ''}>▶ correr ahora</button><button data-toggle>${task.enabled ? '⏻ apagar' : '○ encender'}</button></div>
          ${live ? `<div class="dcap" style="margin-top:12px">corriendo ahora${task.session ? ' · sesión ' + esc(task.session) : ''}</div><pre class="dlog" data-live>${esc(live)}</pre>` : ''}
          ${hist ? `<div class="dmsgs">${hist}</div>` : '<div class="none" style="margin-top:12px">sin corridas todavía</div>'}
          ${r.log ? `<pre class="dlog">${esc(r.log)}</pre>` : ''}
          <div class="dfoot"><span>.lampson/schedules/${esc(task.id)}.log</span><span class="del">quitar</span></div><div class="derr"></div>`;
      },
      wire: (t, box) => {
        const err = (m) => { const e = box.querySelector('.derr'); if (e) e.textContent = m || ''; };
        if (t === SCHED_NEW) { schedFormWire(box, err); return; }
        box.querySelector('[data-run]').onclick = async () => { const r = await api(BASE + '/api/schedules/run', { id: t.id }); add('meta', '⏰ ' + esc(r.data.result || r.data.error || '')); setTimeout(loadSched, 1500); setTimeout(() => Panel.is('schedules') && Panel.detail(), 2500); };
        box.querySelector('[data-toggle]').onclick = async () => { const r = await api(BASE + '/api/schedules/toggle', { id: t.id, enabled: !t.enabled }); if (!r.ok) { err(r.data.error || 'error'); return; } loadSched(); };
        box.querySelectorAll('[data-session]').forEach(a => a.onclick = (e) => { e.preventDefault(); Panel.close(); openSession(a.dataset.session); });
        const del = box.querySelector('.dfoot .del');
        del.onclick = () => inlineConfirm(del, `¿quitar ${t.name}?`, async () => { await api(BASE + '/api/schedules/remove', { id: t.id }); loadSched(); });
        const live = box.querySelector('[data-live]'); if (live) live.scrollTop = live.scrollHeight;
        clearTimeout(schedLiveTimer); if (t.running) schedLiveTimer = setTimeout(() => { if (Panel.is('schedules')) Panel.refresh(); }, 3000);
      }
    }
  });
}
function schedForm() {
  const pluginOpts = schedPlugins.filter(l => l.enabled).flatMap(l => (l.tools || []).map(tl => `<option value="${esc(l.name + '/' + tl)}">${esc(l.name)} · ${esc(tl)}</option>`)).join('') || '<option value="">ningún plugin encendido</option>';
  return `<div class="dhead"><span class="nm serif">Programar una tarea</span></div><div class="dform">
    <p class="lead">Corre sola, a la hora que digas, mientras lampson esté abierto (esta web o la terminal); con todo cerrado, <code>lampson --daemon start</code>. También podés pedírsela al agente en el chat: <i>«todos los días a las 9 corré los tests y avisame»</i>.</p>
    <label>nombre <input name="name" spellcheck="false" autocomplete="off" placeholder="tests nocturnos"></label>
    <label>cuándo <input name="when" spellcheck="false" autocomplete="off" placeholder="daily 09:00 · every 6h · mon,wed 08:30 · today 15:14 · once 2026-09-01 10:00 · in 2h"></label>
    <label>qué corre <select name="kind"><option value="prompt">el agente, con estas instrucciones</option><option value="bash">un comando de shell</option><option value="plugin">una tool de un plugin encendido</option></select></label>
    <div data-kind="prompt">
      <label class="col">instrucciones <textarea name="prompt" rows="4" spellcheck="false" placeholder="Corré la suite de tests. Si algo falla, buscá la causa y proponé el fix en el informe (no lo apliques). Terminá con un resumen corto."></textarea></label>
      <label>perfil <select name="agent"><option value="build">build — puede editar y correr comandos</option><option value="review">review — corre tests, no edita</option><option value="plan">plan — solo lee y propone</option><option value="explore">explore — solo busca</option></select></label>
      <label>permisos <select name="permission"><option value="ask">preguntar — lo peligroso te manda un link y espera</option><option value="strict">denegar — lo peligroso se rechaza y se informa</option><option value="yolo">permitir todo — sin preguntas</option></select></label>
      <p class="lead">Sobre de permisos de una corrida sin nadie mirando. En «preguntar», la aprobación aparece acá y, con URL pública + webhook (⚙), como link en tu canal; sin respuesta en 2 h se deniega. Lo destructivo del sistema se bloquea siempre.</p>
    </div>
    <div data-kind="bash" style="display:none"><label>comando <input name="command" spellcheck="false" autocomplete="off" placeholder="npm test"></label></div>
    <div data-kind="plugin" style="display:none">
      <label>plugin · tool <select name="plugintool">${pluginOpts}</select></label>
      <label>args (JSON) <input name="args" spellcheck="false" autocomplete="off" placeholder='{"who": "cron"}'></label>
    </div>
    <label>avisar a <input name="notify" spellcheck="false" autocomplete="off" placeholder="opcional: URL de webhook que recibe el resultado (JSON)"></label>
    <div class="pfoot"><button class="primary" data-go>Programar</button><span class="derr"></span></div></div>`;
}
function schedFormWire(box, err) {
  const f = n => box.querySelector(`[name="${n}"]`);
  const kind = () => { const k = f('kind').value; box.querySelectorAll('[data-kind]').forEach(el => el.style.display = el.dataset.kind === k ? '' : 'none'); };
  f('kind').onchange = kind; kind(); f('name').focus();
  box.querySelector('[data-go]').onclick = async () => {
    const k = f('kind').value; let action;
    if (k === 'prompt') action = { type: 'prompt', prompt: f('prompt').value.trim(), agent: f('agent').value };
    else if (k === 'bash') action = { type: 'bash', command: f('command').value.trim() };
    else { const v = f('plugintool').value; if (!v) { err('encendé un plugin primero'); return; } const [plugin, tool] = v.split('/'); let args = {}; if (f('args').value.trim()) { try { args = JSON.parse(f('args').value); } catch (e) { err('args: JSON inválido'); return; } } action = { type: 'plugin', plugin, tool, args }; }
    const body = { name: f('name').value.trim(), when: f('when').value.trim(), action, permission: f('permission').value, notify: f('notify').value.trim() };
    if (!body.when) { err('falta cuándo'); return; }
    err('programando…');
    const r = await api(BASE + '/api/schedules/add', body);
    if (!r.ok) { err(r.data.error || ('error ' + r.status)); return; }
    add('meta', '⏰ ' + esc(r.data.result || 'programada')); setSec('sched', true); await loadSched(); if (r.data.task) Panel.selectKey(r.data.task.id);
  };
}
$('#schedAddBtn').onclick = (ev) => { ev.stopPropagation(); openSched('__new'); };
