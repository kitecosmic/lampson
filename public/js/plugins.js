// plugins.js — plugins (tools propias): pill en la cabecera + vista browse del Panel (lista, detalle con
// switch, tools con formulario generado del schema, correr, borrar) y la ayuda «?».
let pluginsData = [], pluginsMeta = { global: 'plugins/', project: '.lampson/plugins/' };
async function fetchPlugins() {
  let r; try { r = await (await fetch(BASE + '/api/plugins')).json(); } catch (e) { return pluginsData; }
  pluginsData = r.plugins || []; pluginsMeta = { global: r.global || 'plugins/', project: r.project || '.lampson/plugins/' };
  const on = pluginsData.filter(l => l.enabled).length;
  const pill = $('#plugins'); pill.textContent = pluginsData.length ? `plugins ${on}/${pluginsData.length}` : 'plugins'; pill.classList.toggle('on', on > 0);
  return pluginsData;
}
async function loadPlugins() { await fetchPlugins(); if (Panel.is('plugins')) Panel.refresh(); }
function pluginMatches(l, q) {
  if (!q) return true;
  const hay = [l.name, l.description || '', l.scope, l.kind, ...(l.tools || [])].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every(t => hay.includes(t));
}
function pluginField(k, p, required) {
  const def = p.default !== undefined ? p.default : ''; const req = required.includes(k) ? ' <span class="req">(obligatorio)</span>' : '';
  let input;
  if (Array.isArray(p.enum)) input = `<select data-k="${esc(k)}">${p.enum.map(v => `<option value="${esc(String(v))}" ${String(v) === String(def) ? 'selected' : ''}>${esc(String(v))}</option>`).join('')}</select>`;
  else if (p.type === 'boolean') input = `<select data-k="${esc(k)}"><option value="false" ${def === true ? '' : 'selected'}>no</option><option value="true" ${def === true ? 'selected' : ''}>sí</option></select>`;
  else if (p.type === 'object' || p.type === 'array') input = `<textarea data-k="${esc(k)}" data-json="1" spellcheck="false" placeholder="JSON">${esc(def === '' ? (p.type === 'array' ? '[]' : '{}') : JSON.stringify(def, null, 1))}</textarea>`;
  else input = `<input data-k="${esc(k)}" type="${p.type === 'integer' || p.type === 'number' ? 'number' : 'text'}" value="${esc(String(def))}" placeholder="${esc(p.type || 'texto')}">`;
  return `<label class="lf"><span class="lk">${esc(k)}${req}</span>${input}${p.description ? `<span class="ds">${esc(p.description)}</span>` : ''}</label>`;
}
// lee los campos de una tool → args (o {error})
function pluginArgs(tdiv, props, required) {
  const args = {};
  for (const el of tdiv.querySelectorAll('[data-k]')) {
    const k = el.dataset.k, p = props[k] || {}; let v = el.value;
    if (el.dataset.json) { if (!v.trim()) continue; try { v = JSON.parse(v); } catch (e) { return { error: `${k}: JSON inválido` }; } }
    else if (p.type === 'boolean') v = v === 'true';
    else if (p.type === 'integer' || p.type === 'number') { if (v === '') { if (required.includes(k)) return { error: `${k} es obligatorio` }; continue; } v = Number(v); }
    else if (v === '') { if (required.includes(k)) return { error: `${k} es obligatorio` }; continue; }
    args[k] = v;
  }
  return { args };
}
const PLUGINS_HELP = `<h4>Herramientas hechas a medida para este proyecto</h4>
  <p>Un plugin es una tool que el agente (o vos) escribe para <em>este</em> repo: una carpeta con <code>plugin.json</code> y el código — en Synsema (corre bajo un techo de capacidades que no puede superar) o en cualquier lenguaje (<code>python</code>, <code>node</code>, un binario). A diferencia de un script suelto, el modelo lo ve en su catálogo con parámetros tipados, vos lo podés correr desde acá, y queda en el repo para la próxima sesión.</p>
  <p><b>Pedilo en el chat</b> — <i>«hacé un plugin que liste los endpoints del backend»</i>. El agente lo escribe en <code data-project></code>, lo valida y te pide encenderlo acá.</p>
  <p><b>Encendido = existe</b> — apagado, el agente ni lo ve. Al encenderlo, sus tools entran al catálogo como <code>plugin_&lt;plugin&gt;_&lt;tool&gt;</code> desde el próximo turno. Los globales viven en <code data-global></code> y valen para todos los proyectos.</p>
  <p><b>Ejemplos</b></p>
  <ul>
    <li><b>Consultas del proyecto</b> — <code>endpoints()</code> que parsea tus rutas y devuelve método + path + handler; <code>env_keys()</code> usadas vs. definidas en <code>.env.example</code>.</li>
    <li><b>Generadores con tus convenciones</b> — <code>new_component(name)</code> que crea el <code>.tsx</code> + test + story con tu plantilla exacta.</li>
    <li><b>Checkers</b> — <code>check_i18n()</code> claves faltantes por idioma; <code>lint_styles()</code> colores hardcodeados fuera de tus tokens.</li>
    <li><b>Datos locales</b> — <code>db_schema()</code> / <code>query(sql)</code> contra tu SQLite con techo <code>db=./dev.db</code>.</li>
    <li><b>Integraciones sin MCP</b> — <code>deploy_status()</code> contra tu API con techo <code>net=api.x.com</code>.</li>
  </ul>
  <p>¿Querés herramientas con techo real, versionadas y compartidas entre agentes (Claude Code, Cursor, lampson…)? Eso son las <a href="https://lamps.sh" target="_blank" rel="noopener">lámparas de lamps.sh</a>: se instalan con <code>lamp add</code> y entran acá como servidor MCP (<code>lamp mcp</code>).</p>
  <p><button class="primary" data-back>← volver a los plugins</button></p>`;
