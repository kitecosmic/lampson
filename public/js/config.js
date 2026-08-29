// config.js — rueda ⚙: Panel con tabs (General / Aprobaciones a distancia / Proveedor) → .lampson/config.json
// Cada cosa nueva que se pueda configurar entra como un tab más. Los valores fijados en .env se muestran bloqueados.
async function openCfg(tab) {
  let r; try { r = await (await fetch('/api/settings/values')).json(); } catch (e) { r = { values: {} }; }
  const v = r.values || {};
  const field = (key, label, placeholder, ds, type) => `<label class="col">${label}<input name="${key}" type="${type || 'text'}" spellcheck="false" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(v[key] || '')}" ${v[key + '_from_env'] ? 'disabled title="fijado en .env (LAMPSON_' + key.toUpperCase() + '): editalo ahí"' : ''}><span class="ds">${ds}</span></label>`;
  Panel.open({
    id: 'config', eyebrow: 'configuración', title: 'Configuración', layout: 'tabs', size: 'md',
    tabs: {
      initial: tab || 'general',
      tabs: [
        { id: 'general', label: 'General', html: `<p class="lead">Se guarda en <code>lampson/.lampson/config.json</code> (local). Un valor fijado en <code>.env</code> gana y se muestra bloqueado.</p>`
            + field('tz', 'zona horaria', '-03:00', 'para «daily 09:00» y los horarios de las tareas programadas · vacío = la del sistema' + (typeof r.tz_detected === 'number' ? ` (ahora: ${fmtOff(r.tz_detected)})` : '')) },
        { id: 'approvals', label: 'Aprobaciones a distancia', html: `<p class="lead">Cuando una tarea programada (o el chat) necesita tu permiso, además de aparecer acá puede avisarte a tu canal con <b>links de un solo uso</b> para permitir o denegar desde el teléfono.</p>`
            + field('public_url', 'URL pública', 'https://lampson.midominio.com', 'por dónde se llega a este lampson desde afuera (túnel, VPS, edge con TLS); con esto cada aprobación trae links <code>/approve/&lt;id&gt;/&lt;token&gt;?d=yes|no</code>')
            + field('webhook_url', 'webhook', 'https://hooks.example.com/lampson', 'POST JSON por cada aprobación pendiente (id, mensaje, links); reenvialo a Telegram, Slack o mail con n8n, un bot o un .syn de 6 líneas')
            + `<label class="col">secreto del webhook<input name="webhook_secret" type="password" spellcheck="false" autocomplete="off" placeholder="${v.has_webhook_secret ? '● guardado — escribí uno nuevo para cambiarlo' : 'opcional'}"><span class="ds">firma HMAC-SHA256 del body en <code>X-Lampson-Signature</code>; dejá vacío para no cambiarlo</span></label>` },
        { id: 'provider', label: 'Proveedor', html: `<p class="lead">Proveedor, modelo y API key tienen su propia ventana (también la pill <code>proveedor · modelo</code> de la barra).</p><p><button class="primary" data-provider>Abrir proveedor y modelo</button></p>` }
      ],
      footer: `<button class="primary" data-save>Guardar</button><button data-cancel>Cerrar</button>`,
      wire: (b) => {
        b.querySelector('[data-cancel]').onclick = Panel.close;
        b.querySelector('[data-provider]').onclick = () => { Panel.close(); openSetup(false); };
        b.querySelector('[data-save]').onclick = async () => {
          const body = {};
          for (const key of ['tz', 'public_url', 'webhook_url']) { const el = b.querySelector(`[name="${key}"]`); if (el && !el.disabled) body[key] = el.value.trim(); }
          const sec = b.querySelector('[name="webhook_secret"]').value.trim(); if (sec) body.webhook_secret = sec;
          if (body.tz && !/^[+-]?\d{1,2}(:?\d{2})?$/.test(body.tz)) { Panel.err('zona horaria: usá -03:00 o +0200'); return; }
          Panel.err('guardando…');
          const r2 = await api('/api/settings/values', body);
          if (!r2.ok) { Panel.err(r2.data.error || ('error ' + r2.status)); return; }
          Panel.close(); add('meta', '⚙ configuración guardada'); loadSched(); loadApprovals();
        };
      }
    }
  });
}
$('#cfgBtn').onclick = () => openCfg('general');
if (location.hash === '#config') setTimeout(() => openCfg('general'), 400);
