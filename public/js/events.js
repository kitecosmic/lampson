// events.js — eventos en vivo (SSE /api/events, alimentado por el bus de Synsema)
// Los supervisores de procesos publican cada línea y cambio de estado; los subagentes, inicio/fin/pasos; las
// tareas programadas y aprobaciones, sus cambios. La UI reacciona a eso (con un pequeño debounce) en vez de
// recargar por timer; los timers quedan como respaldo lento por si el stream se cae (reconexión con backoff).
let events = null, evBackoff = 1000, evOffline = false, evEverOpen = false;
// El hub responde aunque el workspace esté apagado: por ahí se pregunta "¿sigue vivo?" sin llenar la consola de 502.
const EV_HUB = (location.port && location.port !== '8080') ? location.protocol + '//' + location.hostname + ':8080' : '';
async function wsAlive() {
  if (!WS_SLUG) return true;
  try { const r = await fetch(EV_HUB + '/api/workspaces'); const d = await r.json(); const w = (d.workspaces || []).find(x => x.slug === WS_SLUG); return w ? { alive: w.alive, paused: w.paused } : { alive: true }; } catch (e) { return { alive: true }; }
}
function goOffline(state) {
  if (evOffline) return;
  evOffline = true;
  // apagado a mano (desde el hub o desde este mismo panel): volver al inicio; el banner queda para caídas
  if (state.paused) { location.href = EV_HUB + '/'; return; }
  document.title = '○ ' + document.title.replace(/^○ /, '');
  const why = state.paused ? 'Lo apagaste desde el hub.' : 'El proceso no responde.';
  const m = add('meta wsoff', `○ <b>Este workspace está apagado.</b> ${why} <a href="#" class="wson">▶ encender</a> · <a href="${EV_HUB}/">ir al hub</a> <span class="wsst"></span>`);
  m.querySelector('.wson').onclick = async (e) => { e.preventDefault(); m.querySelector('.wsst').textContent = 'encendiendo…'; try { await fetch(EV_HUB + '/api/workspaces/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: WS_SLUG }) }); } catch (err) {} };
  const poll = async () => {
    const s = await wsAlive();
    if (s.alive) { evOffline = false; document.title = document.title.replace(/^○ /, ''); add('meta wson', '● workspace encendido · reconectado'); evBackoff = 1000; connectEvents(); if (typeof loadProcs === 'function') loadProcs(); if (typeof loadSessions === 'function') loadSessions(); }
    else setTimeout(poll, 3000);
  };
  setTimeout(poll, 3000);
}
function connectEvents() {
  try { events = new EventSource(BASE + '/api/events'); } catch (e) { events = null; return; }
  events.onopen = () => { evBackoff = 1000; evEverOpen = true; };
  events.addEventListener('event', e => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    const t = ev.topic || '';
    if (t.startsWith('proc.')) {
      const name = ev.data && ev.data.name;
      if (!ev.data || ev.data.line === undefined) debounce('procs', loadProcs, 300);        // cambio de estado
      if (name && procOpen === name) debounce('procview', () => refreshProcViewer(name), 250);
    } else if (t.startsWith('mcp.')) {
      debounce('mcp', loadMcp, 300);
    } else if (t.startsWith('schedule.')) {
      debounce('sched', loadSched, 300);
      if (t === 'schedule.done' && ev.data) { setTimeout(loadSessions, 800); add('meta', `⏰ <b>${esc(ev.data.name)}</b> terminó: ${esc(ev.data.status)} — <a href="#" class="schedgo">ver</a>`).querySelector('.schedgo').onclick = (e2) => { e2.preventDefault(); openSched(ev.data.id); }; }
    } else if (t.startsWith('approval.')) {
      debounce('appr', loadApprovals, 200);
    } else if (t.startsWith('subagent.')) {
      debounce('agents', loadAgents, 300);
      const id = t.slice('subagent.'.length);
      if (id && agentOpen === id && agentPaint) debounce('agentview', agentPaint, 250);
    }
  });
  events.onerror = async () => {
    events.close(); events = null;
    // ¿se cayó el stream o se apagó el workspace? Si el hub dice que no está vivo, no insistimos contra el proxy.
    const s = await wsAlive();
    if (!s.alive) { goOffline(s); return; }
    setTimeout(connectEvents, evBackoff); evBackoff = Math.min(evBackoff * 2, 30000);
  };
}
connectEvents();
