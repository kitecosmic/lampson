// agents.js — subagentes (tool delegate): lista + log vivo por hijo
let agentOpen = null, agentTimer = null, agentPaint = null;
async function loadAgents() {
  let r; try { r = await (await fetch(BASE + '/api/agents')).json(); } catch (e) { return; }
  const box = $('#agentsBox'); box.innerHTML = '';
  const list = (r.agents || []).slice().reverse(); const act = list.filter(a => a.status === 'running').length;
  $('#agentCount').textContent = list.length ? (act ? `${act} ● · ${list.length}` : `${list.length}`) : ''; autoSec('agents', act > 0);
  if (!list.length) { box.innerHTML = '<div class="p none">ninguno</div>'; return; }
  for (const a of list) {
    const run = a.status === 'running';
    const d = document.createElement('div'); d.className = 'p' + (run ? ' run' : '') + (agentOpen === a.id ? ' active' : ''); d.title = `${a.status} · ${a.steps} pasos · ${a.tokens} tokens\n${a.brief}`;
    d.innerHTML = `<span class="st"></span><span class="nm">${esc(a.id)}</span><span class="cm">${esc(String(a.brief || '').split('\n')[0].slice(0, 90))}</span>` + (run ? '<button title="parar: devuelve el informe parcial">■</button>' : '');
    d.onclick = () => openAgent(a.id);
    const b = d.querySelector('button'); if (b) b.onclick = async (ev) => { ev.stopPropagation(); await api(BASE + '/api/agents/stop', { id: a.id }); setTimeout(loadAgents, 1500); };
    box.appendChild(d);
  }
}
async function openAgent(id) {
  agentOpen = id; procOpen = null; document.querySelectorAll('.row.active').forEach(x => x.classList.remove('active'));
  const paint = async () => {
    let r; try { r = await (await fetch(BASE + '/api/agents/log?id=' + encodeURIComponent(id))).json(); } catch (e) { return false; }
    const meta = (r.agent || {});
    $('#vpath').textContent = 'subagente ' + id; $('#vmeta').textContent = meta.status === 'running' ? `● corriendo · ${meta.steps} pasos · log en vivo` : `○ ${meta.status || 'terminado'} · ${meta.steps ?? '?'} pasos · ${meta.tokens ?? '?'} tokens`;
    const pre = $('#vbody'); pre.className = 'log'; pre.textContent = (r.log || '(sin salida todavía)') + (meta.status && meta.status !== 'running' && meta.text ? '\n\n── informe ──\n' + meta.text : '');
    return meta.status === 'running';
  };
  agentPaint = async () => { if (agentOpen !== id || $('#viewer').style.display === 'none') return; const still = await paint(); if (!still) loadAgents(); };
  const running = await paint(); showPane('viewer'); $('#stage').scrollTop = $('#stage').scrollHeight;
  clearInterval(agentTimer); if (running && !events) agentTimer = setInterval(agentPaint, 2000); // respaldo sin stream
  loadAgents();
}
