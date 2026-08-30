// procs.js — procesos gestionados por el agente (tool process) y puertos en escucha de la máquina
let procOpen = null, procTimer = null;
async function loadPorts() {
  let r; try { r = await (await fetch(BASE + '/api/ports')).json(); } catch (e) { return; }
  const box = $('#ports'); box.innerHTML = '';
  // los procesos de lampson (hub :8080, un workspace por puerto alto) OCUPAN el puerto: se ven, identificados,
  // sin link (la UI se usa por el hub) y sin ✕ (un workspace se apaga desde su Panel; matarlo lo relanza el supervisor)
  let wsByPort = {}; try { const ws = (await (await fetch('/api/workspaces')).json()).workspaces || []; for (const w of ws) wsByPort[w.port] = w; } catch (e) {}
  const list = (r.ports || []).map(p => { const own = /\b(web|hub)\.syn\b/.test(p.command || '') || (p.port === 8080 && /synsema/.test(p.name || '')); return Object.assign({}, p, { lampson: own, wsName: own && wsByPort[p.port] ? wsByPort[p.port].name : (own && p.port === 8080 ? 'hub' : '') }); });
  $('#portCount').textContent = list.length || ''; autoSec('ports', list.length > 0);
  if (!list.length) { box.innerHTML = '<div class="p none">ninguno</div>'; return; }
  for (const p of list) {
    const d = document.createElement('div'); d.className = 'p' + (p.lampson ? ' own' : ''); d.style.cursor = 'default'; d.title = `pid ${p.pid}\n${p.command || '(línea de comando no disponible)'}`;
    const what = p.command ? p.command.replace(/^"?[A-Za-z]:\\[^"]*\\([^"\\]+)"?/, '$1') : p.name;
    if (p.lampson) { d.innerHTML = `<span class="port own" title="puerto ocupado por lampson">:${p.port}</span><span class="cm">lampson · ${esc(p.wsName ? (p.port === 8080 ? 'hub' : 'workspace ' + p.wsName) : 'proceso')}</span>`; box.appendChild(d); continue; }
    d.innerHTML = `<a class="port" href="http://127.0.0.1:${p.port}" target="_blank" rel="noopener" title="abrir http://127.0.0.1:${p.port} en otra pestaña">:${p.port}</a><span class="cm">${esc(what)}</span><button title="matar este proceso (pid ${p.pid}; no lo gestiona lampson)">✕</button>`;
    const kb = d.querySelector('button'); kb.onclick = () => { const holder = document.createElement('span'); holder.className = 'del'; kb.replaceWith(holder); inlineConfirm(holder, `¿matar pid ${p.pid}?`, async () => { await api(BASE + '/api/ports/kill', { pid: p.pid }); loadPorts(); }); setTimeout(() => { if (!holder.classList.contains('ask')) loadPorts(); }, 6100); };
    box.appendChild(d);
  }
}
async function loadProcs() {
  loadPorts();
  let r; try { r = await (await fetch(BASE + '/api/proc')).json(); } catch (e) { return; }
  const box = $('#procs'); box.innerHTML = '';
  const list = r.processes || []; const act = list.filter(p => p.running).length;
  $('#procCount').textContent = list.length ? (act ? `${act} ● · ${list.length}` : `${list.length}`) : '';
  // Procesos queda cerrado salvo que el usuario lo abra (preferencia guardada); el contador avisa
  if (!list.length) { box.innerHTML = '<div class="p none">ninguno</div>'; return; }
  for (const p of list) {
    const d = document.createElement('div'); d.className = 'p' + (p.running ? ' run' : '') + (procOpen === p.name ? ' active' : ''); d.title = p.command;
    d.innerHTML = `<span class="st"></span><span class="nm">${esc(p.name)}</span><span class="cm">$ ${esc(p.command)}</span>` + (p.running ? '<button>■</button>' : '');
    d.onclick = () => openProc(p.name);
    const b = d.querySelector('button'); if (b) b.onclick = async (ev) => { ev.stopPropagation(); await api(BASE + '/api/proc/stop', { name: p.name }); loadProcs(); if (procOpen === p.name) openProc(p.name); };
    box.appendChild(d);
  }
}
async function openProc(name) {
  procOpen = name; document.querySelectorAll('.row.active').forEach(x => x.classList.remove('active'));
  const r = await (await fetch(BASE + '/api/proc/log?name=' + encodeURIComponent(name) + '&tail=400')).json();
  showText('proceso ' + name, r.running ? '● corriendo · log en vivo' : '○ terminado', r.log || '(sin salida todavía)', true);
  clearInterval(procTimer); if (r.running && !events) procTimer = setInterval(() => refreshProcViewer(name), 2000); // sin stream de eventos: respaldo por timer
  loadProcs();
}
async function refreshProcViewer(name) {
  if (procOpen !== name || $('#viewer').style.display === 'none') { clearInterval(procTimer); return; }
  const x = await (await fetch(BASE + '/api/proc/log?name=' + encodeURIComponent(name) + '&tail=400')).json();
  $('#vbody').textContent = x.log || ''; $('#vmeta').textContent = x.running ? '● corriendo · log en vivo' : '○ terminado';
  if (!x.running) { clearInterval(procTimer); loadProcs(); }
}