function openPlugins(selectName) {
  let first = selectName || null;
  Panel.open({
    id: 'plugins', eyebrow: 'plugins', title: 'Plugins', layout: 'browse',
    headActions: [{ label: '?', title: '¿qué es un plugin?', onClick: (b) => { Panel.help(true); const h = b.querySelector('.phelp'); h.querySelector('[data-project]').textContent = pluginsMeta.project; h.querySelector('[data-global]').textContent = pluginsMeta.global; h.querySelector('[data-back]').onclick = () => Panel.help(false); } }],
    browse: {
      placeholder: 'buscar plugin o tool…', listWidth: '260px', help: PLUGINS_HELP,
      key: l => l.name,
      load: async (q) => { const all = await fetchPlugins(); const list = all.filter(l => pluginMatches(l, q)); if (first) { const i = list.findIndex(l => l.name === first); first = null; if (i > 0) list.unshift(list.splice(i, 1)[0]); } return list; },
      render: (l) => `<span class="dot">${l.error ? '!' : (l.enabled ? '●' : '○')}</span><div><div class="nm">${esc(l.name)}</div><div class="meta">${esc(l.scope)} · ${esc(l.kind)} · ${(l.tools || []).length} tool${(l.tools || []).length === 1 ? '' : 's'}${l.error ? ' · roto' : ''}${l.legacy ? ' · carpeta vieja' : ''}</div></div>`,
      count: (rows, q) => q ? `${rows.length} de ${pluginsData.length}` : `${pluginsData.length} plugin${pluginsData.length === 1 ? '' : 's'}`,
      emptyHtml: 'ninguno todavía',
      emptyDetail: `Todavía no hay plugins.<br><br>Pedile uno al agente en el chat — <i>«hacé un plugin que liste los endpoints del backend»</i> — o creá una carpeta con <code>plugin.json</code> en <code>${esc(pluginsMeta.project)}</code> (proyecto) o <code>${esc(pluginsMeta.global)}</code> (global). El botón <b>?</b> de arriba explica qué son y para qué sirven.`,
      detail: (l) => {
        const specs = l.tool_specs || [];
        const cap = l.error ? `<div class="dcap err">roto: ${esc(l.error)}</div>` : (l.kind === 'syn' ? `<div class="dcap">techo de capacidades: ${esc(l.caps)}</div>` : `<div class="dcap"><b>sin techo</b> (exec) · $ ${esc(l.command)}</div>`);
        const legacy = l.legacy ? `<div class="dnote">Carpeta vieja: vive en <code>.lampson/lamps/</code>. Sigue funcionando, pero renombrala a <code>.lampson/plugins/</code> (y <code>lamp.json</code> a <code>plugin.json</code>); las variables <code>LAMP_*</code> siguen llegando por ahora.</div>` : '';
        return `<div class="dhead"><span class="nm">${esc(l.name)}</span><span class="meta">${esc(l.scope)} · ${esc(l.kind)}</span><label class="sw ${l.enabled ? 'on' : ''}" title="${l.error ? 'no se puede encender: está roto' : (l.enabled ? 'apagar' : 'encender')}"><input type="checkbox" ${l.enabled ? 'checked' : ''} ${l.error ? 'disabled' : ''}>${l.enabled ? 'encendido' : 'apagado'}</label></div>`
          + (l.description ? `<div class="ddesc">${esc(l.description)}</div>` : '') + cap + legacy
          + (l.enabled || l.error ? '' : `<div class="dnote">Apagado: el agente no lo ve y no se puede correr. Encendelo con el switch — el código va a poder ejecutarse${l.kind === 'exec' ? ' <b>sin techo de capacidades</b> (es un ejecutable)' : ' bajo el techo de arriba'}.</div>`)
          + specs.map((t, i) => {
              const props = (t.parameters && t.parameters.properties) || {}; const required = (t.parameters && t.parameters.required) || [];
              return `<div class="tool" data-i="${i}"><div class="th"><code>${esc(t.name)}</code>${t.description ? `<span class="ds">${esc(t.description)}</span>` : '<span></span>'}<span class="ds">plugin_${esc(l.name)}_${esc(t.name)}</span></div>`
                + (Object.keys(props).length ? Object.keys(props).map(k => pluginField(k, props[k], required)).join('') : '<div class="ds" style="margin-top:6px;color:var(--ink-3)">no toma parámetros</div>')
                + (l.enabled ? `<div class="go"><button class="primary run">▶ correr</button><span class="st"></span></div><pre class="out" style="display:none"></pre>` : '')
                + `</div>`;
            }).join('')
          + `<div class="dfoot"><span>${esc(l.dir || '')}</span>${l.scope === 'project' ? '<span class="del">eliminar</span>' : '<span title="los globales se borran a mano">global · se borra a mano</span>'}</div><div class="err" data-err></div>`;
      },
      wire: (l, box) => {
        const errEl = box.querySelector('[data-err]');
        box.querySelector('.sw input').onchange = async (ev) => {
          errEl.textContent = '';
          const r = await api(BASE + '/api/plugins/toggle', { name: l.name, enabled: ev.target.checked });
          if (!r.ok) { errEl.textContent = r.data.error || ('error ' + r.status); ev.target.checked = !ev.target.checked; return; }
          add('meta', '☼ ' + esc(r.data.result || '')); loadPlugins(); loadSched();
        };
        for (const tdiv of box.querySelectorAll('.tool')) {
          const t = (l.tool_specs || [])[Number(tdiv.dataset.i)]; const props = (t.parameters && t.parameters.properties) || {}; const required = (t.parameters && t.parameters.required) || [];
          const b = tdiv.querySelector('button.run'); if (!b) continue;
          b.onclick = async () => {
            const st = tdiv.querySelector('.st'), out = tdiv.querySelector('.out'); const got = pluginArgs(tdiv, props, required);
            if (got.error) { st.textContent = got.error; return; }
            st.textContent = 'corriendo…'; out.style.display = 'none'; b.disabled = true;
            const r = await api(BASE + '/api/plugins/run', { tool: 'plugin_' + l.name + '_' + t.name, args: got.args });
            st.textContent = r.ok ? '' : (r.data.error || 'error ' + r.status);
            if (r.ok) { out.textContent = r.data.output; out.style.display = ''; }
            b.disabled = false;
          };
        }
        const del = box.querySelector('.dfoot .del');
        if (del) del.onclick = () => inlineConfirm(del, `¿borrar ${l.name} del disco?`, async () => {
          const r = await api(BASE + '/api/plugins/remove', { name: l.name });
          if (!r.ok) { errEl.textContent = r.data.error || ('error ' + r.status); return; }
          add('meta', '☼ ' + esc(r.data.result || '')); loadPlugins();
        });
      }
    }
  });
}
$('#plugins').onclick = () => openPlugins();
if (location.hash === '#plugins' || location.hash === '#lamps') setTimeout(() => openPlugins(), 400); // deep link: abre el panel al cargar
