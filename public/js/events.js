// events.js — eventos en vivo (SSE /api/events, alimentado por el bus de Synsema)
// Los supervisores de procesos publican cada línea y cambio de estado; los subagentes, inicio/fin/pasos; las
// tareas programadas y aprobaciones, sus cambios. La UI reacciona a eso (con un pequeño debounce) en vez de
// recargar por timer; los timers quedan como respaldo lento por si el stream se cae (reconexión con backoff).
let events = null, evBackoff = 1000;
function connectEvents() {
  try { events = new EventSource('/api/events'); } catch (e) { events = null; return; }
  events.onopen = () => { evBackoff = 1000; };
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
  events.onerror = () => { events.close(); events = null; setTimeout(connectEvents, evBackoff); evBackoff = Math.min(evBackoff * 2, 30000); };
}
connectEvents();
