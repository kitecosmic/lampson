// config.js — configuración (⚙) y proveedor/modelo/key: UNA vista browse del Panel. Secciones a la izquierda
// (General · Aprobaciones a distancia · Proveedor), su formulario a la derecha. Cada cosa configurable nueva
// entra como una sección más. Los valores fijados en .env se muestran bloqueados; la API key nunca vuelve.
let setupSel = '';
function paintModel() {
  const p = (cfg.providers || []).find(x => x.name === cfg.provider);
  $('#model').textContent = cfg.provider ? `${cfg.provider} · ${cfg.model || ''}` : '';
  $('#model').classList.toggle('nokey', !!p && !p.has_key);
  $('#model').style.display = cfg.provider ? '' : 'none';
}
const CFG_SECTIONS = [
  { id: 'general', name: 'General', meta: 'zona horaria' },
  { id: 'approvals', name: 'Aprobaciones a distancia', meta: 'URL pública · webhook' },
  { id: 'provider', name: 'Proveedor', meta: 'modelo · API key' }
];
function cfgField(v, key, label, placeholder, ds, type) {
  return `<label class="col">${label}<input name="${key}" type="${type || 'text'}" spellcheck="false" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(v[key] || '')}" ${v[key + '_from_env'] ? 'disabled title="fijado en .env (LAMPSON_' + key.toUpperCase() + '): editalo ahí"' : ''}><span class="ds">${ds}</span></label>`;
}
async function openCfg(section, onboarding) {
  let r; try { r = await (await fetch(BASE + '/api/settings/values')).json(); } catch (e) { r = { values: {} }; }
  const v = r.values || {};
  Panel.open({
    id: 'config', eyebrow: 'configuración', title: onboarding ? 'Bienvenido a Lampson' : 'Configuración', sub: 'lampson/.lampson/config.json', layout: 'browse', noClose: !!onboarding,
    select: section || 'general',
    browse: {
      placeholder: 'buscar…', listWidth: '260px', nodot: true, key: s => s.id,
      load: async (q) => CFG_SECTIONS.filter(s => !q || (s.name + ' ' + s.meta).toLowerCase().includes(q.toLowerCase())),
      render: (s) => `<div><div class="nm">${esc(s.name)}</div><div class="meta">${esc(s.meta)}</div></div>`,
      count: (rows) => `${rows.length} secciones`,
      detail: (s) => {
        if (s.id === 'general') return `<div class="dhead"><span class="nm serif">General</span></div><div class="dform"><p class="lead">Se guarda en <code>lampson/.lampson/config.json</code> (local). Un valor fijado en <code>.env</code> gana y se muestra bloqueado.</p>`
          + cfgField(v, 'tz', 'zona horaria', '-03:00', 'para «daily 09:00» y los horarios de las tareas programadas · vacío = la del sistema' + (typeof r.tz_detected === 'number' ? ` (ahora: ${fmtOff(r.tz_detected)})` : ''))
            + cfgField(v, 'idle_hours', 'apagar workspaces inactivos tras', '4', 'horas sin uso tras las que el hub apaga el proceso de un workspace (vuelve a arrancar al abrirlo, en 1-2 s) - 0 = nunca - los que tienen tareas programadas encendidas o politica siempre vivo no se apagan')
          + `<div class="pfoot"><button class="primary" data-save>Guardar</button><span class="derr"></span></div></div>`;
        if (s.id === 'approvals') return `<div class="dhead"><span class="nm serif">Aprobaciones a distancia</span></div><div class="dform"><p class="lead">Cuando una tarea programada (o el chat) necesita tu permiso, además de aparecer acá puede avisarte a tu canal con <b>links de un solo uso</b> para permitir o denegar desde el teléfono.</p>`
          + cfgField(v, 'public_url', 'URL pública', 'https://lampson.midominio.com', 'por dónde se llega a este lampson desde afuera (túnel, VPS, edge con TLS); con esto cada aprobación trae links <code>/approve/&lt;id&gt;/&lt;token&gt;?d=yes|no</code>')
          + cfgField(v, 'webhook_url', 'webhook', 'https://hooks.example.com/lampson', 'POST JSON por cada aprobación pendiente (id, mensaje, links); reenvialo a Telegram, Slack o mail con n8n, un bot o un .syn de 6 líneas')
          + `<label class="col">secreto del webhook<input name="webhook_secret" type="password" spellcheck="false" autocomplete="off" placeholder="${v.has_webhook_secret ? '● guardado — escribí uno nuevo para cambiarlo' : 'opcional'}"><span class="ds">firma HMAC-SHA256 del body en <code>X-Lampson-Signature</code>; dejá vacío para no cambiarlo</span></label>`
          + `<div class="pfoot"><button class="primary" data-save>Guardar</button><span class="derr"></span></div></div>`;
        // proveedor / modelo / key
        setupSel = cfg.provider || (cfg.providers || [])[0]?.name || '';
        const rows = (cfg.providers || []).map(p => `<div class="pr ${p.name === setupSel ? 'on' : ''}" data-name="${esc(p.name)}"><b>${esc(p.name)}</b><span class="dm">${esc(p.model)}</span><span class="k ${p.has_key ? '' : 'no'}">${p.name === 'ollama' ? 'sin key' : (p.has_key ? '● key guardada' : '○ sin key')}</span></div>`).join('');
        return `<div class="dhead"><span class="nm serif">${onboarding ? 'Bienvenido a Lampson' : 'Proveedor y modelo'}</span></div><div class="dform"><p class="lead">${onboarding ? 'Un agente con herramientas acotadas a este proyecto. Para empezar, elegí un proveedor y pegá su API key.' : 'Elegí con qué modelo trabaja el agente (vale para la web y la terminal).'} La API key queda en <code>lampson/.lampson/config.json</code>, solo en esta máquina; nunca vuelve al navegador.</p>
          <div class="plist">${rows}</div>
          <label>modelo <input name="model" spellcheck="false" autocomplete="off" list="modelList"></label>
          <label>API key <input name="key" type="password" spellcheck="false" autocomplete="off" placeholder="pegala acá"></label>
          <datalist id="modelList"></datalist>
          <div class="pfoot"><button class="primary" data-save-provider>Guardar</button><span class="derr"></span></div></div>`;
      },
      wire: (s, box) => {
        const err = (t) => { const e = box.querySelector('.derr'); if (e) e.textContent = t || ''; };
        const save = box.querySelector('[data-save]');
        if (save) save.onclick = async () => {
          const body = {};
          for (const key of ['tz', 'public_url', 'webhook_url', 'idle_hours']) { const el = box.querySelector(`[name="${key}"]`); if (el && !el.disabled) body[key] = el.value.trim(); }
          const sec = box.querySelector('[name="webhook_secret"]'); if (sec && sec.value.trim()) body.webhook_secret = sec.value.trim();
          if (body.tz && !/^[+-]?\d{1,2}(:?\d{2})?$/.test(body.tz)) { err('zona horaria: usá -03:00 o +0200'); return; }
          if (body.idle_hours && !/^[0-9]+([.][0-9]+)?$/.test(body.idle_hours)) { err('inactividad: horas (0 = nunca)'); return; }
          err('guardando…');
          const r2 = await api(BASE + '/api/settings/values', body);
          if (!r2.ok) { err(r2.data.error || ('error ' + r2.status)); return; }
          Object.assign(v, r2.data.values || {}); err('✓ guardado'); add('meta', '⚙ configuración guardada'); loadSched(); loadApprovals();
        };
        const saveP = box.querySelector('[data-save-provider]');
        if (saveP) {
          const f = n => box.querySelector(`[name="${n}"]`);
          const fill = () => {
            const p = (cfg.providers || []).find(x => x.name === setupSel) || {};
            f('model').value = setupSel === cfg.provider ? (cfg.model || p.model || '') : (p.model || ''); f('model').placeholder = p.model || '';
            // modelos válidos según la API del proveedor (evita tipear "DeepSeek-V4-Pro" cuando la API quiere "deepseek-v4-pro")
            const dl = box.querySelector('#modelList'); dl.innerHTML = ''; f('model').title = '';
            if (p.has_key || setupSel === 'ollama') fetch(BASE + '/api/models?provider=' + encodeURIComponent(setupSel)).then(r => r.json()).then(d => { if (setupSel !== p.name) return; if (d.error) { f('model').title = 'no pude listar modelos: ' + d.error; return; } dl.innerHTML = (d.models || []).map(m => `<option value="${esc(m)}">`).join(''); f('model').title = (d.models || []).length ? 'modelos disponibles: ' + d.models.join(', ') : ''; }).catch(() => {});
            f('key').value = ''; f('key').disabled = setupSel === 'ollama';
            f('key').placeholder = setupSel === 'ollama' ? 'ollama no necesita key' : (p.has_key ? 'hay una key guardada · pegá otra para reemplazarla' : 'pegala acá');
          };
          box.querySelectorAll('.pr').forEach(r => r.onclick = () => { setupSel = r.dataset.name; box.querySelectorAll('.pr').forEach(x => x.classList.toggle('on', x.dataset.name === setupSel)); fill(); });
          fill(); if (onboarding) f('key').focus();
          f('key').addEventListener('keydown', e => { if (e.key === 'Enter') saveP.click(); });
          saveP.onclick = async () => {
            const body = { provider: setupSel, model: f('model').value.trim() }; if (f('key').value.trim()) body.key = f('key').value.trim();
            const p = (cfg.providers || []).find(x => x.name === setupSel) || {};
            if (setupSel !== 'ollama' && !p.has_key && !body.key) { err('falta la API key'); return; }
            saveP.disabled = true;
            try {
              const r2 = await api(BASE + '/api/settings', body);
              if (!r2.ok) { err(r2.data.error || ('error ' + r2.status)); return; }
              const d = r2.data; cfg.providers = d.providers; cfg.provider = d.provider; cfg.model = d.model; cfg.vision = d.vision; cfg.configured = d.configured; paintModel(); paintAttach();
              if (onboarding) { Panel.close(); if (log.querySelector('.empty')) empty(); } else { err('✓ guardado'); Panel.detail(); }
            } catch (e) { err(e.message); } finally { saveP.disabled = false; }
          };
        }
      }
    }
  });
}
// proveedor: la pill de la cabecera y el onboarding abren la misma vista, parados en «Proveedor»
function openSetup(onboarding) { openCfg('provider', onboarding); }
$('#cfgBtn').onclick = () => openCfg('general');
$('#model').onclick = () => openSetup(false);
if (location.hash === '#config') setTimeout(() => openCfg('general'), 400);
