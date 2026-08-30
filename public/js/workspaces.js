// workspaces.js — el selector de workspace de la cabecera (dentro de un workspace) y el Panel de workspaces.
// La API de workspaces es del HUB (raíz, sin BASE): /api/workspaces…  Sin hub (standalone) el selector se oculta.
let wsList = [], wsIdle = 4;
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
        box.querySelector('[data-open]').onclick = () => { if (w.slug !== WS_SLUG) location.href = w.url; else Panel.close(); };
        const st = box.querySelector('[data-start]'); if (st) st.onclick = async () => { err('arrancando…'); const r = await api('/api/workspaces/start', { slug: w.slug }); err(r.data.ok ? '' : 'no respondió a tiempo'); Panel.refresh(); };
        const sp = box.querySelector('[data-stop]'); if (sp) sp.onclick = async () => { await api('/api/workspaces/stop', { slug: w.slug }); setTimeout(() => Panel.refresh(), 800); };
        box.querySelector('[name="policy"]').onchange = async (ev) => { const r = await api('/api/workspaces/policy', { slug: w.slug, policy: ev.target.value }); if (!r.ok) err(r.data.error || 'error'); };
        const del = box.querySelector('.dfoot .del');
        del.onclick = () => inlineConfirm(del, `¿quitar ${w.name} del registro?`, async () => { const r = await api('/api/workspaces/remove', { slug: w.slug }); if (!r.ok) { err(r.data.error || 'error'); return; } if (w.slug === WS_SLUG) location.href = '/'; else Panel.refresh(); });
      }
    }
  });
}
function wsNewForm() {
  return `<div class="dhead"><span class="nm serif">Nuevo workspace</span></div><div class="dform">
    <p class="lead">Un workspace es una carpeta de tu disco: el agente solo puede tocar lo que hay adentro. Corre en su propio proceso, con sus sesiones, tareas programadas, MCP y lámparas.</p>
    <div class="dacts" style="margin-top:0;align-items:center"><button class="primary" data-pick>Elegir carpeta…</button><span class="ds" data-pickhint style="margin:0">abre el diálogo de carpetas de tu sistema</span></div>
    <label style="margin-top:14px">ruta <input name="path" spellcheck="false" autocomplete="off" placeholder="C:\\proyectos\\mi-app  ·  /home/yo/proyectos/mi-app"></label>
    <div data-browser style="display:none"><div class="dcap" data-here></div><div class="bitems" data-dirs style="max-height:32vh;border:1px solid var(--rule);border-radius:var(--r);padding:4px"></div></div>
    <div class="pfoot"><button class="primary" data-go>Crear y abrir</button><button data-browse>explorar en el servidor</button><span class="derr"></span></div></div>`;
}
function wsNewWire(box, err) {
  const f = n => box.querySelector(`[name="${n}"]`);
  const browser = box.querySelector('[data-browser]');
  const showDir = async (p) => {
    const r = await (await fetch('/api/workspaces/browse?path=' + encodeURIComponent(p || ''))).json();
    browser.style.display = '';
    box.querySelector('[data-here]').textContent = r.path + (r.error ? ' — ' + r.error : '');
    f('path').value = r.path || '';
    const list = box.querySelector('[data-dirs]'); list.innerHTML = '';
    const up = document.createElement('div'); up.className = 'li nodot'; up.innerHTML = '<div><div class="nm">..</div></div>'; up.onclick = () => showDir(r.parent); list.appendChild(up);
    for (const d of (r.dirs || [])) { const it = document.createElement('div'); it.className = 'li nodot'; it.innerHTML = `<div><div class="nm" style="font-weight:400">${esc(d)}/</div></div>`; it.onclick = () => showDir(r.path.replace(/[\\/]$/, '') + (r.path.includes('\\') ? '\\' : '/') + d); list.appendChild(it); }
  };
  box.querySelector('[data-browse]').onclick = () => showDir(f('path').value.trim());
  box.querySelector('[data-pick]').onclick = async () => {
    err('esperando el diálogo de carpetas… (si no aparece, mirá la barra de tareas o usá «explorar en el servidor»)');
    const r = await api('/api/workspaces/pick', {});
    if (!r.data.native) { err(''); box.querySelector('[data-pickhint]').textContent = 'no hay diálogo en este equipo (VPS): usá el explorador'; showDir(''); return; }
    err(''); if (r.data.path) f('path').value = r.data.path;
  };
  box.querySelector('[data-go]').onclick = async () => {
    const path = f('path').value.trim(); if (!path) { err('elegí una carpeta'); return; }
    err('creando y arrancando… (el hub se reinicia un instante)');
    const r = await api('/api/workspaces', { path });
    if (!r.ok) { err(r.data.error || ('error ' + r.status)); return; }
    // el hub se regenera con la ruta nueva y se reinicia (--watch): esperar a que vuelva y navegar
    const url = r.data.url; let tries = 0;
    const poll = async () => { tries++; try { const h = await fetch(BASE + '/api/hub'); if (h.ok && tries > 2) { location.href = url; return; } } catch (e) {} if (tries < 40) setTimeout(poll, 500); else err('el hub no volvió: abrí ' + url + ' a mano'); };
    setTimeout(poll, 1200);
  };
  f('path').focus();
}
if ($('#wsPill')) { $('#wsPill').onclick = () => openWorkspaces(); paintWorkspacePill(); }
