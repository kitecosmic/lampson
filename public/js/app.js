// app.js — arranque: config de la cabecera y primera carga de cada sección (se carga último)
async function loadCfg() {
  try { cfg = await (await fetch('/api/config')).json(); } catch (e) { cfg = {}; }
  const ws = cfg.workspace || '';
  $('#proj').textContent = ws.split(/[\\/]/).filter(Boolean).pop() || 'workspace'; $('#proj').title = ws;
  $('#hpath').textContent = ws; $('#hpath').title = ws;
  $('#perm').value = localStorage.getItem('lampson.perm') || cfg.permission || 'ask'; $('#perm').onchange = () => localStorage.setItem('lampson.perm', $('#perm').value);
  paintModel();
  if (cfg.configured === false) openSetup(true);
  const sel = $('#agent'); sel.innerHTML = '';
  for (const a of (cfg.agents || ['build'])) { const o = document.createElement('option'); o.value = a; o.textContent = 'agente: ' + a; sel.appendChild(o); }
  sel.value = localStorage.getItem('lampson.agent') || 'build';
  const hint = () => { const p = (cfg.profiles || {})[sel.value]; const t = p ? sel.value + ' · ' + p.tools.join(' · ') : ''; $('#agentHint').textContent = t; $('#agentHint2').textContent = t; };
  sel.onchange = () => { localStorage.setItem('lampson.agent', sel.value); hint(); }; hint();
  if (!log.children.length) empty();
}
loadCfg().then(() => { loadTree(); loadSessions(); loadProcs(); loadMemory(); loadAgents(); loadMcp(); loadLsp(); loadLamps(); loadTodo(); loadSched(); loadApprovals(); checkUpdate(); const pq = new URLSearchParams(location.search).get('proc'); if (pq) openProc(pq); else if (session) open(session); });
// respaldos lentos por si el stream de eventos se cae
setInterval(loadProcs, events ? 60000 : 10000);
setInterval(() => { loadSched(); if (!events) loadApprovals(); }, events ? 60000 : 15000);
setInterval(() => { if (!events && ($('#agentCount').textContent.includes('●') || busy)) loadAgents(); }, 5000);
