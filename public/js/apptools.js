// apptools.js — herramientas .syn del proyecto (lib/apptools.syn): pill en la cabecera (solo si hay) + vista browse
// del Panel con cada archivo, su estado, qué puede tocar y su código, y el botón para aprobarlo. Una herramienta corre
// solo con el contenido que aprobó una persona; esto es lo mismo que `lampson tools list|approve`.
let apptoolsData = { files: [], dir: '', error: '' };
const APPTOOL_STATUS = {
  ok: ['●', 'aprobada'], new: ['○', 'nueva · sin aprobar'], changed: ['△', 'cambió · sin aprobar'],
  missing: ['·', 'borrada (estaba aprobada)'], unreadable: ['!', 'no se puede leer'], too_big: ['!', 'pasa el tope'],
  link: ['!', 'link a otra carpeta: no se permite'],
};
const apptoolPending = f => f.status !== 'ok' && f.status !== 'missing';
async function fetchAppTools() {
  let r; try { r = await (await fetch(BASE + '/api/apptools')).json(); } catch (e) { return apptoolsData; }
  apptoolsData = { files: r.files || [], dir: r.dir || '', error: r.error || '' };
  const pill = $('#apptools'), tools = apptoolsData.files.filter(f => f.tool), pending = apptoolsData.files.filter(apptoolPending);
  pill.hidden = !apptoolsData.files.length && !apptoolsData.error;
  pill.textContent = pending.length ? `herramientas · ${pending.length} sin aprobar` : `herramientas ${tools.length}`;
  pill.classList.toggle('nokey', pending.length > 0 || !!apptoolsData.error);
  pill.title = pending.length ? 'hay archivos de herramientas .syn sin aprobar: mientras tanto ninguna corre · clic para revisarlos' : 'herramientas .syn del proyecto: corren solo con el contenido que aprobaste';
  return apptoolsData;
}
async function approveAppTool(name, errEl) {
  const r = await api(BASE + '/api/apptools/approve', { name });
  if (!r.ok) { if (errEl) errEl.textContent = r.data.error || ('error ' + r.status); return; }
  add('meta', '☼ aprobado: ' + esc((r.data.approved || []).join(', ') || 'nada que aprobar'));
  await fetchAppTools(); if (Panel.is('apptools')) Panel.refresh();
}
function openAppTools() {
  Panel.open({
    id: 'apptools', eyebrow: 'herramientas', title: 'Herramientas .syn', layout: 'browse',
    headActions: [{ label: 'aprobar todo', wide: true, title: 'aprobar el contenido actual de todos los archivos de la carpeta', onClick: () => approveAppTool('') }],
    browse: {
      placeholder: 'buscar archivo…', listWidth: '280px',
      key: f => f.file,
      load: async (q) => { const d = await fetchAppTools(); return d.files.filter(f => !q || f.file.toLowerCase().includes(q.toLowerCase())); },
      render: (f) => { const s = APPTOOL_STATUS[f.status] || ['?', f.status]; return `<span class="dot">${s[0]}</span><div><div class="nm">${esc(f.file)}</div><div class="meta">${esc(s[1])}${f.tool ? '' : (f.file.endsWith('.syn') ? ' · ayudante' : ' · va al prompt')}</div></div>`; },
      count: (rows) => `${rows.length} archivo${rows.length === 1 ? '' : 's'}`,
      emptyHtml: 'ninguno',
      emptyDetail: `No hay herramientas .syn en <code>${esc(shortPath(apptoolsData.dir))}</code>.${apptoolsData.error ? `<br><br>La carpeta no se pudo leer: ${esc(apptoolsData.error)}` : ''}<br><br>Un archivo por herramienta, con su <code>intent:</code>, sus <code>require</code> y <code>export task &lt;nombre&gt;(…)</code>: <a href="https://lampson.org/es/docs/sdk#en-synsema-con-garantias" target="_blank" rel="noopener">cómo se escriben</a>.`,
      detail: (f) => {
        const s = APPTOOL_STATUS[f.status] || ['?', f.status], t = f.tool;
        const canApprove = f.status === 'new' || f.status === 'changed';
        return `<div class="dhead"><span class="nm">${esc(f.file)}</span><span class="meta">${esc(s[1])}</span></div>`
          + (t ? (t.description ? `<div class="ddesc">${esc(t.description)}</div>` : '') + (t.error && f.status === 'ok' ? `<div class="dcap err">${esc(t.error)}</div>` : `<div class="dcap">puede tocar: ${esc(t.ceiling)}</div>`)
            + (t.params && t.params.length ? `<div class="ds">parámetros: ${t.params.map(p => esc(p.name) + (p.optional ? '?' : '')).join(', ')}</div>` : '') : '')
          + (canApprove ? `<div class="dnote">Mientras haya un archivo sin aprobar, <b>ninguna</b> herramienta .syn corre. Revisá el código y lo que puede tocar; si lo cambió un agente sin que lo pidieras, no lo apruebes.</div><div class="go"><button class="primary approve">aprobar este contenido</button></div>` : '')
          + (f.status === 'missing' ? `<div class="dnote">Lo borraron de la carpeta. «aprobar todo» lo saca de la lista.</div>` : '')
          + (['unreadable', 'too_big', 'link'].includes(f.status) ? `<div class="dnote">Frena todas las herramientas .syn hasta que lo saques de la carpeta.</div>` : '')
          + (f.status !== 'missing' && f.status !== 'link' ? `<pre class="out src">cargando…</pre>` : '')
          + `<div class="dfoot"><span>${esc(shortPath(apptoolsData.dir))}</span></div><div class="err" data-err></div>`;
      },
      wire: async (f, box) => {
        const errEl = box.querySelector('[data-err]');
        const b = box.querySelector('button.approve'); if (b) b.onclick = () => approveAppTool(f.file, errEl);
        const src = box.querySelector('pre.src'); if (!src) return;
        try { const r = await (await fetch(BASE + '/api/apptools/source?file=' + encodeURIComponent(f.file))).json(); src.textContent = r.text !== undefined ? r.text : (r.error || 'no se pudo leer'); }
        catch (e) { src.textContent = 'no se pudo leer'; }
      }
    }
  });
}
$('#apptools').onclick = () => openAppTools();
fetchAppTools();
if (location.hash === '#apptools') setTimeout(() => openAppTools(), 400);
