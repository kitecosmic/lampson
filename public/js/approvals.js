// approvals.js — lo que espera tu permiso (lib/approvals.syn), venga del chat o de una tarea programada.
// Una corrida desatendida que quiere hacer algo peligroso queda esperando acá (y en el webhook/link si están
// configurados). Las del chat de esta pestaña ya tienen su tarjeta en la conversación; igual aparecen en la lista.
const apprSeen = new Set();
async function loadApprovals() {
  let r; try { r = await (await fetch(BASE + '/api/approvals')).json(); } catch (e) { return; }
  const list = r.approvals || [], pend = list.filter(a => a.status === 'pending');
  const box = $('#apprBox'); box.innerHTML = '';
  $('#apprCount').textContent = pend.length ? `${pend.length} ●` : ''; autoSec('approvals', pend.length > 0);
  if (!list.length) { box.innerHTML = '<div class="p none" style="cursor:default">ninguna pendiente</div>'; }
  for (const a of list) {
    const d = document.createElement('div'); d.className = 'p appr'; const src = a.source === 'chat' ? 'chat' : ('⏰ ' + a.source.replace(/^schedule:?/, ''));
    d.innerHTML = `<span class="st ${a.status === 'pending' ? 'busy' : ''}"></span><span class="nm">${esc(src)}</span><span class="cm">${a.status === 'pending' ? 'vence ' + esc(fmtWhen(a.expires_at)) : esc(a.status)}</span><span class="msg">${esc(a.message)}</span><span class="why">${esc(a.why)}</span>`
      + (a.status === 'pending' ? `<span class="btns"><button class="primary" data-ok="1">Permitir</button><button data-ok="0">Denegar</button></span>` : '');
    d.querySelectorAll('button').forEach(b => b.onclick = async () => { d.querySelectorAll('button').forEach(x => x.disabled = true); await api(BASE + '/api/approve', { id: a.id, decision: b.dataset.ok === '1' }); setTimeout(loadApprovals, 600); });
    box.appendChild(d);
  }
  if (r.public_url === '' && pend.length) { const n = document.createElement('div'); n.className = 'daemon'; n.textContent = 'para aprobar desde el móvil: URL pública + webhook en ⚙'; box.appendChild(n); }
  // tarjeta en el chat para las que NO vienen de esta conversación (una tarea programada pidiendo permiso)
  for (const a of pend) {
    if (a.source === 'chat' || apprSeen.has(a.id)) continue; apprSeen.add(a.id);
    const el = add('approval', `<div class="card"><div class="why">⚠ ${esc(a.why)} · ${esc(a.source.replace(/^schedule:?/, 'tarea programada '))}</div><code>${esc(a.message)}</code><div class="btns"><button class="primary" data-ok="1">Permitir</button><button data-ok="0">Denegar</button></div></div>`);
    el.dataset.id = a.id; el.querySelectorAll('button').forEach(b => b.onclick = async () => { el.querySelectorAll('button').forEach(x => x.disabled = true); await api(BASE + '/api/approve', { id: a.id, decision: b.dataset.ok === '1' }); });
  }
  for (const a of list) { if (a.status === 'pending') continue; const el = [...log.querySelectorAll('.approval')].find(x => x.dataset.id === a.id); if (el && el.querySelector('.btns button')) el.querySelector('.btns').innerHTML = a.status === 'approved' ? '<span style="color:var(--str)">✓ permitido</span>' : (a.status === 'expired' ? '<span class="denied">✗ sin respuesta, denegado</span>' : '<span class="denied">✗ denegado</span>'); }
}
