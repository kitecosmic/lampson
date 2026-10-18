// plugins.js — plugins (tools propias): pill en la cabecera + vista browse del Panel (lista, detalle con
// switch, tools con formulario generado del schema, correr, borrar) y la ayuda «?».
let pluginsData = [], pluginsMeta = { global: 'plugins/', project: '.lampson/plugins/' };
async function fetchPlugins() {
  let r; try { r = await (await fetch(BASE + '/api/plugins')).json(); } catch (e) { return pluginsData; }
  pluginsData = (r.plugins || []).filter(l => !l.example || l.enabled); pluginsMeta = { global: r.global || 'plugins/', project: r.project || '.lampson/plugins/' };
  const on = pluginsData.filter(l => l.enabled).length;
  const pill = $('#plugins'); pill.textContent = pluginsData.length ? `plugins ${on}/${pluginsData.length}` : 'plugins'; pill.classList.toggle('on', on > 0);
  pill.title = pluginsData.length ? `${on} de ${pluginsData.length} plugins instalados encendidos en este proyecto · clic para ver qué hace cada uno y encender los que quieras` : 'plugins: tools propias que vos encendés · clic para ver y activar';
  paintPlugHint();
  return pluginsData;
}
// en la portada del proyecto: los plugins instalados que acá están apagados (sin los de ejemplo ni los rotos). Sin
// esto, quien no sabe que existen cree que el agente «no puede» mandar un Telegram o tomar un pedido. Encender
// sigue siendo decisión de la persona: la pista solo abre el panel.
function paintPlugHint() {
  const el = $('#plugHint'); if (!el) return;
  const off = pluginsData.filter(l => !l.enabled && !l.error);
  el.hidden = !off.length; if (!off.length) return;
  const names = off.slice(0, 3).map(l => `<b>${esc(l.name)}</b>`).join(', ') + (off.length > 3 ? ` y ${off.length - 3} más` : '');
  el.innerHTML = `⧉ ${off.length === 1 ? 'Hay un plugin instalado que este proyecto no tiene encendido' : `Hay ${off.length} plugins instalados que este proyecto no tiene encendidos`}: ${names}. <span class="try">ver qué hacen →</span>`;
  el.querySelector('.try').onclick = () => openPlugins(off[0].name);
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
// la ayuda del «?» es corta y lleva a la acción (un pedido listo para el chat); lo largo vive en la guía del sitio
const PLUGINS_DOCS = 'https://lampson.org/es/docs/plugins';
const PLUGIN_PROMPT = 'Hacé un plugin para este proyecto que liste los endpoints del backend: método, path y handler. Validalo y pedime que lo encienda.';
const PLUGINS_HELP = `<h4>Herramientas hechas a medida para este proyecto</h4>
  <p>Un plugin es una tool nueva que el agente ve en su catálogo, con parámetros tipados: una carpeta con <code>plugin.json</code> y el código, en Synsema (con un techo de capacidades que no puede superar) o en cualquier lenguaje. Queda en el repo para la próxima sesión y lo podés correr vos desde acá.</p>
  <div class="pprompt"><b>Pedíselo al agente</b><p>${esc(PLUGIN_PROMPT)}</p><div class="pacts"><button class="primary" data-use>Escribirlo en el chat</button><button data-copy>Copiar</button><span class="ds" data-copied></span></div></div>
  <p><b>Encendido = existe.</b> Apagado, el agente ni lo ve; encendido, sus tools entran al catálogo como <code>plugin_&lt;plugin&gt;_&lt;tool&gt;</code> desde el próximo turno. Los de este proyecto viven en <code data-project></code>; los globales, en <code data-global></code>, y valen para todos los proyectos.</p>
  <p><b>Otras ideas:</b> <code>check_i18n()</code> con las claves que faltan por idioma, <code>db_schema()</code> y <code>query(sql)</code> contra tu SQLite de desarrollo, <code>new_component(name)</code> con tu plantilla exacta, <code>deploy_status()</code> contra tu API.</p>
  <p class="plinks"><a href="${PLUGINS_DOCS}" target="_blank" rel="noopener">Guía completa de plugins</a><span data-all-wrap> · <a data-all>Todos los plugins instalados</a></span> · <a href="https://lamps.sh" target="_blank" rel="noopener">lamps.sh</a>, para herramientas compartidas entre agentes</p>
  <p><button data-back>← volver a los plugins</button></p>`;
// el «?» abre la ayuda y engancha sus botones (rutas reales, pedido al chat, enlace al hub)
function wirePluginsHelp(b) {
  Panel.help(true);
  const h = b.querySelector('.phelp');
  h.querySelector('[data-project]').textContent = shortPath(pluginsMeta.project); h.querySelector('[data-global]').textContent = shortPath(pluginsMeta.global);
  h.querySelector('[data-back]').onclick = () => Panel.help(false);
  h.querySelector('[data-use]').onclick = () => { Panel.close(); const ta = $('#in'); if (!ta) return; ta.value = PLUGIN_PROMPT; ta.dispatchEvent(new Event('input')); ta.focus(); };
  h.querySelector('[data-copy]').onclick = async () => { const ok = h.querySelector('[data-copied]'); try { await navigator.clipboard.writeText(PLUGIN_PROMPT); ok.textContent = 'copiado'; } catch (e) { ok.textContent = 'no se pudo copiar'; } };
  if (BASE) h.querySelector('[data-all]').href = HUB_BASE + '/plugins'; else h.querySelector('[data-all-wrap]').remove();
}
function openPlugins(selectName) {
  let first = selectName || null;
  Panel.open({
    id: 'plugins', eyebrow: 'plugins', title: 'Plugins', layout: 'browse',
    // «todos los plugins» = la pantalla del hub (/plugins): qué hay instalado y en qué proyectos está encendido
    headActions: [...(BASE ? [{ label: 'todos los plugins', href: HUB_BASE + '/plugins', title: 'los plugins de todos tus proyectos y dónde está encendido cada uno' }] : []), { label: '?', title: '¿qué es un plugin?', onClick: wirePluginsHelp }],
    browse: {
      placeholder: 'buscar plugin o tool…', listWidth: '260px', help: PLUGINS_HELP,
      key: l => l.name,
      load: async (q) => { const all = await fetchPlugins(); const list = all.filter(l => pluginMatches(l, q)); if (first) { const i = list.findIndex(l => l.name === first); first = null; if (i > 0) list.unshift(list.splice(i, 1)[0]); } return list; },
      render: (l) => `<span class="dot">${l.error ? '!' : (l.enabled ? '●' : '○')}</span><div><div class="nm">${esc(l.name)}</div><div class="meta">${esc(l.scope)} · ${esc(l.kind)} · ${(l.tools || []).length} tool${(l.tools || []).length === 1 ? '' : 's'}${l.error ? ' · roto' : ''}${l.legacy ? ' · carpeta vieja' : ''}</div></div>`,
      count: (rows, q) => q ? `${rows.length} de ${pluginsData.length}` : `${pluginsData.length} plugin${pluginsData.length === 1 ? '' : 's'}`,
      emptyHtml: 'ninguno todavía',
      emptyDetail: `Todavía no hay plugins.<br><br>Pedile uno al agente en el chat — <i>«hacé un plugin que liste los endpoints del backend»</i> — o creá una carpeta con <code>plugin.json</code> en <code>${esc(shortPath(pluginsMeta.project))}</code> (proyecto) o <code>${esc(shortPath(pluginsMeta.global))}</code> (global). El botón <b>?</b> de arriba explica qué son y para qué sirven.`,
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
          + `<div class="dfoot"><span>${esc(shortPath(l.dir))}</span>${l.scope === 'project' ? '<span class="del">eliminar</span>' : '<span title="los globales se borran a mano">global · se borra a mano</span>'}</div><div class="err" data-err></div>`;
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
// deep link: abre el panel al cargar; #plugins=<nombre> (desde /plugins del hub, «usar en este proyecto») con ese plugin elegido
if (location.hash === '#plugins' || location.hash === '#lamps') setTimeout(() => openPlugins(), 400);
else if (location.hash.startsWith('#plugins=')) setTimeout(() => openPlugins(decodeURIComponent(location.hash.slice(9))), 400);
