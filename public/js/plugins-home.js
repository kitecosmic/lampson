// plugins-home.js — el escaparate de plugins (public/plugins-home.html, servido por el hub en /plugins).
// Lee GET /api/plugins-home: los de la instalación (valen para todos los proyectos), los de cada proyecto y cuáles
// tiene encendidos cada uno. Acá no se enciende nada: «usar en un proyecto» lleva al panel de plugins de ese
// proyecto (/w/<slug>#plugins=<nombre>), donde se revisa qué puede hacer y se decide.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let data = null, picking = null;

function setTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('lampson.theme', t); } catch (e) {} $('#theme').textContent = t === 'dark' ? '☀' : '☾'; }
setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
$('#theme').onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

// lo que permite hacer cada plugin que viene con lampson, en palabras de quien lo usa (el manifiesto trae una
// descripción técnica en inglés: es la que se muestra para los demás)
const PITCH = {
  telegram: 'Un bot de Telegram atendido por un agente. Gratis y sin intermediarios: creás el bot con @BotFather y le pasás el token.',
  chatwoot: 'Tu bandeja de Chatwoot —WhatsApp, Instagram, Facebook, email, chat web— respondida por un agente.',
  orders: 'Tomar pedidos por chat: catálogo, presupuestos con promos y envío, pedidos con cliente y dirección, y stock al día.',
};

function card(p, where) {
  const on = data.workspaces.filter((w) => w.enabled.includes(p.name) && (p.scope === 'global' || w.slug === where.slug));
  const tags = [p.channel ? 'canal' : '', p.tools.length ? `${p.tools.length} herramienta${p.tools.length === 1 ? '' : 's'}` : '', p.config.length ? 'necesita configurar' : '', p.scope === 'project' ? 'solo en ' + where.name : ''].filter(Boolean);
  const key = p.scope + ':' + p.name + ':' + (where.slug || '');
  const targets = p.scope === 'global' ? data.workspaces : data.workspaces.filter((w) => w.slug === where.slug);
  return `<div class="pcard${on.length ? ' used' : ''}">
    <p class="pn">${esc(p.name)}</p>
    <p class="ptags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>
    <p class="pdesc">${esc(PITCH[p.name] || p.description || 'sin descripción')}</p>
    ${p.config.length ? `<p class="pcfg" title="van en el .env de lampson, con el prefijo LAMPSON_">pide: ${p.config.map((c) => `<code>${esc(c)}</code>`).join(' ')}</p>` : ''}
    <p class="pwhere">${on.length ? 'encendido en ' + on.map((w) => `<a href="/w/${esc(w.slug)}#plugins=${encodeURIComponent(p.name)}">${esc(w.name)}</a>`).join(', ') : 'todavía no lo usás en ningún proyecto'}</p>
    ${picking === key
      ? `<div class="ppick"><span>¿en qué proyecto?</span>${targets.map((w) => `<a href="/w/${esc(w.slug)}#plugins=${encodeURIComponent(p.name)}">${esc(w.name)}${w.enabled.includes(p.name) ? ' ✓' : ''}</a>`).join('')}<span class="pcancel" data-cancel>cancelar</span></div>`
      : `<button class="${on.length ? '' : 'primary'}" data-pick="${esc(key)}">${on.length ? 'usar en otro proyecto' : 'usar en un proyecto'} →</button>`}
  </div>`;
}

function render() {
  if (!data) return;
  const global = data.global.filter((p) => !p.example).sort((a, b) => a.name.localeCompare(b.name));
  const local = data.workspaces.flatMap((w) => w.local.filter((p) => !p.example).map((p) => ({ p, w })));
  $('#grid').innerHTML = (global.length || local.length)
    ? global.map((p) => card(p, {})).join('') + local.map(({ p, w }) => card(p, w)).join('')
    : '<div class="vempty"><p><b>No hay plugins instalados.</b></p><p>Los que vienen con lampson viven en la carpeta <code>plugins/</code> de la instalación.</p></div>';
  document.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { picking = b.dataset.pick; render(); }));
  document.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => { picking = null; render(); }));
}

async function refresh() {
  try {
    const r = await fetch('/api/plugins-home');
    if (r.status === 401) { location.href = '/login'; return; }
    data = await r.json();
    render();
    $('#live').classList.remove('off');
  } catch (e) { $('#live').classList.add('off'); }
}
refresh();
setInterval(refresh, 15000);
