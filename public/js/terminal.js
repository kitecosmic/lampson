// terminal.js — terminal real: xterm.js ↔ WebSocket /api/term ↔ pty en el servidor
// Frames binarios = bytes del pty; texto JSON = control (hello / exit). Cerrar el panel cierra el socket y mata el shell.
let term = null, termWs = null, termFit = null;
function termTheme() {
  const s = getComputedStyle(document.documentElement); const v = n => s.getPropertyValue(n).trim();
  return { background: v('--paper'), foreground: v('--ink'), cursor: v('--accent'), cursorAccent: v('--paper'), selectionBackground: v('--sel'),
    black: v('--paper-3'), brightBlack: v('--ink-3'), red: v('--rubric'), brightRed: v('--rubric'), green: v('--str'), brightGreen: v('--str'),
    yellow: v('--amber'), brightYellow: v('--amber'), blue: v('--term-blue'), brightBlue: v('--accent'), magenta: v('--rubric'), brightMagenta: v('--rubric'),
    cyan: v('--accent'), brightCyan: v('--accent'), white: v('--ink-2'), brightWhite: v('--ink') };
}
function openTerm() {
  if (term) { showPane('term'); termFit.fit(); term.focus(); return; }
  showPane('term'); procOpen = null; clearInterval(procTimer);
  term = new Terminal({ cursorBlink: true, fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'), fontSize: 13, lineHeight: 1.25, theme: termTheme(), scrollback: 5000, allowProposedApi: true });
  termFit = new FitAddon.FitAddon(); term.loadAddon(termFit); term.open($('#xterm')); termFit.fit();
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
  $('#tmeta').textContent = 'conectando…';
  termWs = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/term'); termWs.binaryType = 'arraybuffer';
  const send = (o) => { if (termWs && termWs.readyState === 1) termWs.send(JSON.stringify(o)); };
  termWs.onopen = () => { $('#termpane').classList.add('live'); send({ type: 'resize', cols: term.cols, rows: term.rows }); term.focus(); };
  termWs.onmessage = (e) => { // "o" + salida del pty | "c" + JSON de control
    const s = String(e.data);
    if (s[0] === 'o') { term.write(s.slice(1)); return; }
    let m; try { m = JSON.parse(s.slice(1)); } catch { return; }
    if (m.type === 'hello') $('#tmeta').textContent = `${m.shell} · pid ${m.pid} · ${m.cwd || 'workspace'}`;
    if (m.type === 'exit') { term.write(`\r\n\x1b[2m[shell terminado · código ${m.code}]\x1b[0m\r\n`); $('#termpane').classList.remove('live'); }
  };
  termWs.onclose = () => { $('#termpane').classList.remove('live'); if ($('#tmeta').textContent === 'conectando…') $('#tmeta').textContent = 'sin conexión'; };
  term.onData(d => send({ type: 'in', data: d }));
  term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
  new ResizeObserver(() => { if ($('#termpane').style.display !== 'none') termFit.fit(); }).observe($('#xterm'));
}
function closeTerm() { if (termWs) { try { termWs.close(); } catch (e) {} } if (term) term.dispose(); term = null; termWs = null; termFit = null; $('#xterm').innerHTML = ''; $('#termpane').classList.remove('live'); showPane('log'); }
$('#term').onclick = openTerm;
$('#tclose').onclick = closeTerm;
