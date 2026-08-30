// workspaces.js — el selector de workspace de la cabecera (dentro de un workspace) y el Panel de workspaces.
// La API de workspaces es del HUB (raíz, sin BASE): /api/workspaces…  Sin hub (standalone) el selector se oculta.
let wsList = [], wsIdle = 4;
// abierto por el puerto de un proceso (:808N) las URLs de otros workspaces tienen que ir al hub (:8080), no a este proceso
const HUB_BASE = (location.port && location.port !== '8080') ? location.protocol + '//' + location.hostname + ':8080' : '';
function wsUrl(w) { return HUB_BASE + w.url; }
async function fetchWorkspaces() {
  try { const r = await (await fetch('/api/workspaces')).json(); wsList = r.workspaces || []; wsIdle = r.idle_hours; return true; } catch (e) { wsList = []; return false; }
}
async function paintWorkspacePill() {
  const pill = $('#wsPill'); if (!pill) return;
  if (!BASE) { pill.style.display = 'none'; return; }
  const ok = await fetchWorkspaces();
  const me = wsList.find(w => w.slug === WS_SLUG);
  pill.style.display = ok ? '' : 'none';
  pill.textContent = (me ? me.name : WS_SLUG) + ' ▾'; pill.title = (me ? me.path + '\n' : '') + 'cambiar de workspace · los demás siguen vivos';
}
const WS_NEW = { slug: '__new' };
function openWorkspaces(selectSlug) {
  Panel.open({
    id: 'workspaces', eyebrow: 'workspaces', title: 'Workspaces', sub: 'cada uno corre en su propio proceso', layout: 'browse', select: selectSlug || WS_SLUG || null,
    browse: {
      placeholder: 'buscar workspace…', listWidth: '300px', key: w => w.slug,
      load: async (q) => { await fetchWorkspaces(); const list = wsList.filter(w => !q || (w.name + ' ' + w.path).toLowerCase().includes(q.toLowerCase())); return q ? list : [...list, WS_NEW]; },
      render: (w) => w === WS_NEW ? `<span class="dot">+</span><div><div class="nm" style="color:var(--accent);font-weight:400">nuevo workspace…</div><div class="meta">elegí una carpeta</div></div>` : `<span class="dot">${w.alive ? '●' : '○'}</span><div><div class="nm">${esc(w.name)}${w.slug === WS_SLUG ? ' <span class="meta">(este)</span>' : ''}</div><div class="meta">${esc(w.path)}</div></div>`,
      count: (rows) => { const n = rows.filter(r => r !== WS_NEW).length, a = rows.filter(r => r !== WS_NEW && r.alive).length; return `${n} workspace${n === 1 ? '' : 's'} · ${a} vivo${a === 1 ? '' : 's'}`; },
      emptyHtml: 'nada coincide', emptyDetail: 'Todavía no hay workspaces. Creá uno con «nuevo workspace…» o abrí <code>lampson</code> en la carpeta de un proyecto.',
      detail: (w) => w === WS_NEW ? wsNewForm() : `<div class="dhead"><span class="nm">${esc(w.name)}</span><span class="meta">${w.alive ? '● vivo' : '○ apagado'} · ${esc(w.policy)}</span></div>
        <div class="dcap">${esc(w.path)}</div>
        <div class="ddesc">${w.schedules_on ? `${w.schedules_on} tarea${w.schedules_on === 1 ? '' : 's'} programada${w.schedules_on === 1 ? '' : 's'} encendida${w.schedules_on === 1 ? '' : 's'} (lo mantienen vivo). ` : ''}Último uso: ${esc(fmtWhen(w.last_used))}.</div>
        <div class="dacts"><button class="primary" data-open>${w.slug === WS_SLUG ? 'Ya estás acá' : 'Abrir'}</button>${w.alive ? '<button data-stop>■ apagar</button>' : '<button data-start>▶ encender</button>'}</div>
        <div class="dform" style="margin-top:14px"><label>vida <select name="policy"><option value="auto" ${w.policy === 'auto' ? 'selected' : ''}>auto — vivo mientras se use (${wsIdle === 0 ? 'nunca se apaga' : 'se apaga tras ' + wsIdle + ' h sin uso'}) o tenga tareas</option><option value="always" ${w.policy === 'always' ? 'selected' : ''}>siempre vivo</option><option value="off" ${w.policy === 'off' ? 'selected' : ''}>apagado — solo cuando lo abrís</option></select></label><span class="ds">las horas de inactividad se cambian en ⚙ → General</span></div>
        <div class="dfoot"><span>/w/${esc(w.slug)} · :${w.port} (solo loopback)</span><span class="del">quitar del registro</span></div><div class="derr"></div>`,
      wire: (w, box) => {
        const err = (m) => { const e = box.querySelector('.derr'); if (e) e.textContent = m || ''; };
        if (w === WS_NEW) { wsNewWire(box, err); return; }
        box.querySelector('[data-open]').onclick = () => { if (w.slug !== WS_SLUG) location.href = wsUrl(w); else Panel.close(); };
        const st = box.querySelector('[data-start]'); if (st) st.onclick = async () => { err('arrancando…'); const r = await api('/api/workspaces/start', { slug: w.slug }); err(r.data.ok ? '' : 'no respondió a tiempo'); Panel.refresh(); };
        const sp = box.querySelector('[data-stop]'); if (sp) sp.onclick = async () => { await api('/api/workspaces/stop', { slug: w.slug }); setTimeout(() => Panel.refresh(), 800); };
        box.querySelector('[name="policy"]').onchange = async (ev) => { const r = await api('/api/workspaces/policy', { slug: w.slug, policy: ev.target.value }); if (!r.ok) err(r.data.error || 'error'); };
        const del = box.querySelector('.dfoot .del');
        del.onclick = () => inlineConfirm(del, `¿quitar ${w.name} del registro?`, async () => { const r = await api('/api/workspaces/remove', { slug: w.slug }); if (!r.ok) { err(r.data.error || 'error'); return; } if (w.slug === WS_SLUG) location.href = HUB_BASE + '/'; else Panel.refresh(); });
      }
    }
  });
}
function wsNewForm() {
  return `<div class="dhead"><span class="nm serif">Nuevo workspace</span></div><div class="dform">
    <p class="lead">Un workspace es una carpeta de tu disco: el agente solo puede tocar lo que hay adentro. Corre en su propio proceso, con sus sesiones, tareas programadas, MCP y lámparas.</p>
    <div class="pickrow"><button class="primary" data-pick>Elegir carpeta…</button><span class="ds">se abre el diálogo de carpetas de tu sistema · <a href="#" data-browse>o explorá desde acá</a></span></div>
    <div class="chosen" data-chosen style="display:none"><span class="lk">carpeta</span><code data-chosen-path></code><span class="del" data-clear title="elegir otra">✕</span></div>
    <div data-browser class="wsbrowser" style="display:none">
      <div class="bhead"><span class="ds" data-here></span><input name="path" spellcheck="false" autocomplete="off" placeholder="o pegá una ruta y Enter"></div>
      <div class="bitems" data-dirs></div>
      <div class="bfoot"><button data-use>Usar esta carpeta</button></div>
    </div>
    <div class="pfoot" data-go-row style="display:none;justify-content:flex-end"><span class="derr" style="margin:0 auto 0 0"></span><button class="primary" data-go>Crear y abrir</button></div>
    <div class="derr" data-err2></div></div>`;
}
function wsNewWire(box, err0) {
  const chosenBox = box.querySelector('[data-chosen]'), goRow = box.querySelector('[data-go-row]'), browser = box.querySelector('[data-browser]');
  const f = n => box.querySelector(`[name="${n}"]`);
  const err = (m) => { const e = goRow.style.display === 'none' ? box.querySelector('[data-err2]') : goRow.querySelector('.derr'); box.querySelectorAll('.derr').forEach(x => x.textContent = ''); if (e) e.textContent = m || ''; };
  let chosen = '';
  const choose = (p) => { chosen = (p || '').trim(); chosenBox.style.display = chosen ? '' : 'none'; goRow.style.display = chosen ? 'flex' : 'none'; box.querySelector('[data-chosen-path]').textContent = chosen; if (chosen) { browser.style.display = 'none'; err(''); } };
  let here = '';
  const showDir = async (p) => {
    err('');
    const r = await (await fetch('/api/workspaces/browse?path=' + encodeURIComponent(p || ''))).json();
    browser.style.display = '';
    here = r.path || ''; box.querySelector('[data-here]').textContent = here + (r.error ? ' — ' + r.error : ''); f('path').value = '';
    const list = box.querySelector('[data-dirs]'); list.innerHTML = '';
    const up = document.createElement('div'); up.className = 'li nodot'; up.innerHTML = '<div><div class="nm">..</div><div class="meta">subir un nivel</div></div>'; up.onclick = () => showDir(r.parent); list.appendChild(up);
    for (const d of (r.dirs || [])) { const it = document.createElement('div'); it.className = 'li nodot'; it.innerHTML = `<div><div class="nm" style="font-weight:400">${esc(d)}/</div></div>`; it.onclick = () => showDir(here.replace(/[\\/]$/, '') + (here.includes('\\') ? '\\' : '/') + d); list.appendChild(it); }
  };
  box.querySelector('[data-browse]').onclick = (e) => { e.preventDefault(); showDir(chosen || ''); };
  box.querySelector('[data-use]').onclick = () => choose(here);
  f('path').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = f('path').value.trim(); if (v) showDir(v); } });
  box.querySelector('[data-clear]').onclick = () => choose('');
  box.querySelector('[data-pick]').onclick = async () => {
    err('esperando el diálogo de carpetas… (si no lo ves, mirá la barra de tareas)');
    const r = await api('/api/workspaces/pick', {});
    if (!r.ok) { err('esta página no es el hub: abrí ' + location.protocol + '//' + location.hostname + ':8080/'); return; }
    if (!r.data.native) { err('no hay diálogo en este equipo (VPS): explorá desde acá'); showDir(''); return; }
    err(''); if (r.data.path) choose(r.data.path);
  };
  box.querySelector('[data-go]').onclick = async () => {
    if (!chosen) { err('elegí una carpeta'); return; }
    err('creando y arrancando… (el hub se reinicia un instante)');
    const r = await api('/api/workspaces', { path: chosen });
    if (!r.ok) { err(r.data.error || ('error ' + r.status)); return; }
    // el hub se regenera con la ruta nueva y se reinicia: esperar a que vuelva y navegar
    const url = HUB_BASE + r.data.url; let tries = 0;
    const poll = async () => { tries++; try { const h = await fetch('/api/hub'); if (h.ok && tries > 2) { location.href = url; return; } } catch (e) {} if (tries < 40) setTimeout(poll, 500); else err('el hub no volvió: abrí ' + url + ' a mano'); };
    setTimeout(poll, 1200);
  };
}
if ($('#wsPill')) { $('#wsPill').onclick = () => openWorkspaces(); paintWorkspacePill(); }
