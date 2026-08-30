// todo.js — lista de tareas del agente en la sesión actual (tool todo)
async function loadTodo() {
  let r; try { r = await (await fetch(BASE + '/api/todo' + (session ? '?session=' + encodeURIComponent(session) : ''))).json(); } catch (e) { return; }
  const box = $('#todoBox'); box.innerHTML = '';
  const items = r.items || []; const open = items.filter(i => i.status === 'pending' || i.status === 'in_progress').length;
  $('#todoCount').textContent = items.length ? (open ? `${open} · ${items.length}` : `${items.length}`) : ''; autoSec('todo', open > 0);
  if (!items.length) { box.innerHTML = '<div class="p none">ninguna</div>'; return; }
  const mark = { completed: '☑', in_progress: '▶', cancelled: '✕', pending: '☐' };
  for (const it of items) { const d = document.createElement('div'); d.className = 'p' + (it.status === 'in_progress' ? ' run' : ''); d.style.cursor = 'default'; d.innerHTML = `<span class="nm" style="opacity:${it.status === 'completed' || it.status === 'cancelled' ? .5 : 1}">${mark[it.status] || '☐'} ${esc(it.content)}</span>`; box.appendChild(d); }
}
