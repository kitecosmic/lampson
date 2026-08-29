// memory.js — notas que el agente guarda sobre este proyecto (tool memory)
let memOpen = null;
async function loadMemory() {
  let r; try { r = await (await fetch('/api/memory')).json(); } catch (e) { return; }
  const box = $('#memory'); box.innerHTML = '';
  const notes = r.notes || [];
  $('#memCount').textContent = notes.length || ''; autoSec('memory', notes.length > 0);
  if (!notes.length) { box.innerHTML = '<div class="m none">sin notas todavía</div>'; return; }
  for (const n of notes) { const d = document.createElement('div'); d.className = 'm' + (memOpen === n.name ? ' active' : ''); d.title = n.title; d.innerHTML = `<b>${esc(n.name)}</b><span class="t">${esc(n.title)}</span>`; d.onclick = () => openMemory(n.name); box.appendChild(d); }
}
async function openMemory(name) {
  memOpen = name; procOpen = null; clearInterval(procTimer);
  const r = await (await fetch('/api/memory/note?name=' + encodeURIComponent(name))).json();
  if (r.error) { add('denied', esc(r.error)); return; }
  showText('memoria · ' + name + '.md', 'notas del agente sobre este proyecto (editables a mano en lampson/memory/)', r.content || '(vacía)', false);
  loadMemory();
}
