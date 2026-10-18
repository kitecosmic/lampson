// objlive.js — la vista EN VIVO de un objetivo abierto (la usa js/teams.js → loadObj; cuando termina, la página pasa
// sola al informe). Tres partes, todas con datos reales — nada se mueve si no pasó algo:
//   · el equipo vivo (js/flow.js, con las posiciones del editor): cada asiento tiene su color; quien trabaja lleva un
//     anillo que gira y un ícono animado de lo que hace (piensa, lee, escribe, corre un comando, git, escribe a alguien,
//     mueve el tablero); lo que dice aparece en un globo; cada mensaje viaja como un sobre por la línea, que se enciende
//   · el tablero: las tarjetas se deslizan de columna (FLIP) y una ficha vuela desde quien la movió
//   · lo último: los eventos del registro en una cinta; el registro completo, en el botón «Registro»
// En tiempo real: los pasos llegan por SSE (/api/events, temas team.step y team.ledger que publican lib/runtime.syn y
// lib/teams.syn) en el momento en que pasan. El sondeo de siempre (refresh cada 2,5 s y la traza) queda de respaldo.
// Se arma una vez por objetivo y después solo se tocan las partes que cambiaron: rearmar cortaría las animaciones.
const LIVE = { key: null, o: null, flow: null, flowSig: '', members: [], seenLedger: 0, flown: new Set(), steps: {}, stepsAt: 0, rects: null,
  act: {}, busy: {}, pend: {}, lastSpent: null, tok: 0, tokAnim: 0, view: {}, kanban: '', head: '', ticker: '', extra: [], flights: [],
  sent: {}, es: null, esOk: false, watch: 0, reload: 0 };
const avatarOf = (s) => String(s || '?').normalize('NFD').replace(/\p{M}/gu, '').slice(0, 2);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- íconos (trazo propio, animados por CSS en teams.css → .ico.<nombre>) ----
const svg = (cls, inner) => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  think: svg('think', '<path d="M9.5 4.5A3 3 0 0 0 6.6 7 3 3 0 0 0 4.5 10a3 3 0 0 0 .9 4.6 3.2 3.2 0 0 0 4.1 4.9h.5v-15z"/><path d="M14.5 4.5A3 3 0 0 1 17.4 7a3 3 0 0 1 2.1 3 3 3 0 0 1-.9 4.6 3.2 3.2 0 0 1-4.1 4.9H14v-15z"/><circle class="sp s1" cx="7.4" cy="10.4" r="1.15"/><circle class="sp s2" cx="16.6" cy="9" r="1.15"/><circle class="sp s3" cx="8.4" cy="15" r="1.15"/><circle class="sp s4" cx="15.6" cy="14.6" r="1.15"/>'),
  look: svg('look', '<g class="lens"><circle cx="10.5" cy="10.5" r="5.5"/><path d="M14.6 14.6 20 20"/></g>'),
  write: svg('write', '<path class="ink" d="M3.5 20.5h9"/><g class="pen"><path d="M15.5 3.5l4.8 4.8L10 18.6l-5.4.6.6-5.4z"/><path d="M13.6 5.4l4.8 4.8"/></g>'),
  run: svg('run', '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="M6.5 9.5l3 2.5-3 2.5"/><rect class="cur" x="11.5" y="13.6" width="5" height="1.8" rx=".6"/>'),
  git: svg('git', '<circle cx="6" cy="5.5" r="2.2"/><circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="7.5" r="2.2"/><path d="M6 7.7v8.6"/><path d="M18 9.7c0 4.3-7.5 3.3-11.2 6.9"/><circle class="bit" r="1.4"><animateMotion dur="1.4s" repeatCount="indefinite" path="M18 9.7c0 4.3-7.5 3.3-11.2 6.9"/></circle>'),
  send: svg('send', '<g class="env"><rect x="3" y="6" width="18" height="12.5" rx="2"/><path d="M3.5 7l8.5 6.2L20.5 7"/></g>'),
  board: svg('board', '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M9 4v16M15 4v16"/><rect class="card" x="3.9" y="7" width="3.7" height="3" rx=".8"/>'),
  flag: svg('flag', '<path d="M5.5 21V4"/><path class="cloth" d="M5.5 4.5h11.5l-2.4 3.7 2.4 3.8H5.5"/>'),
  web: svg('web', '<circle cx="12" cy="12" r="8.5"/><ellipse class="mer" cx="12" cy="12" rx="3.6" ry="8.5"/><path d="M3.5 12h17"/>'),
  gear: svg('gear', '<g class="cog"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1"/></g>'),
  say: svg('say', '<path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><circle class="dot d1" cx="8.5" cy="11" r="1"/><circle class="dot d2" cx="12" cy="11" r="1"/><circle class="dot d3" cx="15.5" cy="11" r="1"/>'),
  done: svg('done', '<circle cx="12" cy="12" r="9"/><path class="tick" d="M7.8 12.3l2.8 2.8 5.6-6"/>'),
  wait: svg('wait', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  warn: svg('warn', '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5"/><circle class="dt" cx="12" cy="17.3" r=".9"/>'),
  block: svg('block', '<circle cx="12" cy="12" r="8.5"/><path d="M6.2 6.2l11.6 11.6"/>'),
};
// el sobre que viaja por la línea (centrado en 0,0, para animateMotion)
const ENVELOPE = '<g class="envg"><rect x="-10" y="-7" width="20" height="14" rx="3"/><path d="M-8.5 -5l8.5 6 8.5-6"/></g>';
// qué ícono va con cada herramienta
function actOf(name, a = {}) {
  if (['read', 'ls', 'find', 'grep', 'glob', 'lsp'].includes(name)) return 'look';
  if (name === 'write' || name === 'edit') return 'write';
  if (name === 'bash') return /\bgit\b/.test(a.command || '') ? 'git' : 'run';
  if (name === 'send') return 'send';
  if (name === 'board') return 'board';
  if (name === 'objective') return 'flag';
  if (name === 'fetch' || name === 'web' || name === 'search') return 'web';
  return 'gear';
}
// el color de cada asiento, en el orden del equipo (el líder primero); la paleta está en teams.css (--s0…--s6)
const colorOf = (a) => { const i = LIVE.members.findIndex((m) => m.agent === a); return `var(--s${(i < 0 ? 0 : i) % 7})`; };

