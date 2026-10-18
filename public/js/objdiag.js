// objdiag.js — «Revisar qué pasa» en un objetivo de equipo (lo abre el botón de la cabecera, o el aviso «parece
// trabado» de la vista en vivo). Tres partes:
//   · lo que se ve (api/objectives/:id/facts, lib/diagnose.syn → facts): quién está bloqueado y por qué, quién
//     contestó en su respuesta final que nadie lee, quién se quedó sin pasos, si el equipo cree que alguien no tiene
//     presupuesto — cada cosa con su arreglo a mano (desbloquear la tarea, escribirle al asiento)
//   · el análisis con IA (api/objectives/:id/diagnose): qué pasó y qué hacer, con acciones que se aplican con un botón
//   · escribirle a cualquier asiento: le llega como un mensaje tuyo y le da un turno
// done: lo que ya aplicaste (por objetivo), así un botón no manda dos veces ni reaparece al redibujar
const DIAG = { facts: {}, ai: {}, at: {}, drawn: null, busy: false, done: {} };
const diagDone = (o) => DIAG.done[o.id] || (DIAG.done[o.id] = new Set());
const DIAG_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/><path d="M8 10.5h5M10.5 8v5"/></svg>';

async function diagFacts(o, force) {
  if (!o.team) return [];
  if (!force && DIAG.facts[o.id] && Date.now() - (DIAG.at[o.id] || 0) < 15000) return DIAG.facts[o.id];
  const r = await api(`objectives/${o.id}/facts`);
  DIAG.facts[o.id] = r.ok ? r.data.facts : []; DIAG.at[o.id] = Date.now();
  return DIAG.facts[o.id];
}
// cada hecho, en palabras de la persona, con su arreglo
function factView(o, f) {
  const role = (a) => ((o.seats || []).find((s) => s.agent === a) || {}).role || a;
  const quote = (String(f.text).match(/«([\s\S]*)»/) || [])[1] || '';
  const after = String(f.text).replace(/^[^:]*:\s*/, '');
  const msg = (agent, text) => `<button type="button" data-dmsg="${esc(agent)}" data-dtext="${esc(text)}">Escribirle a ${esc(role(agent))}</button>`;
  const unblock = f.task ? `<button type="button" class="primary" data-dtask="${f.task}" data-dstatus="todo">Desbloquear #${f.task}</button>` : '';
  if (f.kind === 'quiet') return { tone: 'warn', html: `Nadie trabaja y no se mueve nada hace ${esc((f.text.match(/(\d+) min/) || [])[1] || '?')} min.`, acts: msg(o.agent, 'El equipo está quieto. Mirá el tablero: ¿quién tiene que hacer qué ahora? Destrabalo y avisame si necesitás algo de mí.') };
  if (f.kind === 'budget_belief') return { tone: 'bad', html: `#${f.task} espera que <b>${esc(role(f.agent))}</b> «tenga presupuesto», pero <b>sí puede trabajar</b>: mientras el objetivo tenga presupuesto, sigue recibiendo turnos aunque pase su tope diario.`,
    acts: unblock + msg(f.agent, `Sí tenés presupuesto: mientras este objetivo tenga, seguís trabajando aunque pases tu tope diario. Retomá #${f.task} donde quedaste, terminalo, commiteá y avisale a tu jefe con send.`) };
  if (f.kind === 'blocked') return { tone: '', html: `#${f.task} está bloqueada${after ? ': ' + esc(short(after, 220)) : '.'}`, acts: unblock };
  if (f.kind === 'waits') return { tone: '', html: `#${f.task} espera a ${esc((f.text.match(/waits for (#\d+)/) || [])[1] || 'otra')}, que está bloqueada.`, acts: '' };
  if (f.kind === 'unsent') return { tone: 'bad', html: `<b>${esc(role(f.agent))}</b> contestó en su respuesta final, que nadie lee: <q>${esc(short(quote, 260))}</q>`,
    acts: msg(f.agent, 'Lo que contestaste en tu último turno no le llegó a nadie: la respuesta final no se entrega. Mandáselo a tu jefe con send y seguí con tu tarea.') };
  if (f.kind === 'cut') return { tone: 'warn', html: `A <b>${esc(role(f.agent))}</b> se le cortó el último turno (${f.text.includes('budget') ? 'sin tokens del turno' : 'sin pasos'})${quote ? ': <q>' + esc(short(quote, 200)) + '</q>' : '.'}`,
    acts: msg(f.agent, `Se te cortó el turno. Seguí donde quedaste${f.task ? ' con #' + f.task : ''}, sin empezar de nuevo, y avisale a tu jefe con send cuando termines.`) };
  return { tone: '', html: esc(f.text), acts: '' };
}
function diagHtml(o, facts) {
  const seats = o.seats || [], ai = DIAG.ai[o.id], done = diagDone(o);
  const applied = (k, what) => `<p class="dg-done">✓ ${what}</p>`;
  const fv = facts.map((f) => factView(o, f));
  return `<section class="dg-sec"><h4>Lo que se ve</h4>${fv.length ? `<ul class="dg-facts">${fv.map((v) => `<li class="${v.tone}"><p>${v.html}</p>${v.acts ? `<div class="dg-acts">${v.acts}</div>` : ''}</li>`).join('')}</ul>` : '<p class="ihint">No se ve nada trabado: si igual no avanza, pedí el análisis.</p>'}</section>
    <section class="dg-sec"><h4>Análisis con IA</h4>${ai ? (ai.error ? `<p class="ferr">${esc(ai.error)}</p>` : `<div class="dg-sum">${reportHtml(ai.summary)}</div>${(ai.actions || []).map((a, i) => done.has('ai' + i) ? `<div class="dg-act done"><p class="dg-why">${esc(a.why || '')}</p>${applied('ai' + i, a.kind === 'message' ? 'Mandado a ' + esc(((seats.find((s) => s.agent === a.agent) || {}).role) || a.agent) : 'Movida #' + esc(a.task))}</div>` : a.kind === 'message'
        ? `<div class="dg-act"><p class="dg-why">${esc(a.why || '')}</p><label>Mensaje para <b>${esc(((seats.find((s) => s.agent === a.agent) || {}).role) || a.agent)}</b><textarea rows="3" data-aitext="${i}">${esc(a.text || '')}</textarea></label><button type="button" class="primary" data-aimsg="${i}">Mandárselo</button></div>`
        : `<div class="dg-act"><p class="dg-why">${esc(a.why || '')}</p><button type="button" class="primary" data-ai="${i}" data-dtask="${esc(a.task)}" data-dstatus="${esc(a.status)}">Mover #${esc(a.task)} a «${esc(LANES.find(([st]) => st === a.status)?.[1] || a.status)}»</button></div>`).join('')}<p class="dg-model">${esc(ai.model || '')}</p>`) : ''}
      <button type="button" id="dgAi" ${DIAG.busy ? 'disabled' : ''}>${DIAG.busy ? 'analizando… (puede tardar un minuto)' : ai ? 'Analizar de nuevo' : 'Analizar con IA'}</button>
      <p class="ds">Le pasa al modelo el tablero, el registro y el último turno de cada asiento, y te dice qué pasó y qué conviene hacer.</p></section>
    <section class="dg-sec"><h4>Escribirle a un asiento</h4>
      <div class="dg-write"><select id="dgTo">${seats.map((s) => `<option value="${esc(s.agent)}" ${s.lead ? 'selected' : ''}>${esc(s.role || s.agent)}${s.lead ? ' (líder)' : ''}</option>`).join('')}</select>
      <textarea id="dgText" rows="3" placeholder="Le llega como un mensaje tuyo y le da un turno"></textarea><button type="button" class="primary" id="dgSend">Mandar</button></div><p class="ferr" id="dgErr"></p></section>`;
}
async function renderDiag(o, force) {
  const box = $('#odSeat');
  if (!force && DIAG.drawn === o.id) return;
  DIAG.drawn = o.id;
  const facts = await diagFacts(o, force);
  box.innerHTML = diagHtml(o, facts);
  const finish = (btn, txt) => { btn.textContent = txt; setTimeout(() => { DIAG.at[o.id] = 0; renderDiag(o, true); }, 1200); };
  // key: qué se aplicó (para no repetirlo); el botón queda desactivado desde el primer clic
  const act = async (body, btn, okText, key) => {
    if (btn.disabled || (key && diagDone(o).has(key))) return;
    btn.disabled = true;
    const r = await api(`objectives/${o.id}/act`, body);
    if (!r.ok) { btn.disabled = false; $('#dgErr').textContent = (r.data && r.data.error) || 'no se pudo'; return; }
    if (key) diagDone(o).add(key);
    finish(btn, okText); refresh();
  };
  // escribirle: el botón llena el formulario de abajo (lo podés editar antes de mandarlo)
  box.querySelectorAll('[data-dmsg]').forEach((b) => (b.onclick = () => { $('#dgTo').value = b.dataset.dmsg; $('#dgText').value = b.dataset.dtext; $('#dgText').focus(); $('#dgText').scrollIntoView({ block: 'center', behavior: 'smooth' }); }));
  box.querySelectorAll('[data-dtask]').forEach((b) => (b.onclick = () => act({ kind: 'task', task: +b.dataset.dtask, status: b.dataset.dstatus }, b, 'listo ✓', b.dataset.ai ? 'ai' + b.dataset.ai : 'task' + b.dataset.dtask + b.dataset.dstatus)));
  box.querySelectorAll('[data-aimsg]').forEach((b) => (b.onclick = () => { const a = DIAG.ai[o.id].actions[+b.dataset.aimsg]; act({ kind: 'message', agent: a.agent, text: box.querySelector(`[data-aitext="${b.dataset.aimsg}"]`).value }, b, 'mandado ✓', 'ai' + b.dataset.aimsg); }));
  $('#dgSend').onclick = async () => { const t = $('#dgText').value.trim(); if (!t) { $('#dgText').focus(); return; } await act({ kind: 'message', agent: $('#dgTo').value, text: t }, $('#dgSend'), 'mandado ✓'); $('#dgText').value = ''; };
  $('#dgAi').onclick = async () => {
    DIAG.busy = true; renderDiag(o, true);
    const r = await api(`objectives/${o.id}/diagnose`, {});
    DIAG.busy = false; DIAG.done[o.id] = new Set(); DIAG.ai[o.id] = r.ok ? r.data : { error: 'No se pudo analizar: ' + ((r.data && r.data.error) || r.error || 'sin respuesta del modelo') };
    if (r.ok) DIAG.facts[o.id] = r.data.facts;
    if (state.drawer && state.drawer.kind === 'diag') renderDiag(o, true);
  };
}
// en vivo: si se ve algo trabado, un aviso arriba del lienzo que abre el panel
async function diagBanner(o) {
  const el = $('#lvDiag'); if (!el || !o.team || o.status !== 'active') { if (el) el.hidden = true; return; }
  const facts = await diagFacts(o);
  const bad = facts.filter((f) => ['quiet', 'budget_belief', 'unsent'].includes(f.kind));
  el.hidden = !bad.length; if (!bad.length) return;
  const v = factView(o, bad[0]);
  const html = `${DIAG_ICON}<p><b>Parece trabado.</b> ${v.html}</p><button type="button" class="primary" data-diag>Revisar qué pasa</button>`;
  if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; el.querySelector('[data-diag]').onclick = () => openDrawer('diag'); }
}
