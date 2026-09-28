// devices.js — «dispositivos» del hub: emparejar un celular por QR (solo desde esta PC), ver y quitar los
// emparejados, cerrar la sesión remota. El API es del hub (lib/auth.syn vía hub.tpl.syn): /api/auth/…
let authMe = { local: true, authenticated: true };
const DEV_PAIR = { id: '__pair' };
async function fetchMe() { try { authMe = await (await fetch('/api/auth/me')).json(); } catch (e) {} return authMe; }
async function fetchDevices() { try { const r = await fetch('/api/auth/devices'); if (!r.ok) return { devices: [] }; return await r.json(); } catch (e) { return { devices: [] }; } }
let pairTimer = null;
function stopPairTimer() { if (pairTimer) { clearInterval(pairTimer); pairTimer = null; } }

function pairDetail() {
  return `<div class="dhead"><span class="nm serif">Emparejar un dispositivo</span></div><div class="dform">
    <p class="lead">Abrí la cámara del celular y escaneá el QR. Se crea una passkey y después entrás con la huella o la cara.</p>
    <label>URL pública <input name="purl" spellcheck="false" autocomplete="off" placeholder="https://….trycloudflare.com"></label>
    <span class="ds">la dirección https por la que el celular llega a esta PC (túnel o dominio). Levantá uno con <code>cloudflared tunnel --url http://localhost:8080</code> y pegá la URL que imprime.</span>
    <div class="pfoot" style="justify-content:flex-start;gap:10px;margin-top:12px"><button class="primary" data-gen>Generar QR</button><span class="derr"></span></div>
    <div class="pairqr" data-qr style="display:none"><div class="qr" data-qrimg></div><div class="qrmeta"><div class="ds" data-left></div><a class="ds" data-link target="_blank" rel="noopener">abrir el link</a><div class="ds">Una passkey queda atada a esta URL: si el túnel cambia de dirección, hay que emparejar de nuevo.</div></div></div>
  </div>`;
}
function pairWire(box) {
  const inp = box.querySelector('[name="purl"]'), err = (m) => { box.querySelector('.derr').textContent = m || ''; };
  fetch('/api/auth/public-url').then(r => r.json()).then(d => { if (!inp.value) inp.value = d.public_url || ''; }).catch(() => {});
  box.querySelector('[data-gen]').onclick = async () => {
    err(''); stopPairTimer();
    const url = inp.value.trim();
    const s = await api('/api/auth/public-url', { url });
    if (!s.ok) { err(s.data.error || 'URL inválida'); return; }
    if (!s.data.public_url) { err('falta la URL pública'); return; }
    const p = await api('/api/auth/pair', {});
    if (!p.ok) { err(p.data.error || ('error ' + p.status)); return; }
    const link = s.data.public_url + '/pair#' + encodeURIComponent(p.data.code);
    const qr = qrcode(0, 'M'); qr.addData(link); qr.make();
    box.querySelector('[data-qrimg]').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
    const a = box.querySelector('[data-link]'); a.href = link;
    box.querySelector('[data-qr]').style.display = '';
    const before = (await fetchDevices()).devices.map(d => d.id);
    const until = Date.now() + p.data.expires_in * 1000, left = box.querySelector('[data-left]');
    let ticks = 0;
    pairTimer = setInterval(async () => {
      if (!document.body.contains(left)) { stopPairTimer(); return; }
      const s2 = Math.max(0, Math.round((until - Date.now()) / 1000));
      left.textContent = s2 > 0 ? `vence en ${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, '0')}` : 'venció · generá otro';
      if (s2 <= 0) { stopPairTimer(); box.querySelector('[data-qrimg]').style.opacity = .25; return; }
      if (++ticks % 2) return;   // cada 2 s: ¿apareció un dispositivo nuevo?
      const now = (await fetchDevices()).devices, nuevo = now.find(d => !before.includes(d.id));
      if (nuevo) { stopPairTimer(); Panel.refresh(); setTimeout(() => Panel.selectKey(nuevo.id), 300); }
    }, 1000);
  };
}

function openDevices() {
  Panel.open({
    id: 'devices', eyebrow: 'acceso remoto', title: 'Dispositivos', sub: authMe.local ? 'celulares y tablets que pueden entrar a esta PC' : 'entraste desde un dispositivo emparejado', layout: 'browse',
    select: authMe.local ? '__pair' : null,
    onClose: stopPairTimer,
    browse: {
      placeholder: 'buscar dispositivo…', listWidth: '280px', key: d => d.id,
      load: async (q) => { const r = await fetchDevices(); const list = (r.devices || []).filter(d => !q || d.name.toLowerCase().includes(q.toLowerCase())); return authMe.local && !q ? [DEV_PAIR, ...list] : list; },
      render: (d) => d === DEV_PAIR ? `<span class="dot">+</span><div><div class="nm" style="color:var(--accent);font-weight:400">emparejar dispositivo…</div><div class="meta">QR para el celular</div></div>` : `<span class="dot on">●</span><div><div class="nm">${esc(d.name)}${d.current ? ' <span class="meta">(este)</span>' : ''}</div><div class="meta">${esc(d.rp_id)} · ${esc(fmtWhen(d.last_used))}</div></div>`,
      count: (rows) => { const n = rows.filter(r => r !== DEV_PAIR).length; return `${n} dispositivo${n === 1 ? '' : 's'}`; },
      emptyHtml: 'ninguno', emptyDetail: authMe.local ? 'Todavía no emparejaste ninguno.' : 'Sin dispositivos.',
      detail: (d) => d === DEV_PAIR ? pairDetail() : `<div class="dhead"><span class="nm">${esc(d.name)}</span><span class="meta">${d.current ? 'este dispositivo' : ''}</span></div>
        <div class="dcap">${esc(d.rp_id)}</div>
        <div class="ddesc">Emparejado ${esc(fmtWhen(d.created))} · último ingreso ${esc(fmtWhen(d.last_used))}. Entra con su passkey (huella, cara o bloqueo de pantalla).</div>
        <div class="dform" style="margin-top:14px"><label>nombre <input name="dname" value="${esc(d.name)}" maxlength="60" spellcheck="false"></label></div>
        <div class="dacts">${d.current ? '<button data-logout>cerrar sesión</button>' : ''}</div>
        <div class="dfoot"><span>quitarlo corta sus sesiones al instante</span><span class="del">quitar dispositivo</span></div><div class="derr"></div>`,
      wire: (d, box) => {
        if (d === DEV_PAIR) { pairWire(box); return; }
        stopPairTimer();
        const err = (m) => { const e = box.querySelector('.derr'); if (e) e.textContent = m || ''; };
        const nm = box.querySelector('[name="dname"]');
        nm.onchange = async () => { const r = await api('/api/auth/devices/rename', { id: d.id, name: nm.value }); if (!r.ok) err(r.data.error || 'error'); else Panel.refresh(); };
        const lo = box.querySelector('[data-logout]'); if (lo) lo.onclick = async () => { await api('/api/auth/logout', {}); location.href = '/login'; };
        const del = box.querySelector('.dfoot .del');
        del.onclick = () => inlineConfirm(del, `¿quitar ${d.name}?`, async () => { const r = await api('/api/auth/devices/remove', { id: d.id }); if (!r.ok) { err(r.data.error || 'error'); return; } if (d.current) location.href = '/login'; else Panel.refresh(); });
      }
    }
  });
}
(async () => { const b = $('#devicesBtn'); if (!b) return; await fetchMe(); b.onclick = () => openDevices(); b.title = authMe.local ? 'emparejar el celular y ver los dispositivos con acceso' : 'dispositivos · cerrar sesión'; })();