// las últimas líneas de una traza (son recientes: la fecha sale de ahora, no del inicio de la sesión)
function parseTraceRecent(txt) {
  const now = Date.now() / 1000, day0 = Math.floor(now / 86400) * 86400, out = [];
  for (const line of String(txt || '').split('\n')) {
    const m = line.match(/^(\d\d):(\d\d):(\d\d)\.(\d{3}) .{6}s {2}(\S+)\s+(.*)$/); if (!m) continue;
    let at = day0 + +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    if (at > now + 300) at -= 86400;
    out.push({ at, kind: m[5], text: m[6] });
  }
  return out;
}
// el último paso de cada asiento según su traza: el arranque y el respaldo (lo de ahora llega por eventos)
async function liveSteps(o) {
  if (LIVE.key === 'live:' + o.id && Date.now() - LIVE.stepsAt < (LIVE.esOk ? 10000 : 2400)) return LIVE.steps;
  const res = {};
  await Promise.all((o.seats || []).map(async (s) => {
    if (!s.session) return;
    const r = await api('trace?session=' + enc(s.session) + '&tail=120');
    const items = stepsOf(parseTraceRecent(r.ok ? r.data.trace : '').filter((e) => e.at >= o.created_at - 2)).flatMap((t) => t.items);
    res[s.agent] = { last: items[items.length - 1] || null };
  }));
  LIVE.steps = res; LIVE.stepsAt = Date.now();
  return res;
}
// ¿trabaja ahora? Lo que dijeron los eventos manda por un rato; si no hay, lo que dice el sondeo
function busyOf(o, a) { const b = LIVE.busy[a]; return b && Date.now() - b.at < 90000 ? b.v : !!workingNow(o, a); }
// qué está haciendo un asiento: {cls, icon, html}
function seatView(o, s) {
  const a = s.agent, mine = (o.tasks || []).filter((t) => t.owner === a);
  if (busyOf(o, a)) {
    const ev = LIVE.act[a], tr = (LIVE.steps[a] || {}).last;
    if (ev && (!tr || ev.at >= tr.at - 1)) return { cls: 'busy', icon: ev.icon, html: ev.html };
    if (tr) { const name = tr.raw ? tr.raw.split(' ')[0] : ''; return { cls: 'busy', icon: tr.cls.includes('say') ? 'say' : name ? actOf(name, salvageArgs(tr.raw.slice(name.length + 1))) : 'think', html: tr.html }; }
    return { cls: 'busy', icon: 'think', html: 'pensando…' };
  }
  if (mine.length && mine.every((t) => t.status === 'done')) return { cls: 'done', icon: 'done', html: 'terminó lo suyo' };
  if (mine.some((t) => t.status === 'blocked')) return { cls: 'blocked', icon: 'block', html: 'trabado: espera que se destrabe algo' };
  if (mine.some((t) => t.status !== 'done')) return { cls: 'wait', icon: 'wait', html: 'esperando su próximo turno' };
  return { cls: 'idle', icon: 'wait', html: s.lead ? 'coordinando' : 'sin tareas por ahora' };
}
// una línea del registro, como la contaría una persona
function tickerLine(r, roleOf) {
  const who = `<b style="color:${colorOf(r.actor)}">${esc(roleOf(r.actor))}</b>`, x = r.text && r.text !== 'null' ? esc(short(String(r.text).replace(/\*\*|`/g, ''), 120)) : '';
  if (r.kind === 'message') return `${who} → <b>${esc(roleOf(String(r.ref).replace('→', '').trim()))}</b>: «${x}»`;
  if (r.kind === 'added') return `${who} creó ${esc(r.ref)} «${esc(short(String(r.text).split(' → ')[0], 80))}»`;
  if (r.kind === 'claimed') return `${who} tomó ${esc(r.ref)}`;
  if (r.kind === 'updated') return `${who} movió ${esc(r.ref)}${x ? ' · ' + x : ''}`;
  if (r.kind === 'report') return `${who} informó: «${x}»`;
  if (r.kind === 'over cap') return `${who} pasó su tope diario: ${esc(overText(r))}`;
  if (r.kind === 'continued') return `${esc(roleOf(String(r.text).split(':')[0]))} llegó al límite de pasos de un turno: sigue donde quedó`;
  if (r.kind === 'stuck') return `${esc(roleOf(String(r.text).split(':')[0]))} se cortó varias veces seguidas: le avisamos a su jefe`;
  if (r.kind === 'tokens') return `le diste más tokens por hoy a ${esc(roleOf(String(r.text).split(':')[0]))}`;
  if (r.kind === 'handed off') return `${who} le pasó el trabajo a <b>${esc(teamName(String(r.text).split(':')[0].trim()))}</b> (${esc(r.ref)})`;
  return `${who} ${esc(KIND[r.kind] || r.kind)} ${esc(r.ref || '')}${x ? ': «' + x + '»' : ''}`;
}
function kanbanHtml(o, roleOf, seatsBusy) {
  const cols = LANES.filter(([st]) => st !== 'blocked' || (o.tasks || []).some((t) => t.status === 'blocked'));
  return cols.map(([st, label]) => {
    const cs = (o.tasks || []).filter((t) => t.status === st);
    return `<div class="kcol ${st}"><h6><span>${label}</span><span>${cs.length}</span></h6><div class="kcards">${cs.map((t) => {
      const busy = t.owner && seatsBusy.has(t.owner) && (st === 'doing' || st === 'review');
      return `<div class="kc${busy ? ' busy' : ''}" data-id="${t.id}" style="--seat:${colorOf(t.owner)}"><div class="kh"><span class="kid">#${t.id}</span>${busy ? '<span class="spin" aria-label="trabajando"></span>' : st === 'done' ? '<span class="ok">✓</span>' : ''}</div><p>${esc(short(t.title, 110))}</p>${t.owner ? `<div class="ko"><span class="av">${esc(avatarOf(roleOf(t.owner)))}</span>${esc(roleOf(t.owner))}</div>` : '<div class="ko none">sin dueño</div>'}</div>`;
    }).join('') || '<p class="kempty">—</p>'}</div></div>`;
  }).join('');
}
// FLIP: cada tarjeta recuerda dónde estaba y se desliza a su lugar nuevo; la nueva aparece; la que llega a hecho, salta
function flipKanban(box, html) {
  const before = {}; box.querySelectorAll('.kc').forEach((c) => (before[c.dataset.id] = { r: c.getBoundingClientRect(), st: c.closest('.kcol').classList[1] }));
  box.innerHTML = html;
  if (reduced() || !LIVE.rects) { LIVE.rects = true; return; }
  box.querySelectorAll('.kc').forEach((c) => {
    const b = before[c.dataset.id], st = c.closest('.kcol').classList[1];
    if (!b) { c.classList.add('appear'); return; }
    const r = c.getBoundingClientRect(), dx = b.r.left - r.left, dy = b.r.top - r.top;
    if (dx || dy) {
      c.style.transform = `translate(${dx}px,${dy}px)`; c.style.transition = 'none'; c.classList.add('moving');
      requestAnimationFrame(() => requestAnimationFrame(() => { c.style.transition = 'transform .7s cubic-bezier(.2,.8,.2,1)'; c.style.transform = ''; }));
      setTimeout(() => c.classList.remove('moving'), 900);
      if (b.st !== st && st === 'done') setTimeout(() => c.classList.add('pop'), 650);
    }
  });
}
// una ficha «#N» vuela desde el asiento que movió la tarea hasta su tarjeta
function flyCards() {
  const q = LIVE.flights.splice(0); if (!q.length || reduced()) return;
  q.forEach(({ agent, id }, i) => {
    const n = nodeEl(agent), c = document.querySelector(`#lvKanban .kc[data-id="${id}"]`); if (!n || !c) return;
    const a = n.getBoundingClientRect(), b = c.getBoundingClientRect(); if (!a.width || !b.width) return;
    const chip = document.createElement('div'); chip.className = 'lvfly'; chip.style.setProperty('--seat', colorOf(agent)); chip.textContent = '#' + id;
    document.body.appendChild(chip);
    const x0 = a.left + a.width / 2 - 16, y0 = a.top + a.height / 2 - 10, x1 = b.left + 10, y1 = b.top + 6, mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 70;
    const an = chip.animate([{ transform: `translate(${x0}px,${y0}px) scale(.5)`, opacity: 0 }, { transform: `translate(${mx}px,${my}px) scale(1.15)`, opacity: 1, offset: 0.45 }, { transform: `translate(${x1}px,${y1}px) scale(.9)`, opacity: 0.95 }],
      { duration: 950, delay: i * 160, easing: 'cubic-bezier(.3,.7,.25,1)', fill: 'forwards' });
    an.onfinish = () => { chip.remove(); c.classList.remove('land'); void c.offsetWidth; c.classList.add('land'); };
  });
}

// ---- el equipo vivo: se toca solo lo que cambió ----
const nodeEl = (a) => document.querySelector(`#lvStage .fl-node[data-id="${CSS.escape(a)}"]`);
function hit(a, kind) {
  const el = nodeEl(a); if (!el || reduced()) return;
  el.classList.remove('hit-ok', 'hit-bad', 'hit-recv'); void el.offsetWidth; el.classList.add('hit-' + kind);
  clearTimeout(el._hit); el._hit = setTimeout(() => el.classList.remove('hit-' + kind), 900);
}
// lo que dice un asiento, en un globo que se va solo
function bubble(a, html) {
  const el = nodeEl(a); if (!el) return;
  el.querySelectorAll('.lvbubble').forEach((b) => b.remove());
  const b = document.createElement('div'); b.className = 'lvbubble'; b.innerHTML = html; el.appendChild(b); el.classList.add('talking');
  setTimeout(() => b.classList.add('out'), 4200); setTimeout(() => { b.remove(); if (!el.querySelector('.lvbubble')) el.classList.remove('talking'); }, 4700);
}
function sendFly(from, to) {
  if (!LIVE.flow || !nodeEl(from) || !nodeEl(to)) return;
  LIVE.sent[from + '>' + to] = Date.now();
  LIVE.flow.particle(from, to, { color: colorOf(from), glyph: ENVELOPE, dur: 1.5 });
  setTimeout(() => hit(to, 'recv'), 1500);
}
// el trabajo sale a otro equipo: el sobre deja el lienzo por una puerta con su nombre, y un aviso lleva al objetivo
// nuevo en unos segundos (o enseguida, con «ver ahora»; «quedarme acá» o pasar el mouse por encima lo frena)
function handoffFly(o, r) {
  const tid = String(r.text || '').split(':')[0].trim(), nid = +String(r.ref || '').replace('O-', ''); if (!tid || !nid) return;
  const stage = $('#lvStage'), n = nodeEl(o.agent);
  if (stage && n && !reduced()) {
    const door = document.createElement('div'); door.className = 'lvdoor'; door.style.setProperty('--seat', colorOf(o.agent));
    door.innerHTML = `${ICON_PASS}<span>${esc(teamName(tid))}</span>`; stage.appendChild(door);
    const a = n.getBoundingClientRect(), b = door.getBoundingClientRect();
    const env = document.createElement('div'); env.className = 'lvenv'; env.style.setProperty('--seat', colorOf(o.agent));
    env.innerHTML = `<svg viewBox="-12 -9 24 18" aria-hidden="true">${ENVELOPE}</svg>`; document.body.appendChild(env);
    const x0 = a.left + a.width / 2 - 14, y0 = a.top + a.height / 2 - 10, x1 = b.left + 10, y1 = b.top + b.height / 2 - 10, mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 60;
    const an = env.animate([{ transform: `translate(${x0}px,${y0}px) scale(.6)`, opacity: 0 }, { transform: `translate(${mx}px,${my}px) scale(1.2)`, opacity: 1, offset: 0.5 }, { transform: `translate(${x1}px,${y1}px) scale(.8)`, opacity: 0.2 }],
      { duration: 1400, easing: 'cubic-bezier(.3,.7,.25,1)', fill: 'forwards' });
    an.onfinish = () => { env.remove(); door.classList.add('got'); };
    setTimeout(() => door.remove(), 15000);
  }
  handoffToast(o.id, tid, nid);
}
function handoffToast(from, tid, nid) {
  document.querySelectorAll('.lvhand').forEach((x) => x.remove());
  const href = url.obj(tid, nid), t = document.createElement('div'); let left = 6;
  t.className = 'lvhand'; t.setAttribute('role', 'status');
  t.innerHTML = `${ICON_PASS}<div class="hb"><b>Pasado a ${esc(teamName(tid))}</b><span>Ahora es O-${nid}, un objetivo de ese equipo. <span class="cd">Te llevo en ${left} s.</span></span></div>
    <a class="btn primary" href="${esc(href)}">ver ahora</a><button type="button" class="lnk" data-stay>quedarme acá</button>`;
  document.body.appendChild(t);
  const stop = () => { clearInterval(iv); const cd = t.querySelector('.cd'); if (cd) cd.textContent = ''; };
  const iv = setInterval(() => {
    left -= 1;
    if (left > 0) { t.querySelector('.cd').textContent = `Te llevo en ${left} s.`; return; }
    clearInterval(iv); t.remove();
    if (state.route.obj === from) go(href);   // solo si sigue mirando el objetivo de donde salió
  }, 1000);
  t.addEventListener('mouseenter', stop, { once: true });
  t.querySelector('[data-stay]').onclick = () => { stop(); t.remove(); };
  t.querySelector('a').onclick = (e) => { e.preventDefault(); e.stopPropagation(); stop(); t.remove(); go(href); };
}
function paintSeats(o) {
  const seats = o.seats || [];
  LIVE.members.forEach((m) => {
    const el = nodeEl(m.agent); if (!el) return;
    const s = seats.find((x) => x.agent === m.agent) || { agent: m.agent, role: m.role, lead: m.agent === o.agent };
    const v = seatView(o, s), was = LIVE.view[m.agent] || {};
    el.style.setProperty('--seat', colorOf(m.agent));
    if (was.cls !== v.cls) ['busy', 'done', 'blocked', 'wait', 'idle'].forEach((c) => el.classList.toggle(c, c === v.cls));
    const box = el.querySelector('.lvact');
    if (box && was.icon !== v.icon) { const ic = box.querySelector('.ico'); if (ic) ic.outerHTML = ICONS[v.icon]; else box.insertAdjacentHTML('afterbegin', ICONS[v.icon]); }
    if (box && was.html !== v.html) { const tx = box.querySelector('.tx'); tx.innerHTML = v.html; if (was.html !== undefined) { tx.classList.remove('enter'); void tx.offsetWidth; tx.classList.add('enter'); } }
    const mine = (o.tasks || []).filter((t) => t.owner === m.agent), busy = v.cls === 'busy';
    const th = mine.slice(0, 5).map((t) => `<span class="tchip ${t.status}" title="${esc(t.title)}">#${t.id}${t.status === 'done' ? ' ✓' : (t.status === 'doing' || t.status === 'review') && busy ? ' ⟳' : ''}</span>`).join('') + (mine.length > 5 ? `<span class="tchip">+${mine.length - 5}</span>` : '');
    const tb = el.querySelector('.lvtasks'); if (tb && was.tasks !== th) tb.innerHTML = th;
    const over = overCap(o, s), ob = el.querySelector('.lvover');
    el.classList.toggle('over', over);
    if (ob) { ob.hidden = !over; if (over) { ob.innerHTML = `${ICONS.warn}tope ${k(s.today)}/${k(s.cap)}`; ob.title = `Hoy lleva ${k(s.today)} tokens y su tope diario es ${k(s.cap)}: tocá para darle más`; ob.onpointerdown = (e) => e.stopPropagation(); ob.onclick = (e) => { e.stopPropagation(); capPop(ob, LIVE.o, [s]); }; } }
    LIVE.view[m.agent] = { ...v, tasks: th };
  });
  // las líneas de quien trabaja corren despacio, del color de quien trabaja
  const busyA = new Set(LIVE.members.filter((m) => (LIVE.view[m.agent] || {}).cls === 'busy').map((m) => m.agent));
  document.querySelectorAll('#lvStage .fl-edge').forEach((g) => {
    const [, from, to] = (g.dataset.k || '').match(/^[^:]+:(.*)>(.*)$/) || [];
    const who = busyA.has(to) ? to : busyA.has(from) ? from : null;
    g.classList.toggle('live', !!who); if (who) g.style.setProperty('--flow', colorOf(who));
  });
}
// el contador de tokens sube de a poco: lo gastado + lo que van gastando los turnos en curso (llega en cada paso)
function tokTarget(o) {
  if (LIVE.lastSpent !== o.spent) { Object.keys(LIVE.pend).forEach((a) => { if (LIVE.pend[a].ended) delete LIVE.pend[a]; }); LIVE.lastSpent = o.spent; }
  return o.spent + Object.values(LIVE.pend).reduce((n, p) => n + p.cost, 0);
}
function tokTo(o) {
  const el = $('#lvTok'), meter = $('#lvMeter'), target = tokTarget(o), from = LIVE.tok;
  const show = (n) => { if (el) el.textContent = k(Math.round(n)); if (meter && o.budget_tokens) meter.style.width = Math.min(100, (100 * n) / o.budget_tokens) + '%'; };
  cancelAnimationFrame(LIVE.tokAnim);
  if (Math.round(from) === target || reduced() || !from) { LIVE.tok = target; show(target); return; }
  if (el && target > from) { el.classList.remove('up'); void el.offsetWidth; el.classList.add('up'); }
  const t0 = performance.now(), step = (t) => { const p = Math.min(1, (t - t0) / 700), n = from + (target - from) * (1 - Math.pow(1 - p, 3)); LIVE.tok = n; show(n); if (p < 1) LIVE.tokAnim = requestAnimationFrame(step); };
  LIVE.tokAnim = requestAnimationFrame(step);
}
function paintHead(o) {
  const busyN = LIVE.members.filter((m) => busyOf(o, m.agent)).length;
  const rid = routineOf(o), rt = rid && state.routines.find((x) => x.id === rid);
  const html = `<span class="ref">${esc(o.ref)}</span><span class="st ${o.status}">${STATUS[o.status] || o.status}</span>
    <span class="crew">${busyN ? `<span class="pulse"></span>${busyN} trabajando` : 'nadie trabajando en este momento'}</span>
    <span class="dmeta">${rt ? `⟳ <a data-nav href="${esc(url.routine(o.team, rid))}">${esc(rt.name)}</a> · ` : ''}${o.turns} ronda${o.turns === 1 ? '' : 's'} · <span id="lvTok" class="tok"></span>${o.budget_tokens ? ' de ' + k(o.budget_tokens) : ''} tokens</span>${passLinksHtml(o)}
    ${o.budget_tokens ? `<span class="meter ${o.spent > o.budget_tokens * 0.8 ? 'hot' : ''}"><i id="lvMeter"></i></span>` : ''}
    ${(() => { const ov = (o.seats || []).filter((s) => overCap(o, s)); return ov.length ? `<button type="button" class="lvwarn" data-capall title="Qué pasa y qué podés hacer">${ICONS.warn}${ov.map((s) => esc(s.role || s.agent)).join(', ')} ${ov.length === 1 ? 'pasó su' : 'pasaron su'} tope diario</button>` : ''; })()}
    <span class="spacer"></span>${o.team ? '<button data-diag title="Qué está trabado y cómo destrabarlo">Revisar</button>' : ''}<button data-log>Registro</button>${o.status === 'paused' ? '<button data-resume>Seguir (más presupuesto)</button>' : ''}<button class="no" data-cancel>Cancelar</button>`;
  if (LIVE.head !== html) { LIVE.head = html; $('#lvHead').innerHTML = html; bindObjButtons(o); const ca = $('#lvHead [data-capall]'); if (ca) ca.onclick = () => capPop(ca, LIVE.o, (LIVE.o.seats || []).filter((s) => overCap(LIVE.o, s))); const t = Math.round(LIVE.tok); if ($('#lvTok')) $('#lvTok').textContent = k(t); }
  tokTo(o);
}
function paintTicker(o) {
  const roleOf = (a) => ((o.seats || []).find((s) => s.agent === a) || {}).role || a;
  const ids = new Set((o.ledger || []).map((r) => r.id));
  LIVE.extra = LIVE.extra.filter((r) => !ids.has(r.id));
  const rows = [...LIVE.extra, ...(o.ledger || [])].sort((a, b) => b.id - a.id).slice(0, 4);
  const html = `<span class="lbl">lo último</span>${rows.map((r) => `<span class="ti" data-id="${r.id}"><span class="t">${hhmm(r.at)}</span>${tickerLine(r, roleOf)}</span>`).join('') || '<span class="ti">todavía nada</span>'}`;
  if (LIVE.ticker === html) return;
  const seen = new Set([...document.querySelectorAll('#lvTicker .ti[data-id]')].map((x) => x.dataset.id));
  LIVE.ticker = html; $('#lvTicker').innerHTML = html;
  if (seen.size) document.querySelectorAll('#lvTicker .ti[data-id]').forEach((x) => { if (!seen.has(x.dataset.id)) x.classList.add('new'); });
}

// ---- los eventos en vivo (SSE) ----
const onLivePage = () => state.route.page === 'obj' && LIVE.o && state.liveKey === 'live:' + LIVE.o.id;
function liveConnect() {
  if (LIVE.es || typeof EventSource === 'undefined') return;
  try { LIVE.es = new EventSource(BASE + '/api/events'); } catch (e) { LIVE.es = null; return; }
  LIVE.es.onopen = () => (LIVE.esOk = true);
  LIVE.es.addEventListener('event', (e) => { let ev; try { ev = JSON.parse(e.data); } catch (x) { return; } if (ev.topic && ev.topic.startsWith('team.')) onLive(ev); });
  LIVE.es.onerror = () => { liveDisconnect(); setTimeout(() => { if (onLivePage()) liveConnect(); }, 3000); };
  clearInterval(LIVE.watch); LIVE.watch = setInterval(() => { if (!onLivePage()) liveDisconnect(); }, 4000);
}
function liveDisconnect() { if (LIVE.es) LIVE.es.close(); LIVE.es = null; LIVE.esOk = false; clearInterval(LIVE.watch); }
const soonReload = (ms = 120) => { clearTimeout(LIVE.reload); LIVE.reload = setTimeout(() => { if (onLivePage()) loadObj(); }, ms); };
function onLive(ev) {
  if (!onLivePage()) { liveDisconnect(); return; }
  const o = LIVE.o, d = ev.data || {}, scope = o.team ? 'team:' + o.team : 'objective:' + o.id;
  if (d.scope !== scope || !LIVE.members.some((m) => m.agent === (d.agent || d.actor))) return;
  if (ev.topic === 'team.step') onStep(d); else if (ev.topic === 'team.ledger') onLedger(o, d);
  paintSeats(o); paintHead(o);
}
function onStep(d) {
  const a = d.agent, x = d.data || {}, at = d.at || Date.now() / 1000;
  const setAct = (icon, html) => (LIVE.act[a] = { icon, html, at });
  if (d.kind === 'turn_start') { LIVE.busy[a] = { v: true, at: Date.now() }; setAct('think', 'arranca su turno…'); }
  else if (d.kind === 'busy' && x.what === 'llm') setAct('think', 'pensando…');
  else if (d.kind === 'tool_call') {
    let args = {}; try { args = JSON.parse(x.args); } catch (e) { args = salvageArgs(x.args); }
    setAct(actOf(x.name, args), sayCall(x.name, args));
    if (x.name === 'send' && args.recipient) sendFly(a, args.recipient);
  } else if (d.kind === 'tool_result') hit(a, x.ok ? 'ok' : 'bad');
  else if (d.kind === 'tool_denied') { hit(a, 'bad'); setAct('block', 'no se le permitió: ' + esc(short(x.reason, 90))); }
  else if (d.kind === 'assistant') { if (String(x.text || '').trim()) bubble(a, mdInline(short(x.text, 220))); }
  else if (d.kind === 'usage') { const p = LIVE.pend[a] || (LIVE.pend[a] = { cost: 0, ended: false }); p.cost += x.cost || 0; p.ended = false; }
  else if (d.kind === 'turn_end') { LIVE.busy[a] = { v: false, at: Date.now() }; delete LIVE.act[a]; if (LIVE.pend[a]) LIVE.pend[a].ended = true; soonReload(400); }
}
function onLedger(o, r) {
  LIVE.extra.unshift(r); LIVE.extra = LIVE.extra.slice(0, 8); LIVE.flown.add(r.id);
  if (r.kind === 'message') {
    const to = String(r.ref).replace('→', '').trim();
    if (Date.now() - (LIVE.sent[r.actor + '>' + to] || 0) > 15000) sendFly(r.actor, to);
  } else if (r.kind === 'handed off') { handoffFly(o, r); soonReload(150);
  } else if (['added', 'claimed', 'updated'].includes(r.kind)) {
    const id = +String(r.ref || '').replace('#', ''); if (id) LIVE.flights.push({ agent: r.actor, id });
    soonReload(80);
  } else soonReload(150);
  paintTicker(o);
}

async function renderLive(o) {
  const key = 'live:' + o.id, el = $('#objDetail');
  const team = o.team ? teamOf(o.team) : null;
  const roleOf = (a) => ((o.seats || []).find((s) => s.agent === a) || {}).role || a;
  // el esqueleto, una vez por objetivo
  if (state.liveKey !== key) {
    state.liveKey = key; LIVE.key = null; LIVE.rects = null; LIVE.flowSig = ''; LIVE.view = {}; LIVE.kanban = ''; LIVE.head = ''; LIVE.ticker = '';
    LIVE.act = {}; LIVE.busy = {}; LIVE.pend = {}; LIVE.extra = []; LIVE.flights = []; LIVE.tok = 0; LIVE.lastSpent = null; LIVE.flown = new Set();
    LIVE.seenLedger = Math.max(0, ...(o.ledger || []).map((r) => r.id));
    el.classList.add('lvmode');
    el.innerHTML = `<div class="lvhead" id="lvHead"></div><div class="lvask" id="lvAsk"></div><div class="lvdiag" id="lvDiag" hidden></div>
      <div class="lvgrid"><section class="lvstage"><div class="lvlabel">El equipo, ahora</div><div id="lvStage"></div></section>
        <section class="lvboard"><div class="lvlabel">Tablero <span class="live2">● en vivo</span></div><div class="kanban" id="lvKanban"></div></section></div>
      <div class="lvticker" id="lvTicker"></div>`;
    LIVE.flow = Flow.create($('#lvStage'));
  }
  LIVE.o = o;
  liveConnect();
  await liveSteps(o);
  if (state.route.obj !== o.id || state.liveKey !== key) return;
  LIVE.key = key; LIVE.o = o;
  const seats = o.seats || [];
  const members = team ? team.members : seats.map((s) => ({ agent: s.agent, role: s.role, reports_to: '' }));
  LIVE.members = [...members].sort((a, b) => (b.agent === o.agent) - (a.agent === o.agent));
  $('#lvAsk').innerHTML = `<p class="${state.askOpen ? '' : 'clamp'}"><b>Qué se pidió:</b> ${esc(unescapeU(o.text))}</p>${o.text.length > 160 ? `<button class="lnk" data-ask>${state.askOpen ? 'ver menos' : 'ver todo'}</button>` : ''}
    ${o.status === 'waiting' ? `<div class="box q"><h5>${o.pass_pending ? 'quiere pasarle el trabajo a otro equipo' : o.question_kind === 'approval' ? 'te pide aprobación' : 'te pregunta'}</h5><p>${questionHtml(o)}</p><p class="ds">Respondé arriba, en la franja de lo que te espera.</p></div>` : ''}`;
  // el equipo se dibuja solo si cambió quién está o cómo se une; lo demás se pinta encima
  const edges = members.filter((m) => m.reports_to && members.some((x) => x.agent === m.reports_to)).map((m) => ({ kind: 'reports', from: m.reports_to, to: m.agent }))
    .concat(((team && team.talks) || []).map(([x, y]) => ({ kind: 'talk', from: x, to: y })));
  const sig = members.map((m) => m.agent + '/' + (m.role || '')).join(',') + '|' + edges.map((e) => e.kind + e.from + e.to).join(',') + '|' + o.agent;
  if (LIVE.flowSig !== sig) {
    LIVE.flowSig = sig; LIVE.view = {};
    const nodes = members.map((m) => ({ id: m.agent, title: m.role || m.agent, avatar: avatarOf(m.role || m.agent), lead: m.agent === o.agent, cls: 'lv', html: '<button type="button" class="lvover" hidden></button><div class="lvact"><span class="tx"></span></div><div class="lvtasks"></div>' }));
    LIVE.flow.render({ nodes, edges, editable: false, storeKey: 'lampson.flow:' + BASE + ':' + (o.team || 'solo-' + o.agent), onSelect: (a) => { if (a) openDrawer('seat', a); } });
  }
  paintSeats(o);
  paintHead(o);
  // respaldo sin eventos: los mensajes nuevos que trae el sondeo (y que no llegaron en vivo) igual viajan
  const fresh = (o.ledger || []).filter((r) => r.id > LIVE.seenLedger && !LIVE.flown.has(r.id)).sort((a, b) => a.id - b.id);
  fresh.filter((r) => r.kind === 'message').forEach((r, i) => setTimeout(() => sendFly(r.actor, String(r.ref).replace('→', '').trim()), i * 350));
  fresh.filter((r) => r.kind === 'handed off').forEach((r) => { LIVE.flown.add(r.id); handoffFly(o, r); });
  LIVE.seenLedger = Math.max(LIVE.seenLedger, ...(o.ledger || []).map((r) => r.id));
  // el tablero, solo si cambió (rehacerlo en cada pulso reinicia las ruedas)
  const busy = new Set(LIVE.members.filter((m) => busyOf(o, m.agent)).map((m) => m.agent)), kh = kanbanHtml(o, roleOf, busy);
  if (LIVE.kanban !== kh) { LIVE.kanban = kh; flipKanban($('#lvKanban'), kh); }
  flyCards();
  paintTicker(o);
  diagBanner(o);
  if (state.drawer) renderDrawer(o);
}
// los botones del objetivo (en vivo y en el informe)
function bindObjButtons(o) {
  const c = $('#objDetail [data-cancel]');
  if (c) c.onclick = async () => { if (c.dataset.sure) { await api(`objectives/${o.id}/cancel`, {}); refresh(); } else { c.dataset.sure = '1'; c.textContent = '¿seguro? cancelar'; } };
  const rs = $('#objDetail [data-resume]'); if (rs) rs.onclick = () => reply(o.id, 'Seguí: te doy más presupuesto.', false);
  const ak = $('#objDetail [data-ask]'); if (ak) ak.onclick = () => { state.askOpen = !state.askOpen; loadObj(); };
  const lg = $('#objDetail [data-log]'); if (lg) lg.onclick = () => openDrawer('log');
  const dg = $('#objDetail [data-diag]'); if (dg) dg.onclick = () => openDrawer('diag');
  state.objNow = o;
}
// el panel de la derecha: el registro completo, o los pasos de un asiento
function openDrawer(kind, agent) { state.drawer = state.drawer && state.drawer.kind === kind && state.drawer.agent === agent ? null : { kind, agent }; if (kind === 'diag') DIAG.drawn = null; if (state.objNow) renderDrawer(state.objNow); }
async function renderDrawer(o) {
  const d = $('#objDrawer'); d.hidden = !state.drawer; if (!state.drawer) return;
  $('#odClose').onclick = () => { state.drawer = null; d.hidden = true; };
  if (state.drawer.kind === 'log') { $('#odTitle').textContent = 'Registro de ' + o.ref; $('#objLog').hidden = false; $('#odSeat').hidden = true; logHtml(o.ledger || [], $('#objLog')); return; }
  if (state.drawer.kind === 'diag') { $('#odTitle').textContent = 'Revisar qué pasa · ' + o.ref; $('#objLog').hidden = true; $('#odSeat').hidden = false; renderDiag(o); return; }
  DIAG.drawn = null;
  const a = state.drawer.agent, s = (o.seats || []).find((x) => x.agent === a);
  $('#odTitle').textContent = 'Pasos de ' + ((s && s.role) || a); $('#objLog').hidden = true; $('#odSeat').hidden = false;
  const seats = await loadSeatWork(o), w = seats.find((x) => x.agent === a);
  const box = $('#odSeat'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = w ? seatTimelineHtml(w.turns, a) : '<p class="ihint">Sin pasos todavía.</p>';
  box.querySelectorAll('details[data-k]').forEach((x) => (x.ontoggle = () => { if (x.open) state.openRaw.add(x.dataset.k); else state.openRaw.delete(x.dataset.k); }));
  if (atBottom) box.scrollTop = box.scrollHeight;   // mientras trabaja, la línea de tiempo crece y se sigue sola
}
