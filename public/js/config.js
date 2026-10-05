// config.js — configuración (⚙) y proveedor/modelo/key: UNA vista browse del Panel. Secciones a la izquierda
// (General · Aprobaciones a distancia · … · Proveedor · Apagar o reiniciar), su formulario a la derecha. Cada cosa configurable nueva
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
  { id: 'computer', name: 'Computer use', meta: 'escritorio y navegador · driver aparte' },
  { id: 'judge', name: 'Juez de decisión', meta: 'Jev · Laya · decisiones rápidas con probabilidades' },
  { id: 'provider', name: 'Proveedor', meta: 'modelo · API key' },
  { id: 'power', name: 'Apagar o reiniciar', meta: 'Lampson entero · hub y workspaces' }
];
function cfgField(v, key, label, placeholder, ds, type) {
  return `<label class="col">${label}<input name="${key}" type="${type || 'text'}" spellcheck="false" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(v[key] || '')}" ${v[key + '_from_env'] ? 'disabled title="fijado en .env (LAMPSON_' + key.toUpperCase() + '): editalo ahí"' : ''}><span class="ds">${ds}</span></label>`;
}
// juez de decisión (lib/judge.syn): un modelo System One que contesta con probabilidades — una credencial de
// Lampson, no de computer use (hoy lo usa la acción `act`). Jev (TypeSafe, nube, key) o Laya (local, carpeta).
function judgeMode(v) { const m = (v.judge || v.computer_judge || '').toLowerCase(); return m === 'jev' || m === 'laya' ? m : 'off'; }
function judgeHtml(v) {
  const mode = judgeMode(v);
  const opt = (val, txt) => `<option value="${val}" ${mode === val ? 'selected' : ''}>${txt}</option>`;
  return `<label class="col">juez<select name="judge" ${v.judge_from_env ? 'disabled title="fijado en .env (LAMPSON_JUDGE): editalo ahí"' : ''}>${opt('off', 'apagado')}${opt('jev', 'Jev — TypeSafe, en la nube (~0,3 s por decisión, con API key)')}${opt('laya', 'Laya — local, sin red ni costo (~1-2 s por decisión en CPU)')}</select><span class="ds">Jev es rápido, entiende español e inglés y necesita una API key de <a href="https://console.typesafe.ai/" target="_blank" rel="noopener">TypeSafe</a> · Laya corre en tu máquina sin mandar nada afuera, pero es chico: con interfaces en español se equivoca más</span></label>
    <div class="jd-jev" ${mode === 'jev' ? '' : 'hidden'}><label class="col">API key de TypeSafe<input name="typesafe_key" type="password" spellcheck="false" autocomplete="off" placeholder="${v.has_typesafe_key ? '● guardada — pegá una nueva para cambiarla' : 'pegala acá (console.typesafe.ai)'}"><span class="ds">queda en <code>lampson/.lampson/config.json</code> con las demás keys; nunca vuelve al navegador</span></label></div>
    <div class="jd-laya" ${mode === 'laya' ? '' : 'hidden'}><label class="col">carpeta del checkpoint de Laya<input name="judge_model" type="text" spellcheck="false" autocomplete="off" placeholder="C:\\Users\\vos\\models\\laya" value="${esc(v.judge_model || v.computer_judge_model || '')}"><span class="ds">la carpeta con <code>model.safetensors</code>, <code>encoder/</code> y <code>tokenizer/</code> (~840 MB, <a href="https://huggingface.co/convaiinnovations/laya" target="_blank" rel="noopener">convaiinnovations/laya</a>) · Lampson no la descarga</span></label></div>
    <div class="ds" id="jdStatus"></div>`;
}
function judgeStatusHtml(j) {
  if (!j) return '';
  if (j.mode === 'off') return '○ sin juez';
  if (j.live && !j.restart) return `● juez ${esc(j.mode)} activo${j.provider_model ? ' · ' + esc(j.provider_model) : ''}`;
  return `▲ configurado (${esc(j.mode)}) pero este proceso todavía no lo tiene — tocá Guardar (el workspace se reinicia solo)${j.mode === 'jev' && !j.has_key ? ' · falta la API key' : ''}${j.mode === 'laya' && !j.model_setting ? ' · falta la carpeta del checkpoint' : ''}`;
}
// interruptor visible (pill con perilla): el texto cambia con el estado; fijado en .env queda deshabilitado
function toggleHtml(name, on, fromEnv, envName, onText, offText) {
  return `<label class="toggle ${on ? 'on' : ''}" title="${fromEnv ? 'fijado en .env (' + envName + '): editalo ahí' : ''}"><input type="checkbox" name="${name}" ${on ? 'checked' : ''} ${fromEnv ? 'disabled' : ''}><span class="knob"></span><span class="tx" data-on="${esc(onText)}" data-off="${esc(offText)}">${on ? esc(onText) : esc(offText)}</span></label>`;
}
function paintToggle(lab) { const on = lab.querySelector('input').checked; const tx = lab.querySelector('.tx'); lab.classList.toggle('on', on); if (tx) tx.textContent = on ? tx.dataset.on : tx.dataset.off; }
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
        // computer use (lib/computer.syn): un switch, el estado del driver (o cómo instalarlo) y sus dos knobs
        if (s.id === 'computer') return `<div class="dhead"><span class="nm serif">Computer use</span>${toggleHtml('computer_use', v.computer_use, v.computer_use_from_env, 'LAMPSON_COMPUTER_USE', 'encendido', 'apagado')}</div><div class="dform"><p class="lead">El agente maneja tu escritorio y tu navegador <b>en segundo plano</b>: ve las ventanas, hace clic, escribe y navega sin moverte el mouse ni robarte el foco. Usa un <b>driver aparte</b> que Lampson no instala: encendé el interruptor y, si falta, acá abajo aparece el comando para instalarlo. Apagado, el agente ni ve la tool.</p>
          <div class="cu-status" id="cuStatus"><span class="ds">comprobando el driver…</span></div>`
          + cfgField(v, 'computer_max_tabs', 'pestañas como máximo', '5', 'cuántas pestañas distintas puede manejar el agente por corrida · los atajos que abren pestañas (ctrl+t…) se rechazan siempre: navega en la misma pestaña, y busca en la web con fetch (sin abrir nada)')
          + `<div class="trow">${toggleHtml('computer_grant_profile', v.computer_grant_profile, v.computer_grant_profile_from_env, 'LAMPSON_COMPUTER_GRANT_PROFILE', 'usa mi navegador abierto (sesión iniciada)', 'navegador aparte, sin mis cookies')}<span class="ds">encendido (recomendado): el agente se ata a tu Chrome/Edge abierto y maneja páginas con precisión (formularios, desplegables) con tus sesiones; abre su propia ventana y no toca tus pestañas — puede ver páginas, cookies y sesiones de ese perfil · apagado: navegador aparte con perfil propio, sin tus cookies · aplica al reiniciar Lampson</span></div>`
          + `<div class="trow"><span class="ds">juez de decisión (acción «act»: elige los clics con probabilidades, sin gastar turnos del modelo): <span id="cuJudge">…</span> · se configura en <a href="#" data-goto-judge>⚙ Juez de decisión</a></span></div>`
          + `<div class="pfoot"><button class="primary" data-save-computer>Guardar</button><span class="derr"></span></div></div>`;
        if (s.id === 'judge') return `<div class="dhead"><span class="nm serif">Juez de decisión</span></div><div class="dform"><p class="lead">Un modelo chico que contesta <b>con probabilidades, no con texto</b>: elige una opción de una lista, dice si algo aplica o puntúa en una escala, en menos de un segundo. Es una credencial de Lampson, como el proveedor: hoy la usa <b>computer use</b> (elige en qué control hacer clic sin gastar un turno del modelo principal) y la van a poder usar otras partes que necesiten decidir rápido.</p>`
          + judgeHtml(v)
          + `<div class="pfoot"><button class="primary" data-save-judge>Guardar</button><span class="derr"></span></div></div>`;
        // Lampson entero (hub + workspaces): reiniciar o apagar. Apagar un workspace solo es en la lista de workspaces
        if (s.id === 'power') return `<div class="dhead"><span class="nm serif">Apagar o reiniciar</span></div><div class="dform"><p class="lead">Lampson entero: el hub (<code>localhost:8080</code>) y todos los workspaces. Apagar <b>un</b> workspace se hace en su tarjeta, en la lista de workspaces; el hub queda prendido para encender los demás.</p>
          <div class="trow"><button class="hbtn pwr" data-reboot>⟳ reiniciar Lampson</button><span class="ds">para todo y lo vuelve a arrancar con el código que hay en disco (por ejemplo, después de actualizar). Se cortan las terminales, los procesos que lanzó el agente y los turnos en curso; las sesiones quedan guardadas. La página vuelve sola en unos segundos.</span></div>
          <div class="trow"><button class="hbtn pwr danger" data-shutdown>■ apagar Lampson</button><span class="ds">para el hub y todos los workspaces: esta página deja de responder. Para volver: <code>lampson --hub start</code> en una terminal (o <code>lampson</code> dentro de un proyecto). Si lo instalaste con <code>lampson --install</code>, arranca solo al iniciar sesión; para que no lo haga más, <code>lampson --uninstall</code>. <span data-remote-note hidden>Solo desde la PC donde corre: desde acá no podrías volver a encenderlo.</span></span></div>
          <span class="derr"></span></div>`;
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
        const saveC = box.querySelector('[data-save-computer]');
        if (saveC) {
          const paintStatus = (st, code) => {
            const el = box.querySelector('#cuStatus'); if (!el) return;
            if (!st) { el.innerHTML = `<span class="ds">no pude consultar el estado del driver${code ? ' (HTTP ' + code + ')' : ''} — si acabás de actualizar Lampson, reinicialo (<code>lampson --hub restart</code>) y volvé a abrir esta ventana</span>`; return; }
            if (!st.installed) {
              el.innerHTML = `<div class="cu-line no">○ driver no instalado</div><p class="ds">Es un paquete aparte (<a href="${esc(st.install.docs)}" target="_blank" rel="noopener">cua.ai</a>): instalalo vos en una terminal y después tocá «comprobar de nuevo».</p><pre class="cu-cmd">${esc(st.install.command)}\n${esc(st.install.then)}</pre><button class="hbtn sm" data-recheck>comprobar de nuevo</button>`;
            } else {
              const bad = (st.checks || []).filter(c => c.status !== 'ok' && c.status !== 'skip');
              el.innerHTML = `<div class="cu-line ${st.ok ? 'ok' : 'warn'}">${st.ok ? '●' : '▲'} driver ${esc(st.version)} <span class="ds">${esc(st.path)}</span></div>`
                + (bad.length ? `<ul class="ds">${bad.map(c => `<li>${esc(c.label)}: ${esc(c.message)}</li>`).join('')}</ul>` : '')
                + `<p class="ds">${st.running ? 'conectado' : 'arranca con la primera acción del agente'} · ${st.enabled ? 'la tool está en el catálogo del agente' : 'apagado: el agente no ve la tool'}${st.driver_error ? ' · ' + esc(st.driver_error) : ''}</p><button class="hbtn sm" data-recheck>comprobar de nuevo</button>`;
            }
            const rc = el.querySelector('[data-recheck]'); if (rc) rc.onclick = () => load();
            const jd = box.querySelector('#cuJudge'); if (jd && st.judge) jd.innerHTML = judgeStatusHtml(st.judge);
          };
          const load = async () => { try { const r = await fetch(BASE + '/api/computer'); if (!r.ok) { paintStatus(null, r.status); return; } paintStatus(await r.json()); } catch (e) { paintStatus(null, 0); } };
          load();
          // el interruptor principal guarda al instante (como el de los plugins); el del navegador y las pestañas, con Guardar
          const sw = box.querySelector('[name="computer_use"]');
          if (sw) sw.onchange = async () => {
            const lab = sw.closest('label'); paintToggle(lab); sw.disabled = true; err(sw.checked ? 'encendiendo…' : 'apagando…');
            try {
              const r2 = await api(BASE + '/api/computer', { enabled: sw.checked });
              if (!r2.ok) { sw.checked = !sw.checked; paintToggle(lab); err(r2.data.error || ('error ' + r2.status)); return; }
              v.computer_use = sw.checked ? '1' : ''; err(sw.checked ? '✓ encendido' : '✓ apagado'); add('meta', '⚙ computer use ' + (sw.checked ? 'encendido' : 'apagado')); paintStatus(r2.data.status);
            } catch (e) { sw.checked = !sw.checked; paintToggle(lab); err(e.message); } finally { sw.disabled = false; }
          };
          const gp = box.querySelector('[name="computer_grant_profile"]');
          if (gp) gp.onchange = () => paintToggle(gp.closest('label'));
          const gj = box.querySelector('[data-goto-judge]'); if (gj) gj.onclick = (e) => { e.preventDefault(); openCfg('judge'); };
          saveC.onclick = async () => {
            const body = {};
            const mt = box.querySelector('[name="computer_max_tabs"]'); if (mt && !mt.disabled) { if (mt.value.trim() && !/^[0-9]+$/.test(mt.value.trim())) { err('pestañas: un número entero'); return; } body.max_tabs = mt.value.trim(); }
            if (gp && !gp.disabled) body.grant_profile = gp.checked;
            err('guardando…'); saveC.disabled = true;
            try {
              const r2 = await api(BASE + '/api/computer', body);
              if (!r2.ok) { err(r2.data.error || ('error ' + r2.status)); return; }
              if (body.grant_profile !== undefined) v.computer_grant_profile = body.grant_profile ? '1' : '';
              if (body.max_tabs !== undefined) v.computer_max_tabs = body.max_tabs;
              err('✓ guardado'); paintStatus(r2.data.status);
            } catch (e) { err(e.message); } finally { saveC.disabled = false; }
          };
        }
        const saveJ = box.querySelector('[data-save-judge]');
        if (saveJ) {
          const js = box.querySelector('[name="judge"]');
          const paintJ = (j) => { const el = box.querySelector('#jdStatus'); if (el) el.innerHTML = judgeStatusHtml(j); if (j) { v.has_typesafe_key = j.has_key; const tk = box.querySelector('[name="typesafe_key"]'); if (tk) tk.placeholder = j.has_key ? '● guardada — pegá una nueva para cambiarla' : 'pegala acá (console.typesafe.ai)'; } };
          fetch(BASE + '/api/judge').then(r => r.ok ? r.json() : null).then(paintJ).catch(() => {});
          if (js) js.onchange = () => { box.querySelector('.jd-jev').hidden = js.value !== 'jev'; box.querySelector('.jd-laya').hidden = js.value !== 'laya'; };
          saveJ.onclick = async () => {
            const body = {};
            if (js && !js.disabled) body.mode = js.value;
            const jmod = box.querySelector('[name="judge_model"]'); if (jmod && js && js.value === 'laya') body.model = jmod.value.trim();
            const tkey = box.querySelector('[name="typesafe_key"]'); if (tkey && tkey.value.trim()) body.typesafe_key = tkey.value.trim();
            if (body.mode === 'laya' && !body.model) { err('Laya: poné la carpeta del checkpoint'); return; }
            if (body.mode === 'jev' && !v.has_typesafe_key && !body.typesafe_key) { err('Jev: pegá la API key de TypeSafe'); return; }
            const changed = body.mode !== judgeMode(v) || !!body.typesafe_key || (body.model !== undefined && body.model !== (v.judge_model || v.computer_judge_model || ''));
            if (!changed) { err('sin cambios'); return; }
            err('guardando…'); saveJ.disabled = true;
            try {
              const r2 = await api(BASE + '/api/judge', body);
              if (!r2.ok) { err(r2.data.error || ('error ' + r2.status)); return; }
              v.judge = body.mode === 'off' ? '' : body.mode; if (body.model !== undefined) v.judge_model = body.model;
              if (tkey) tkey.value = '';
              if (r2.data.restarting) {
                // el juez se lee al arrancar: el workspace se reinicia solo; esperar a que vuelva y recargar
                err('✓ guardado · reiniciando el workspace para aplicarlo…'); add('meta', '⚙ juez de decisión: ' + body.mode + ' · reiniciando el workspace');
                const t0 = Date.now(); await new Promise(r => setTimeout(r, 3500));
                while (Date.now() - t0 < 30000) { try { const r = await fetch(BASE + '/api/judge'); if (r.ok) { location.reload(); return; } } catch (e) {} await new Promise(r => setTimeout(r, 1000)); }
                err('el workspace tarda en volver: recargá la página'); return;
              }
              err('✓ guardado'); paintJ(r2.data.status);
            } catch (e) { err(e.message); } finally { saveJ.disabled = false; }
          };
        }
        const reboot = box.querySelector('[data-reboot]');
        if (reboot) {
          const off = box.querySelector('[data-shutdown]');
          fetch('/api/hub').then(r => r.ok ? r.json() : null).then(h => { if (h && h.local === false) { off.disabled = true; box.querySelector('[data-remote-note]').hidden = false; } }).catch(() => {});
          reboot.onclick = () => inlineConfirm(reboot, '¿reiniciar todo?', async () => {
            reboot.disabled = off.disabled = true; err('reiniciando Lampson…');
            const r2 = await api('/api/hub/restart', {});
            if (!r2.ok) { reboot.disabled = false; err(r2.data.error || ('error ' + r2.status)); return; }
            add('meta', '⚙ reiniciando Lampson');
            // el hub tarda en morir (1,5 s) y en volver: esperar a que caiga y a que conteste otra vez
            const t0 = Date.now(); let down = false;
            while (Date.now() - t0 < 60000) {
              await new Promise(r => setTimeout(r, 1000));
              let up = false; try { up = (await fetch('/api/hub', { cache: 'no-store' })).ok; } catch (e) {}
              if (!up) down = true; else if (down) { location.reload(); return; }
            }
            err('Lampson tarda en volver: recargá la página, o en una terminal lampson --hub status');
          });
          off.onclick = () => inlineConfirm(off, '¿apagar Lampson?', async () => {
            reboot.disabled = off.disabled = true; err('apagando…');
            const r2 = await api('/api/hub/shutdown', {});
            if (!r2.ok) { reboot.disabled = false; off.disabled = false; err(r2.data.error || ('error ' + r2.status)); return; }
            add('meta', '⚙ Lampson apagado — para volver: lampson --hub start');
            err('✓ apagado en unos segundos · para volver: lampson --hub start');
          });
        }
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
