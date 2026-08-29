// schedules.js — tareas programadas (lib/schedule.syn): sección del panel, formulario «programar» (Panel form)
// y el visor de cada tarea (corridas + log, traza en vivo mientras corre). Las corre cualquier lampson abierto
// (web o terminal, tick cada 30 s) o el daemon (`lampson --daemon start`) con todo cerrado.
let schedData = [], schedLamps = [], schedOpen = null, schedTick = 30, schedLiveTimer = null;
async function loadSched() {
  let r; try { r = await (await fetch('/api/schedules')).json(); } catch (e) { return; }
  schedData = r.tasks || []; schedLamps = r.lamps || []; schedTick = r.tick || 30;
  const box = $('#schedBox'); box.innerHTML = '';
  const on = schedData.filter(t => t.enabled).length, running = schedData.filter(t => t.running).length;
  $('#schedCount').textContent = schedData.length ? (running ? `${running} ● · ${schedData.length}` : `${on} · ${schedData.length}`) : ''; autoSec('sched', running > 0);
  const dm = document.createElement('div'); dm.className = 'daemon' + (r.mount_ok === false ? ' off' : '');
  dm.textContent = r.mount_ok === false ? '⚠ ./workspace apunta a otro proyecto: tareas en pausa · lampson --daemon restart desde esta carpeta' : `corren solas mientras esta web esté abierta · tick cada ${schedTick} s`;
  dm.title = 'las tareas programadas corren en este proceso (web o terminal). Para que corran con todo cerrado: lampson --daemon start';
  box.appendChild(dm);
  if (!schedData.length) { const e = document.createElement('div'); e.className = 'p none'; e.style.cursor = 'default'; e.textContent = 'ninguna'; box.appendChild(e); }
  for (const t of schedData) {
    const d = document.createElement('div'); d.className = 'p sched' + (schedOpen === t.id ? ' active' : '');
    const st = t.running ? 'busy' : (t.enabled ? (t.last_status && t.last_status !== 'ok' ? 'bad' : 'on') : '');
    d.title = `${t.action_text}\npermisos: ${t.permission}` + (t.last_run ? `\núltima: ${t.last_local} · ${t.last_status}: ${t.last_summary}` : '');
    d.innerHTML = `<span class="st ${st}"></span><span class="nm">${esc(t.name)}</span><span class="cm">${esc(t.plan)}</span><span class="act"><span class="run" title="correr ahora (en el próximo tick)">▶</span><span class="tog" title="${t.enabled ? 'apagar' : 'encender'}">${t.enabled ? '⏻' : '○'}</span><span class="rm" title="quitar">✕</span></span>`
      + `<span class="sub">${t.running ? 'corriendo…' : (t.enabled ? 'próxima ' + esc(fmtWhen(t.next_run)) : 'apagada')}${t.last_run ? ' · última ' + esc(t.last_status) : ''} · ${esc(t.action.type)} · ${esc(t.permission)}</span>`;
    d.onclick = () => openSched(t.id);
    d.querySelector('.run').onclick = async (ev) => { ev.stopPropagation(); const r2 = await api('/api/schedules/run', { id: t.id }); add('meta', '⏰ ' + esc(r2.data.result || r2.data.error || '') + ' — <a href="#" class="schedgo">seguirla en vivo</a>'); setTimeout(() => openSched(t.id), 2500); setTimeout(loadSched, 1500); };
    d.querySelector('.tog').onclick = async (ev) => { ev.stopPropagation(); const r2 = await api('/api/schedules/toggle', { id: t.id, enabled: !t.enabled }); if (!r2.ok) add('meta', '⚠ ' + esc(r2.data.error || '')); loadSched(); };
    const rm = d.querySelector('.rm'); rm.onclick = (ev) => { ev.stopPropagation(); const act = d.querySelector('.act'); act.classList.add('ask'); inlineConfirm(rm, '¿quitar?', async () => { await api('/api/schedules/remove', { id: t.id }); if (schedOpen === t.id) { schedOpen = null; showPane('log'); } loadSched(); }); setTimeout(() => act.classList.remove('ask'), 6100); };
    box.appendChild(d);
  }
  const addRow = document.createElement('div'); addRow.className = 'p'; addRow.innerHTML = `<span class="nm" style="color:var(--accent)">+ programar una tarea…</span>`;
  addRow.title = 'una lámpara, un comando o el agente con instrucciones · también se lo podés pedir al agente en el chat';
  addRow.onclick = openSchedAdd;
  box.appendChild(addRow);
  if (schedOpen && !schedData.some(t => t.id === schedOpen)) schedOpen = null;
}
async function openSched(id) {
  schedOpen = id; document.querySelectorAll('.p.active').forEach(x => x.classList.remove('active'));
  let r; try { r = await (await fetch('/api/schedules/log?id=' + encodeURIComponent(id) + '&tail=400')).json(); } catch (e) { return; }
  const t = r.task || {};
  const hist = (t.history || []).slice().reverse().map(h => `${new Date(h.started * 1000).toLocaleString()}  ${h.status}${h.late ? ' (atrasada)' : ''}${h.session ? '  sesión ' + h.session + ' (en la lista de sesiones, ⏰)' : ''}${h.steps != null ? '  ' + h.steps + ' pasos' : ''}\n    ${h.summary}`).join('\n');
  let live = '';
  if (t.running && t.session) { try { const tr = await (await fetch('/api/trace?session=' + encodeURIComponent(t.session) + '&tail=120')).json(); live = '── corriendo ahora (sesión ' + t.session + ') ──\n' + (tr.trace || '(arrancando…)') + '\n\n'; } catch (e) { live = '── corriendo ahora ──\n'; } }
  else if (t.running) live = '── corriendo ahora (' + (t.action.type === 'prompt' ? 'arrancando el agente…' : t.action.type) + ') ──\n\n';
  const text = (t.action_text ? `${t.action_text}\npermisos: ${t.permission}` + (t.notify ? ` · avisa a ${t.notify}` : '') + '\n\n' : '') + live + (hist ? 'corridas:\n' + hist + '\n\n' : '') + (r.log ? '── log ──\n' + r.log : '(sin corridas todavía)');
  showText('⏰ ' + (t.name || id), t.running ? '● corriendo' : (t.enabled ? '○ programada · próxima ' + fmtWhen(t.next_run) : '○ apagada'), text, !!t.running);
  clearTimeout(schedLiveTimer); if (t.running) schedLiveTimer = setTimeout(() => { if (schedOpen === id) openSched(id); }, 3000);
  loadSched();
}
function openSchedAdd() {
  const lampOpts = schedLamps.filter(l => l.enabled).flatMap(l => (l.tools || []).map(tl => `<option value="${esc(l.name + '/' + tl)}">${esc(l.name)} · ${esc(tl)}</option>`)).join('') || '<option value="">ninguna lámpara encendida</option>';
  Panel.open({
    id: 'sched-add', eyebrow: 'programadas', title: 'Programar una tarea', layout: 'form', size: 'md',
    form: {
      html: `<p class="lead">Corre sola, a la hora que digas, mientras lampson esté abierto (esta web o la terminal); con todo cerrado, <code>lampson --daemon start</code>. También podés pedírsela al agente en el chat: <i>«todos los días a las 9 corré los tests y avisame»</i>.</p>
        <label>nombre <input name="name" spellcheck="false" autocomplete="off" placeholder="tests nocturnos"></label>
        <label>cuándo <input name="when" spellcheck="false" autocomplete="off" placeholder="daily 09:00 · every 6h · mon,wed 08:30 · today 15:14 · once 2026-09-01 10:00 · in 2h"></label>
        <label>qué corre <select name="kind"><option value="prompt">el agente, con estas instrucciones</option><option value="bash">un comando de shell</option><option value="lamp">una tool de una lámpara encendida</option></select></label>
        <div data-kind="prompt">
          <label class="col">instrucciones <textarea name="prompt" rows="4" spellcheck="false" placeholder="Corré la suite de tests. Si algo falla, buscá la causa y proponé el fix en el informe (no lo apliques). Terminá con un resumen corto."></textarea></label>
          <label>perfil <select name="agent"><option value="build">build — puede editar y correr comandos</option><option value="review">review — corre tests, no edita</option><option value="plan">plan — solo lee y propone</option><option value="explore">explore — solo busca</option></select></label>
          <label>permisos <select name="permission"><option value="ask">preguntar — lo peligroso te manda un link y espera</option><option value="strict">denegar — lo peligroso se rechaza y se informa</option><option value="yolo">permitir todo — sin preguntas</option></select></label>
          <p class="lead" style="margin-top:-4px">Sobre de permisos de una corrida sin nadie mirando. En «preguntar», la aprobación aparece acá y, con URL pública + webhook (⚙), como link en tu canal; sin respuesta en 2 h se deniega. Lo destructivo del sistema se bloquea siempre.</p>
        </div>
        <div data-kind="bash" style="display:none"><label>comando <input name="command" spellcheck="false" autocomplete="off" placeholder="npm test"></label></div>
        <div data-kind="lamp" style="display:none">
          <label>lámpara · tool <select name="lamptool">${lampOpts}</select></label>
          <label>args (JSON) <input name="args" spellcheck="false" autocomplete="off" placeholder='{"who": "cron"}'></label>
        </div>
        <label>avisar a <input name="notify" spellcheck="false" autocomplete="off" placeholder="opcional: URL de webhook que recibe el resultado (JSON)"></label>`,
      footer: `<button class="primary" data-go>Programar</button><button data-cancel>Cancelar</button>`,
      wire: (b) => {
        const f = n => b.querySelector(`[name="${n}"]`);
        const kind = () => { const k = f('kind').value; b.querySelectorAll('[data-kind]').forEach(el => el.style.display = el.dataset.kind === k ? '' : 'none'); };
        f('kind').onchange = kind; kind();
        b.querySelector('[data-cancel]').onclick = Panel.close;
        b.querySelector('[data-go]').onclick = async () => {
          const k = f('kind').value; let action;
          if (k === 'prompt') action = { type: 'prompt', prompt: f('prompt').value.trim(), agent: f('agent').value };
          else if (k === 'bash') action = { type: 'bash', command: f('command').value.trim() };
          else { const v = f('lamptool').value; if (!v) { Panel.err('encendé una lámpara primero'); return; } const [lamp, tool] = v.split('/'); let args = {}; if (f('args').value.trim()) { try { args = JSON.parse(f('args').value); } catch (e) { Panel.err('args: JSON inválido'); return; } } action = { type: 'lamp', lamp, tool, args }; }
          const body = { name: f('name').value.trim(), when: f('when').value.trim(), action, permission: f('permission').value, notify: f('notify').value.trim() };
          if (!body.when) { Panel.err('falta cuándo'); return; }
          Panel.err('programando…');
          const r = await api('/api/schedules/add', body);
          if (!r.ok) { Panel.err(r.data.error || ('error ' + r.status)); return; }
          Panel.close(); add('meta', '⏰ ' + esc(r.data.result || 'programada')); setSec('sched', true); loadSched();
        };
      }
    }
  });
}
$('#schedAddBtn').onclick = (ev) => { ev.stopPropagation(); openSchedAdd(); };
