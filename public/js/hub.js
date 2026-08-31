// hub.js — la pantalla de workspaces (public/hub.html): tarjetas + el mismo Panel de workspaces que usa la UI de un
// workspace (js/workspaces.js) para crear/encender/apagar. Sin core.js: acá no hay chat.
const $ = s => document.querySelector(s);
const BASE = '', WS_SLUG = '';
function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
async function api(path, body) { const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); let data = {}; try { data = await r.json(); } catch (e) {} return { ok: r.ok, status: r.status, data }; }
function fmtWhen(ts) { if (!ts) return '—'; return new Date(ts * 1000).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function inlineConfirm(el, label, onYes) {
  const prev = el.innerHTML; el.classList.add('ask');
  el.innerHTML = `<span class="q">${esc(label)}</span> <span class="yes">sí</span> · <span class="no">no</span>`;
  const restore = () => { el.innerHTML = prev; el.classList.remove('ask'); };
  el.querySelector('.yes').onclick = (ev) => { ev.stopPropagation(); onYes(); };
  el.querySelector('.no').onclick = (ev) => { ev.stopPropagation(); restore(); };
  setTimeout(() => { if (el.classList.contains('ask')) restore(); }, 6000);
}
// tema
const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.7v2.1M12 19.2v2.1M2.7 12h2.1M19.2 12h2.1M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"/></svg>';
const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z"/></svg>';
function paintTheme() { const light = document.documentElement.getAttribute('data-theme') === 'light'; $('#theme').innerHTML = light ? MOON : SUN; }
$('#theme').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'light' ? 'dark' : 'light'); try { localStorage.setItem('lampson.theme', r.getAttribute('data-theme')); } catch (e) {} paintTheme(); };
paintTheme();
// tarjetas
async function paintGrid() {
  const grid = $('#wsGrid'); let r; try { r = await (await fetch(BASE + '/api/workspaces')).json(); } catch (e) { grid.innerHTML = '<div class="card"><p>el hub no responde</p></div>'; return; }
  grid.innerHTML = '';
  for (const w of (r.workspaces || [])) {
    const c = document.createElement('a'); c.className = 'card ws' + (w.alive ? ' on' : ' off'); c.href = w.url;
    c.innerHTML = `<h3>${w.alive ? '● vivo' : '○ apagado'}${w.schedules_on ? ' · ⏰ ' + w.schedules_on : ''}</h3><p class="nm">${esc(w.name)}</p><p class="pth">${esc(w.path)}</p><p class="meta">último uso ${esc(fmtWhen(w.last_used))}</p>`;
    // entrar = usarlo: si está apagado se enciende acá mismo (con aviso en la tarjeta) y después se abre. La ruta
    // /w/<slug> del hub también lo enciende sola, así que un link directo funciona igual; esto solo da feedback.
    if (!w.alive) c.onclick = async (e) => {
      e.preventDefault(); if (c.dataset.busy) return; c.dataset.busy = '1';
      const h = c.querySelector('h3'); h.textContent = '⟳ encendiendo…'; c.classList.add('busy');
      try { const r = await api('/api/workspaces/start', { slug: w.slug }); if (!r.ok || !r.data.ok) { h.textContent = '○ no arrancó · mirá .lampson/ws/' + w.slug + '/.lampson/web.log'; c.classList.remove('busy'); delete c.dataset.busy; return; } } catch (err) {}
      location.href = w.url;
    };
    grid.appendChild(c);
  }
  const add = document.createElement('a'); add.className = 'card ws new'; add.href = '#'; add.innerHTML = '<h3>+</h3><p class="nm">nuevo workspace</p><p class="pth">elegí una carpeta de tu disco</p>';
  add.onclick = (e) => { e.preventDefault(); openWorkspaces('__new'); };
  grid.appendChild(add);
  const all = document.createElement('a'); all.className = 'card ws'; all.href = '#'; all.innerHTML = '<h3>⌕</h3><p class="nm">gestionar</p><p class="pth">encender, apagar, política de vida, quitar</p>';
  all.onclick = (e) => { e.preventDefault(); openWorkspaces(); };
  grid.appendChild(all);
}
paintGrid();
setInterval(paintGrid, 10000);
