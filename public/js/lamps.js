// lamps.js — lámparas (plugins de tools): pill en la cabecera + vista browse del Panel (lista, detalle con
// switch, tools con formulario generado del schema, correr, borrar) y la ayuda «?».
let lampsData = [], lampsMeta = { global: 'lamps/', project: '.lampson/lamps/' };
async function fetchLamps() {
  let r; try { r = await (await fetch(BASE + '/api/lamps')).json(); } catch (e) { return lampsData; }
  lampsData = r.lamps || []; lampsMeta = { global: r.global || 'lamps/', project: r.project || '.lampson/lamps/' };
  const on = lampsData.filter(l => l.enabled).length;
  const pill = $('#lamps'); pill.textContent = lampsData.length ? `lámparas ${on}/${lampsData.length}` : 'lámparas'; pill.classList.toggle('on', on > 0);
  return lampsData;
}
async function loadLamps() { await fetchLamps(); if (Panel.is('lamps')) Panel.refresh(); }
function lampMatches(l, q) {
  if (!q) return true;
  const hay = [l.name, l.description || '', l.scope, l.kind, ...(l.tools || [])].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every(t => hay.includes(t));
}
function lampField(k, p, required) {
  const def = p.default !== undefined ? p.default : ''; const req = required.includes(k) ? ' <span class="req">(obligatorio)</span>' : '';
  let input;
  if (Array.isArray(p.enum)) input = `<select data-k="${esc(k)}">${p.enum.map(v => `<option value="${esc(String(v))}" ${String(v) === String(def) ? 'selected' : ''}>${esc(String(v))}</option>`).join('')}</select>`;
  else if (p.type === 'boolean') input = `<select data-k="${esc(k)}"><option value="false" ${def === true ? '' : 'selected'}>no</option><option value="true" ${def === true ? 'selected' : ''}>sí</option></select>`;
  else if (p.type === 'object' || p.type === 'array') input = `<textarea data-k="${esc(k)}" data-json="1" spellcheck="false" placeholder="JSON">${esc(def === '' ? (p.type === 'array' ? '[]' : '{}') : JSON.stringify(def, null, 1))}</textarea>`;
  else input = `<input data-k="${esc(k)}" type="${p.type === 'integer' || p.type === 'number' ? 'number' : 'text'}" value="${esc(String(def))}" placeholder="${esc(p.type || 'texto')}">`;
  return `<label class="lf"><span class="lk">${esc(k)}${req}</span>${input}${p.description ? `<span class="ds">${esc(p.description)}</span>` : ''}</label>`;
}
// lee los campos de una tool → args (o {error})
function lampArgs(tdiv, props, required) {
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
const LAMPS_HELP = `<h4>Herramientas hechas a medida para este proyecto</h4>
  <p>Una lámpara es una tool que el agente (o vos) escribe para <em>este</em> repo: una carpeta con <code>lamp.json</code> y el código — en Synsema (corre bajo un techo de capacidades que no puede superar) o en cualquier lenguaje (<code>python</code>, <code>node</code>, un binario). A diferencia de un script suelto, el modelo la ve en su catálogo con parámetros tipados, vos la podés correr desde acá, y queda en el repo para la próxima sesión.</p>
  <p><b>Pedila en el chat</b> — <i>«hacé una lámpara que liste los endpoints del backend»</i>. El agente la escribe en <code data-project></code>, la valida y te pide encenderla acá.</p>
  <p><b>Encendida = existe</b> — apagada, el agente ni la ve. Al encenderla, sus tools entran al catálogo como <code>lamp_&lt;lámpara&gt;_&lt;tool&gt;</code> desde el próximo turno. Las globales viven en <code data-global></code> y valen para todos los proyectos.</p>
  <p><b>Ejemplos</b></p>
  <ul>
    <li><b>Consultas del proyecto</b> — <code>endpoints()</code> que parsea tus rutas y devuelve método + path + handler; <code>env_keys()</code> usadas vs. definidas en <code>.env.example</code>.</li>
    <li><b>Generadores con tus convenciones</b> — <code>new_component(name)</code> que crea el <code>.tsx</code> + test + story con tu plantilla exacta.</li>
    <li><b>Checkers</b> — <code>check_i18n()</code> claves faltantes por idioma; <code>lint_styles()</code> colores hardcodeados fuera de tus tokens.</li>
    <li><b>Datos locales</b> — <code>db_schema()</code> / <code>query(sql)</code> contra tu SQLite con techo <code>db=./dev.db</code>.</li>
    <li><b>Integraciones sin MCP</b> — <code>deploy_status()</code> contra tu API con techo <code>net=api.x.com</code>.</li>
  </ul>
  <p><button class="primary" data-back>← volver a las lámparas</button></p>`;
function openLamps(selectName) {
  let first = selectName || null;
  Panel.open({
    id: 'lamps', eyebrow: 'lámparas', title: 'Lámparas', layout: 'browse',
    headActions: [{ label: '?', title: '¿qué es una lámpara?', onClick: (b) => { Panel.help(true); const h = b.querySelector('.phelp'); h.querySelector('[data-project]').textContent = lampsMeta.project; h.querySelector('[data-global]').textContent = lampsMeta.global; h.querySelector('[data-back]').onclick = () => Panel.help(false); } }],
    browse: {
      placeholder: 'buscar lámpara o tool…', listWidth: '260px', help: LAMPS_HELP,
      key: l => l.name,
      load: async (q) => { const all = await fetchLamps(); const list = all.filter(l => lampMatches(l, q)); if (first) { const i = list.findIndex(l => l.name === first); first = null; if (i > 0) list.unshift(list.splice(i, 1)[0]); } return list; },
      render: (l) => `<span class="dot">${l.error ? '!' : (l.enabled ? '●' : '○')}</span><div><div class="nm">${esc(l.name)}</div><div class="meta">${esc(l.scope)} · ${esc(l.kind)} · ${(l.tools || []).length} tool${(l.tools || []).length === 1 ? '' : 's'}${l.error ? ' · rota' : ''}</div></div>`,
      count: (rows, q) => q ? `${rows.length} de ${lampsData.length}` : `${lampsData.length} lámpara${lampsData.length === 1 ? '' : 's'}`,
      emptyHtml: 'ninguna todavía',
      emptyDetail: `Todavía no hay lámparas.<br><br>Pedile una al agente en el chat — <i>«hacé una lámpara que liste los endpoints del backend»</i> — o creá una carpeta con <code>lamp.json</code> en <code>${esc(lampsMeta.project)}</code> (proyecto) o <code>${esc(lampsMeta.global)}</code> (global). El botón <b>?</b> de arriba explica qué son y para qué sirven.`,
      detail: (l) => {
        const specs = l.tool_specs || [];
        const cap = l.error ? `<div class="dcap err">rota: ${esc(l.error)}</div>` : (l.kind === 'syn' ? `<div class="dcap">techo de capacidades: ${esc(l.caps)}</div>` : `<div class="dcap"><b>sin techo</b> (exec) · $ ${esc(l.command)}</div>`);
        return `<div class="dhead"><span class="nm">${esc(l.name)}</span><span class="meta">${esc(l.scope)} · ${esc(l.kind)}</span><label class="sw ${l.enabled ? 'on' : ''}" title="${l.error ? 'no se puede encender: está rota' : (l.enabled ? 'apagar' : 'encender')}"><input type="checkbox" ${l.enabled ? 'checked' : ''} ${l.error ? 'disabled' : ''}>${l.enabled ? 'encendida' : 'apagada'}</label></div>`
          + (l.description ? `<div class="ddesc">${esc(l.description)}</div>` : '') + cap
          + (l.enabled || l.error ? '' : `<div class="dnote">Apagada: el agente no la ve y no se puede correr. Encendela con el switch — el código va a poder ejecutarse${l.kind === 'exec' ? ' <b>sin techo de capacidades</b> (es un ejecutable)' : ' bajo el techo de arriba'}.</div>`)
          + specs.map((t, i) => {
              const props = (t.parameters && t.parameters.properties) || {}; const required = (t.parameters && t.parameters.required) || [];
              return `<div class="tool" data-i="${i}"><div class="th"><code>${esc(t.name)}</code>${t.description ? `<span class="ds">${esc(t.description)}</span>` : '<span></span>'}<span class="ds">lamp_${esc(l.name)}_${esc(t.name)}</span></div>`
                + (Object.keys(props).length ? Object.keys(props).map(k => lampField(k, props[k], required)).join('') : '<div class="ds" style="margin-top:6px;color:var(--ink-3)">no toma parámetros</div>')
                + (l.enabled ? `<div class="go"><button class="primary run">▶ correr</button><span class="st"></span></div><pre class="out" style="display:none"></pre>` : '')
                + `</div>`;
            }).join('')
          + `<div class="dfoot"><span>${esc(l.dir || '')}</span>${l.scope === 'project' ? '<span class="del">eliminar</span>' : '<span title="las globales se borran a mano">global · se borra a mano</span>'}</div><div class="err" data-err></div>`;
      },
      wire: (l, box) => {
        const errEl = box.querySelector('[data-err]');
        box.querySelector('.sw input').onchange = async (ev) => {
          errEl.textContent = '';
          const r = await api(BASE + '/api/lamps/toggle', { name: l.name, enabled: ev.target.checked });
          if (!r.ok) { errEl.textContent = r.data.error || ('error ' + r.status); ev.target.checked = !ev.target.checked; return; }
          add('meta', '☼ ' + esc(r.data.result || '')); loadLamps(); loadSched();
        };
        for (const tdiv of box.querySelectorAll('.tool')) {
          const t = (l.tool_specs || [])[Number(tdiv.dataset.i)]; const props = (t.parameters && t.parameters.properties) || {}; const required = (t.parameters && t.parameters.required) || [];
          const b = tdiv.querySelector('button.run'); if (!b) continue;
          b.onclick = async () => {
            const st = tdiv.querySelector('.st'), out = tdiv.querySelector('.out'); const got = lampArgs(tdiv, props, required);
            if (got.error) { st.textContent = got.error; return; }
            st.textContent = 'corriendo…'; out.style.display = 'none'; b.disabled = true;
            const r = await api(BASE + '/api/lamps/run', { tool: 'lamp_' + l.name + '_' + t.name, args: got.args });
            st.textContent = r.ok ? '' : (r.data.error || 'error ' + r.status);
            if (r.ok) { out.textContent = r.data.output; out.style.display = ''; }
            b.disabled = false;
          };
        }
        const del = box.querySelector('.dfoot .del');
        if (del) del.onclick = () => inlineConfirm(del, `¿borrar ${l.name} del disco?`, async () => {
          const r = await api(BASE + '/api/lamps/remove', { name: l.name });
          if (!r.ok) { errEl.textContent = r.data.error || ('error ' + r.status); return; }
          add('meta', '☼ ' + esc(r.data.result || '')); loadLamps();
        });
      }
    }
  });
}
$('#lamps').onclick = () => openLamps();
if (location.hash === '#lamps') setTimeout(() => openLamps(), 400); // deep link: abre el panel al cargar
