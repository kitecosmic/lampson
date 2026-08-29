// setup.js — proveedor / modelo / API key (guardados en el servidor: .lampson/config.json; la key nunca vuelve)
let setupSel = '';
function paintModel() {
  const p = (cfg.providers || []).find(x => x.name === cfg.provider);
  $('#model').textContent = cfg.provider ? `${cfg.provider} · ${cfg.model || ''}` : '';
  $('#model').classList.toggle('nokey', !!p && !p.has_key);
  $('#model').style.display = cfg.provider ? '' : 'none';
}
function openSetup(onboarding) {
  setupSel = cfg.provider || (cfg.providers || [])[0]?.name || '';
  const rows = (cfg.providers || []).map(p => `<div class="pr ${p.name === setupSel ? 'on' : ''}" data-name="${esc(p.name)}"><b>${esc(p.name)}</b><span class="dm">${esc(p.model)}</span><span class="k ${p.has_key ? '' : 'no'}">${p.name === 'ollama' ? 'sin key' : (p.has_key ? '● key guardada' : '○ sin key')}</span></div>`).join('');
  Panel.open({
    id: 'setup', eyebrow: 'proveedor', title: onboarding ? 'Bienvenido a Lampson' : 'Modelo', layout: 'form', size: 'sm', noClose: onboarding,
    form: {
      focus: false,
      html: `<p class="lead">${onboarding ? 'Un agente con herramientas acotadas a este proyecto. Para empezar, elegí un proveedor y pegá su API key. Queda en <code>lampson/.lampson/config.json</code>, solo en esta máquina; nunca vuelve al navegador.' : 'Elegí con qué modelo trabaja el agente (vale para la web y la terminal). La API key queda en <code>lampson/.lampson/config.json</code>, solo en esta máquina; nunca vuelve al navegador.'}</p>
        <div class="plist">${rows}</div>
        <label>modelo <input name="model" spellcheck="false" autocomplete="off" list="modelList"></label>
        <label>API key <input name="key" type="password" spellcheck="false" autocomplete="off" placeholder="pegala acá"></label>
        <datalist id="modelList"></datalist>`,
      footer: `<button class="primary" data-save>Guardar</button>${onboarding ? '' : '<button data-cancel>Cancelar</button>'}`,
      wire: (b) => {
        const f = n => b.querySelector(`[name="${n}"]`);
        const fill = () => {
          const p = (cfg.providers || []).find(x => x.name === setupSel) || {};
          f('model').value = setupSel === cfg.provider ? (cfg.model || p.model || '') : (p.model || ''); f('model').placeholder = p.model || '';
          // modelos válidos según la API del proveedor (evita tipear "DeepSeek-V4-Pro" cuando la API quiere "deepseek-v4-pro")
          const dl = b.querySelector('#modelList'); dl.innerHTML = ''; f('model').title = '';
          if (p.has_key || setupSel === 'ollama') fetch('/api/models?provider=' + encodeURIComponent(setupSel)).then(r => r.json()).then(d => { if (setupSel !== p.name) return; if (d.error) { f('model').title = 'no pude listar modelos: ' + d.error; return; } dl.innerHTML = (d.models || []).map(m => `<option value="${esc(m)}">`).join(''); f('model').title = (d.models || []).length ? 'modelos disponibles: ' + d.models.join(', ') : ''; }).catch(() => {});
          f('key').value = ''; f('key').disabled = setupSel === 'ollama';
          f('key').placeholder = setupSel === 'ollama' ? 'ollama no necesita key' : (p.has_key ? 'hay una key guardada · pegá otra para reemplazarla' : 'pegala acá');
        };
        b.querySelectorAll('.pr').forEach(r => r.onclick = () => { setupSel = r.dataset.name; b.querySelectorAll('.pr').forEach(x => x.classList.toggle('on', x.dataset.name === setupSel)); fill(); });
        fill(); f('key').focus();
        f('key').addEventListener('keydown', e => { if (e.key === 'Enter') b.querySelector('[data-save]').click(); });
        const cancel = b.querySelector('[data-cancel]'); if (cancel) cancel.onclick = Panel.close;
        b.querySelector('[data-save]').onclick = async () => {
          const body = { provider: setupSel, model: f('model').value.trim() }; if (f('key').value.trim()) body.key = f('key').value.trim();
          const p = (cfg.providers || []).find(x => x.name === setupSel) || {};
          if (setupSel !== 'ollama' && !p.has_key && !body.key) { Panel.err('falta la API key'); return; }
          const btn = b.querySelector('[data-save]'); btn.disabled = true;
          try {
            const r = await api('/api/settings', body);
            if (!r.ok) { Panel.err(r.data.error || ('error ' + r.status)); return; }
            const d = r.data; cfg.providers = d.providers; cfg.provider = d.provider; cfg.model = d.model; cfg.vision = d.vision; cfg.configured = d.configured; paintModel(); paintAttach();
            Panel.close(); if (log.querySelector('.empty')) empty();
          } catch (e) { Panel.err(e.message); } finally { btn.disabled = false; }
        };
      }
    }
  });
}
$('#model').onclick = () => openSetup(false);
