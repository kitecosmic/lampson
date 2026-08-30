// terminal.js — terminales reales: xterm.js ↔ WebSocket /api/term ↔ un pty por terminal en el servidor.
// Frames de texto: "o" + salida del pty · "c" + JSON de control (hello / exit). Conviven varias como
// pestañas (cada una con su shell); minimizar esconde el panel con todas vivas y el botón del encabezado
// lo trae de vuelta; ✕ mata la shell de la activa (la última cierra el panel).
// La shell NO vive en el socket sino en un agente del servidor (lib/term.syn): recargar la página no la
// mata — al cargar pedimos /api/terms y nos reenganchamos por id, con replay de lo último que imprimió.
const MAX_TERMS = 4;
let terms = [];        // [{id, el, term, ws, fit, ro, box, meta, live}]
let termAt = -1;       // índice de la activa en terms
// qué estaba abierto antes del F5 (el panel y la pestaña activa; las shells las sabe el servidor)
function saveTermUi() {
  try {
    localStorage.setItem('lampson.term.open', termShown() ? '1' : '0');
    localStorage.setItem('lampson.term.at', String(termAt));
    localStorage.setItem('lampson.term.max', $('#termpane').classList.contains('max') ? '1' : '0');
  } catch (e) {}
}
function termTheme() {
  const s = getComputedStyle(document.documentElement); const v = n => s.getPropertyValue(n).trim();
  return { background: v('--paper'), foreground: v('--ink'), cursor: v('--accent'), cursorAccent: v('--paper'), selectionBackground: v('--sel'),
    black: v('--paper-3'), brightBlack: v('--ink-3'), red: v('--rubric'), brightRed: v('--rubric'), green: v('--str'), brightGreen: v('--str'),
    yellow: v('--amber'), brightYellow: v('--amber'), blue: v('--term-blue'), brightBlue: v('--accent'), magenta: v('--rubric'), brightMagenta: v('--rubric'),
    cyan: v('--accent'), brightCyan: v('--accent'), white: v('--ink-2'), brightWhite: v('--ink') };
}
// ojo: el display inicial lo pone el CSS, no el style inline — mirando sólo el inline, «está abierto»
// daba true antes del primer showPane() y la restauración se creía abierta
const termShown = () => getComputedStyle($('#termpane')).display !== 'none';
// Un solo lugar donde se ajusta el tamaño. fit() hace clear() + resize() del terminal y dispara un
// resize del pty (el shell repinta entero), así que sólo se llama cuando la caja cambió DE VERDAD:
// sin esa guarda, el ResizeObserver se realimenta con su propio ajuste y el terminal parpadea.
function fitTerm(t) {
  if (!t || !t.fit || !termShown()) return;
  const box = t.el.clientWidth + 'x' + t.el.clientHeight;
  if (!t.el.clientWidth || !t.el.clientHeight || box === t.box) return;
  t.box = box;
  requestAnimationFrame(() => { if (t.term && t.fit) try { t.fit.fit(); } catch (e) {} }); // fuera del callback del observer
}
// pestañas: una por terminal (siempre visibles, también con una sola: así se ve que hay numeración)
function paintTabs() {
  const tabs = $('#ttabs'); tabs.innerHTML = '';
  terms.forEach((t, i) => {
    const b = document.createElement('span');
    b.className = 'ttab' + (i === termAt ? ' on' : '') + (t.live ? '' : ' dead');
    b.textContent = String(i + 1);
    b.title = 'terminal ' + (i + 1) + (t.meta ? ' · ' + t.meta : '') + (t.live ? '' : ' (shell terminada)');
    b.onclick = () => activateTerm(i); tabs.appendChild(b);
  });
  const add = $('#tnew'); add.disabled = terms.length >= MAX_TERMS;
  add.title = add.disabled ? 'máximo ' + MAX_TERMS + ' terminales abiertas' : 'abrir otra terminal: una shell nueva en el workspace';
  const t = terms[termAt];
  $('#tmeta').textContent = t ? t.meta : '';
  $('#termpane').classList.toggle('live', !!(t && t.live));
  $('#term').classList.toggle('live', terms.some(x => x.live));   // el botón del encabezado: hay shell viva
}
function activateTerm(i) {
  termAt = i;
  terms.forEach((t, k) => { t.el.style.display = k === i ? '' : 'none'; });
  paintTabs(); saveTermUi();
  const t = terms[i];
  if (!t) return;
  t.box = ''; fitTerm(t); t.term.refresh(0, t.term.rows - 1); t.term.focus();
}
// id = reengancharse a una shell que ya existe (tras un F5); show = false para reconstruir sin abrir el panel
function newTerm(id, show) {
  if (terms.length >= MAX_TERMS) return;
  if (show !== false) { showPane('term'); procOpen = null; clearInterval(procTimer); }
  const el = document.createElement('div'); el.className = 'xt'; $('#xterms').appendChild(el);
  const term = new Terminal({ cursorBlink: true, fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'), fontSize: 13, lineHeight: 1.25, theme: termTheme(), scrollback: 5000, allowProposedApi: true });
  const fit = new FitAddon.FitAddon(); term.loadAddon(fit);
  const t = { id: id || '', el, term, fit, ws: null, ro: null, box: '', meta: 'conectando…', live: false };
  terms.push(t);
  if (show !== false) termAt = terms.length - 1;
  terms.forEach((x, k) => { x.el.style.display = k === termAt ? '' : 'none'; });
  term.open(el); fitTerm(t);
  // URLs clickeables (npm run dev imprime http://localhost:3000): link provider mínimo con la API nativa
  // de xterm v5 — el addon web-links no está vendorizado y no hace falta para http/https
  const TERM_URL_RE = /https?:\/\/[^\s"'`<>()\[\]{}]*[^\s"'`<>()\[\]{}.,;:!?]/g;
  term.registerLinkProvider({
    provideLinks(y, cb) {
      const line = term.buffer.active.getLine(y - 1);
      if (!line) return cb(undefined);
      const text = line.translateToString(true);
      const links = []; let m; TERM_URL_RE.lastIndex = 0;
      while ((m = TERM_URL_RE.exec(text))) {
        links.push({ range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } }, text: m[0], activate: (_e, uri) => window.open(uri, '_blank') });
      }
      cb(links.length ? links : undefined);
    }
  });
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + BASE + '/api/term' + (id ? '?id=' + encodeURIComponent(id) : ''));
  ws.binaryType = 'arraybuffer'; t.ws = ws;
  const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  t.send = send;
  ws.onopen = () => { t.live = true; paintTabs(); send({ type: 'resize', cols: term.cols, rows: term.rows }); if (termAt === terms.indexOf(t)) term.focus(); };
  ws.onmessage = (e) => { // "o" + salida del pty | "c" + JSON de control
    const s = String(e.data);
    if (s[0] === 'o') { term.write(s.slice(1)); return; }
    let m; try { m = JSON.parse(s.slice(1)); } catch { return; }
    if (m.type === 'hello') { t.id = m.id || t.id; t.meta = `${m.shell} · pid ${m.pid} · ${m.cwd || 'workspace'}`; paintTabs(); }
    if (m.type === 'exit') {
      t.live = false; paintTabs();
      if (m.error === 'too_many') { term.write(`\r\n\x1b[2m[ya hay ${MAX_TERMS} terminales abiertas — cerrá una para abrir otra]\x1b[0m\r\n`); return; }
      term.write(`\r\n\x1b[2m[shell terminado · código ${m.code}]\x1b[0m\r\n`);
    }
  };
  // el socket se corta pero la shell sigue viva en el servidor: se recupera recargando (o al volver a entrar)
  ws.onclose = () => {
    t.live = false;
    if (t.meta === 'conectando…') t.meta = 'sin conexión';
    else if (!t.killed) term.write('\r\n\x1b[2m[conexión perdida · la shell sigue viva: recargá la página para reengancharte]\x1b[0m\r\n');
    paintTabs();
  };
  term.onData(d => send({ type: 'in', data: d }));
  term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
  t.ro = new ResizeObserver(() => fitTerm(t)); t.ro.observe(el);
  paintTabs(); saveTermUi();
}
// el botón del encabezado: abre la primera, trae de vuelta el panel minimizado, o lo esconde si está a la vista.
// Espera a saber qué shells sobrevivieron (termsReady): sin eso, un clic apurado abriría una shell de más.
function openTerm() {
  termsReady.then(() => {
    if (!terms.length) { newTerm(); return; }
    if (termShown()) { minTerm(); return; }
    showPane('term'); procOpen = null; clearInterval(procTimer);
    activateTerm(termAt < 0 || termAt >= terms.length ? terms.length - 1 : termAt);
    saveTermUi();
  });
}
// minimizar: el panel se esconde, las shells siguen vivas (el botón del encabezado queda verde y lo devuelve)
function minTerm() { maxTerm(false); showPane('log'); saveTermUi(); }
// pantalla completa: el panel tapa la ventana entera; se vuelve con el mismo botón (❐).
function maxTerm(on) {
  const pane = $('#termpane');
  const max = on === undefined ? !pane.classList.contains('max') : on;
  pane.classList.toggle('max', max);
  $('#tmax').innerHTML = max ? '&#10064;' : '&#9633;';
  $('#tmax').title = max ? 'volver al tamaño normal' : 'pantalla completa';
  saveTermUi();
  const t = terms[termAt];
  if (t) { t.box = ''; fitTerm(t); t.term.focus(); }
}
// repintar las terminales abiertas al cambiar de tema (lo llama theme.js; ojo: «term» a secas es el BOTÓN
// del encabezado — los id del HTML son globales — así que el repintado tiene que pasar por acá)
function termsRetheme() { const th = termTheme(); terms.forEach(t => { t.term.options.theme = th; }); }
// cerrar: sólo la terminal activa. Hay que PEDIR la muerte de la shell ({type:"kill"}): irse del socket
// ya no la mata (ese es el precio, y la gracia, de que sobreviva a un F5). La última cierra el panel.
function closeTerm() {
  const t = terms[termAt];
  if (!t) { showPane('log'); return; }
  t.killed = true;
  if (t.ro) t.ro.disconnect();
  if (t.ws) try { t.send({ type: 'kill' }); t.ws.close(); } catch (e) {}
  t.term.dispose(); t.el.remove();
  terms.splice(termAt, 1);
  if (!terms.length) { termAt = -1; paintTabs(); maxTerm(false); showPane('log'); saveTermUi(); return; }
  activateTerm(Math.min(termAt, terms.length - 1));
}
// al cargar: las shells que sobrevivieron al F5 vuelven como pestañas (el panel sólo si estaba abierto)
async function restoreTerms() {
  let data; try { data = await (await fetch(BASE + '/api/terms')).json(); } catch (e) { return; }
  const live = (data && data.terminals) || [];
  if (!live.length) return;
  // leer ANTES de crear nada: cada newTerm guarda el estado y pisaría lo que dejó la sesión anterior
  let open = false, at = 0, max = false;
  try {
    open = localStorage.getItem('lampson.term.open') === '1';
    at = +(localStorage.getItem('lampson.term.at') || 0);
    max = localStorage.getItem('lampson.term.max') === '1';
  } catch (e) {}
  const yaAbrio = terms.length > 0;   // alguien abrió una mientras preguntábamos: no le movemos la vista
  for (const info of live) newTerm(info.id, false);
  if (yaAbrio) { paintTabs(); return; }
  termAt = Math.max(0, Math.min(at, terms.length - 1));
  if (open) { showPane('term'); procOpen = null; clearInterval(procTimer); if (max) maxTerm(true); activateTerm(termAt); }
  else { terms.forEach((t, k) => { t.el.style.display = k === termAt ? '' : 'none'; }); paintTabs(); }
}
const termsReady = restoreTerms();   // se lanza al cargar; openTerm la espera
$('#term').onclick = openTerm;
$('#tnew').onclick = newTerm;
$('#tmin').onclick = minTerm;
$('#tmax').onclick = () => maxTerm();
$('#tclose').onclick = closeTerm;
// Sin atajo para salir de pantalla completa: Esc es del shell (vim, menús) y robársela rompería el terminal.
// El botón ❐ queda a la vista en la cabecera, que es lo único que se dibuja fuera del área del terminal.
