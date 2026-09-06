// editor.js — editor de archivos del visor: un textarea transparente (caret, selección, teclado nativo) sobre un
// <pre> con el mismo texto resaltado por highlight.js (vendor/highlight.min.js = build "common" + powershell +
// dockerfile; Synsema se registra acá, traducido de la gramática TextMate oficial del repo kitecosmic/synsema,
// editors/vscode/syntaxes/synsema.tmLanguage.json). El gutter con los números va aparte y sigue el scroll.
//
// Guardar: Ctrl+S o el botón → POST /api/fs {op:"write"} (lib/fs.syn: solo archivos que existen, dentro del
// workspace). Antes de guardar se relee el archivo: si cambió en disco (el agente lo editó mientras tanto) se
// avisa y se elige sobrescribir o recargar, nunca se pisa a ciegas. Cambiar de archivo con cambios sin guardar
// no los pierde: quedan como borrador en memoria y vuelven al reabrirlo (se pierden al recargar la página, con aviso).
// Solo lectura: archivos truncados por la API (> 200k) y binarios — guardar un recorte destruiría el archivo.

const LANG_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  css: 'css', scss: 'scss', less: 'less', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml', xsl: 'xml', plist: 'xml',
  json: 'json', jsonc: 'json', md: 'markdown', markdown: 'markdown', py: 'python', rs: 'rust', go: 'go',
  sh: 'bash', bash: 'bash', zsh: 'bash', env: 'bash', ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  yml: 'yaml', yaml: 'yaml', sql: 'sql', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp',
  java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift', rb: 'ruby', php: 'php', lua: 'lua', r: 'r', pl: 'perl',
  ini: 'ini', toml: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', diff: 'diff', patch: 'diff', graphql: 'graphql', gql: 'graphql',
  wasm: 'wasm', wat: 'wasm', syn: 'synsema', fsyn: 'synsema', txt: 'plaintext', log: 'plaintext', csv: 'plaintext', lock: 'plaintext',
  prisma: 'prisma', tsbuildinfo: 'json', map: 'json', webmanifest: 'json', jsonl: 'json', har: 'json', mdx: 'markdown', proto: 'protobuf',
  bat: 'dos', cmd: 'dos', psql: 'sql', pgsql: 'sql', mysql: 'sql', m: 'objectivec', csproj: 'xml', xaml: 'xml', astro: 'xml', ejs: 'xml', hbs: 'xml',
  // nombres de fence habituales en el chat que no son extensiones
  javascript: 'javascript', typescript: 'typescript', python: 'python', rust: 'rust', shell: 'bash', powershell: 'powershell',
  synsema: 'synsema', html5: 'xml', dockerfile: 'dockerfile', makefile: 'makefile', text: 'plaintext', plaintext: 'plaintext'
};
const LANG_BY_NAME = { dockerfile: 'dockerfile', makefile: 'makefile', gnumakefile: 'makefile', '.env': 'bash', '.env.example': 'bash', '.gitignore': 'plaintext', '.gitattributes': 'plaintext', '.npmrc': 'ini', '.editorconfig': 'ini', '.nvmrc': 'plaintext', '.babelrc': 'json', '.eslintrc': 'json', '.prettierrc': 'json', '.swcrc': 'json', 'nginx.conf': 'nginx', procfile: 'plaintext' };
function langOf(path) {
  const base = String(path || '').split('/').pop().toLowerCase();
  if (LANG_BY_NAME[base]) return LANG_BY_NAME[base];
  if (base.startsWith('.env')) return 'bash';            // .env.local, .env.production…
  if (base.startsWith('dockerfile')) return 'dockerfile'; // Dockerfile.dev
  const i = base.lastIndexOf('.'); const ext = i >= 0 ? base.slice(i + 1) : '';
  return LANG_BY_EXT[ext] || 'plaintext';
}
// código en un bloque ``` del chat (core.js md()): resaltado si el fence trae un lenguaje conocido
function hlCode(code, lang) {
  if (typeof hljs === 'undefined') return esc(code);
  const l = String(lang || '').toLowerCase(); const name = LANG_BY_EXT[l] || (l && hljs.getLanguage(l) ? l : '');
  if (!name || name === 'plaintext' || code.length > 60000) return esc(code);
  try { return hljs.highlight(code, { language: name, ignoreIllegals: true }).value; } catch (e) { return esc(code); }
}

// ---- Synsema para highlight.js (misma partición que el tmLanguage: control, tipos, seguridad, agentes, LLM,
// humano, observabilidad, serve, módulos; builtins solo cuando se llaman; task/type/agent + nombre = definición) ----
function synsemaGrammar(hljs) {
  const KEYWORDS = [
    'when', 'otherwise', 'each', 'while', 'repeat', 'match', 'is', 'try', 'recover', 'give', 'stop', 'then', 'and_then', 'return',
    'let', 'be', 'set', 'to', 'task', 'type', 'agent', 'state',
    'and', 'or', 'not', 'in', 'of', 'as', 'with',
    'spawn', 'share', 'observe', 'signal', 'wait_for',
    'analyze', 'decide', 'reason', 'generate',
    'approve', 'confirm', 'ask', 'show',
    'trace', 'log', 'measure', 'checkpoint',
    'serve', 'on', 'route', 'auth', 'errors', 'requires', 'expect', 'max_body', 'max_streams', 'stream', 'send', 'static', 'cache', 'fallback', 'cors', 'describe', 'private', 'from', 'domain', 'tls', 'redirect', 'proxy', 'host', 'paged', 'per', 'rate_limit', 'unlimited', 'none', 'mount', 'at',
    'use', 'export', 'routes', 'enum'
  ];
  const SECURITY = ['require', 'allow', 'deny', 'sandbox', 'intent', 'invariant', 'verify'];
  const BUILTINS = ['print', 'text', 'length', 'append', 'range', 'contains', 'split', 'join', 'type_of', 'matches', 'find_all', 'capture', 'replace_re', 'fetch', 'read_file', 'write_file', 'http', 'http_get', 'http_post', 'sql', 'sql_exec', 'sql_tables', 'db_open', 'db_close', 'format_time', 'parse_time', 'date_parts', 'now', 'sleep', 'apply', 'where', 'reduce', 'collect', 'transform', 'sort_by', 'group_by', 'every', 'some', 'flatten', 'parallel_map', 'chunk', 'remember', 'recall', 'forget_memory', 'add_rule', 'check_rules', 'get_rules', 'memory_summary', 'create_progress', 'start_step', 'complete_step', 'fail_step', 'resume_point', 'progress_display', 'progress_percent', 'ok', 'created', 'not_found', 'fail', 'html', 'respond', 'render', 'page', 'heading', 'prose', 'list', 'ordered_list', 'link', 'image', 'section', 'code', 'raw', 'content'];
  const NUMBER = { scope: 'number', match: /\b[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?\b/ };
  const CALL = { scope: 'built_in', match: new RegExp('\\b(' + BUILTINS.join('|') + ')(?=\\s*\\()') };
  // {expr} dentro de un string: termina en }, pero también ante la comilla que cierra el string o al final de la
  // línea, así una llave sin cerrar no arrastra el color
  const subst = (quote) => ({ scope: 'subst', begin: /\{/, end: new RegExp('\\}|(?=' + quote + ')|$'), keywords: { keyword: KEYWORDS, literal: ['true', 'false', 'nothing'] }, contains: [NUMBER, CALL] });
  return {
    name: 'Synsema', aliases: ['syn', 'fsyn'],
    keywords: { $pattern: /[A-Za-z_][A-Za-z0-9_]*/, keyword: KEYWORDS, literal: ['true', 'false', 'nothing'] },
    contains: [
      hljs.COMMENT('--', '$'),
      // los strings no cruzan líneas: end también en $ (hljs compila con la bandera m). Sin esto una comilla o un
      // backtick sin cerrar pintaban el resto del archivo como string (visto 2026-09-05 con un ` suelto en un .syn)
      { scope: 'string', begin: /"/, end: /"|$/, contains: [{ scope: 'char.escape', match: /\\./ }, subst('"')] },
      { scope: 'string', begin: /`/, end: /`|$/, contains: [{ scope: 'char.escape', match: /\\./ }, subst('`')] },
      { match: [/\b(task|type|agent)\b/, /\s+/, /[A-Za-z_][A-Za-z0-9_]*/], scope: { 1: 'keyword', 3: 'title.function' } },
      { scope: 'keyword.security', match: new RegExp('\\b(' + SECURITY.join('|') + ')\\b') },
      CALL,
      NUMBER
    ]
  };
}
// Prisma (schema.prisma): highlight.js no lo trae. Bloques model/enum/datasource/generator, tipos escalares,
// atributos @id/@@map, env("…"), comentarios // y ///.
function prismaGrammar(hljs) {
  return {
    name: 'Prisma', aliases: ['prisma'],
    keywords: {
      keyword: ['model', 'enum', 'type', 'view', 'datasource', 'generator'],
      built_in: ['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Unsupported'],
      literal: ['true', 'false', 'null']
    },
    contains: [
      hljs.COMMENT('///', '$'), hljs.COMMENT('//', '$'),
      { scope: 'string', begin: /"/, end: /"|$/, contains: [{ scope: 'char.escape', match: /\\./ }] },
      { match: [/\b(model|enum|type|view|datasource|generator)\b/, /\s+/, /[A-Za-z_]\w*/], scope: { 1: 'keyword', 3: 'title.class' } },
      { scope: 'attribute', match: /@@?[A-Za-z_][\w.]*/ },
      { scope: 'built_in', match: /\benv(?=\()/ },
      { scope: 'number', match: /\b\d+(\.\d+)?\b/ }
    ]
  };
}
if (typeof hljs !== 'undefined') { hljs.registerLanguage('synsema', synsemaGrammar); hljs.registerLanguage('prisma', prismaGrammar); }

// ---- estado ----
const ED = { path: '', loaded: null, lang: 'plaintext', dirty: false, readonly: false, saving: false };
const drafts = new Map(); // path → texto sin guardar (al cambiar de archivo no se pierde nada)
const eta = $('#eta'), ehl = $('#ehl'), egut = $('#egut'), edBox = $('#editor');
const HL_MAX = 120000;    // más que esto se muestra sin resaltar (hljs tardaría en cada tecla)
const HL_SYNC_MAX = 30000; // hasta acá el espejo se redibuja en el mismo tick que la tecla; después con debounce corto

function edVisible() { return !edBox.hidden && $('#viewer').style.display !== 'none' && !!ED.path; }
function edDirty() { return ED.dirty; }

// abre la respuesta de GET /api/file en el editor (tree.js openFile). Un borrador guardado gana al disco.
function edOpen(d) {
  edStash();
  ED.path = d.path; ED.loaded = String(d.content ?? ''); ED.lang = langOf(d.path); ED.saving = false;
  const binary = /\u0000/.test(ED.loaded);
  ED.readonly = !!d.truncated || binary;
  const draft = drafts.get(ED.path);
  eta.value = !ED.readonly && draft != null && draft !== ED.loaded ? draft : ED.loaded;
  ED.dirty = eta.value !== ED.loaded;
  eta.readOnly = ED.readonly;
  $('#vbody').hidden = true; edBox.hidden = false; $('#viewer').classList.add('edit');
  edRender(); edMeta(d.truncated ? 'archivo muy grande · solo lectura' : binary ? 'binario · solo lectura' : '');
  eta.scrollTop = 0; eta.scrollLeft = 0; edSync();
  if (!ED.readonly) eta.focus({ preventScroll: true });
}
function edStash() { if (!ED.path) return; if (ED.dirty) drafts.set(ED.path, eta.value); else drafts.delete(ED.path); }
// cierra el editor (✕ del visor, tras confirmar si había cambios); el visor vuelve a su <pre> de texto
function edClose(discard) {
  if (discard) drafts.delete(ED.path); else edStash();
  ED.path = ''; ED.loaded = null; ED.dirty = false;
  edBox.hidden = true; $('#vbody').hidden = false; $('#viewer').classList.remove('edit');
}
// el visor va a mostrar texto plano (logs de procesos/agentes, showText): el editor se esconde sin perder borradores
function viewerText() { if (!edBox.hidden) edClose(false); }

function edRender() {
  const src = eta.value; let html;
  if (src.length > HL_MAX || ED.lang === 'plaintext' || typeof hljs === 'undefined') html = esc(src);
  else { try { html = hljs.highlight(src, { language: ED.lang, ignoreIllegals: true }).value; } catch (e) { html = esc(src); } }
  // el espacio final: un <pre> no pinta la última línea vacía, el textarea sí; así ambos miden lo mismo
  ehl.firstElementChild.innerHTML = html + '\n ';
  const n = src.split('\n').length;
  if (egut.childElementCount !== n) { let g = ''; for (let i = 1; i <= n; i++) g += '<span>' + i + '</span>'; egut.innerHTML = g; }
}
function edSync() { ehl.scrollTop = eta.scrollTop; ehl.scrollLeft = eta.scrollLeft; egut.style.transform = 'translateY(' + (-eta.scrollTop) + 'px)'; }
function edMeta(note, bad) {
  const n = eta.value.split('\n').length;
  const parts = [ED.lang === 'plaintext' ? 'texto' : ED.lang, n + (n === 1 ? ' línea' : ' líneas')];
  if (ED.dirty) parts.push('<b class="dirty">● sin guardar</b>');
  if (note) parts.push(`<span class="${bad ? 'err' : 'note'}">${esc(note)}</span>`);
  $('#vmeta').innerHTML = parts.join(' · ');
  const b = $('#vsave'); b.hidden = ED.readonly; b.disabled = !ED.dirty || ED.saving;
}

// ---- guardar ----
async function edSave(force) {
  if (!edVisible() || ED.readonly || ED.saving) return;
  const content = eta.value, path = ED.path;
  if (!ED.dirty && !force) return;
  ED.saving = true; edMeta('guardando…');
  try {
    if (!force) { // ¿cambió en disco desde que lo abrimos? (el agente pudo escribirlo mientras tanto)
      const r0 = await fetch(BASE + '/api/file?path=' + encodeURIComponent(path)); const d0 = await r0.json();
      if (r0.ok && String(d0.content) !== ED.loaded) { ED.saving = false; edConflict(); return; }
    }
    const r = await api(BASE + '/api/fs', { op: 'write', path, content });
    if (!r.ok) { ED.saving = false; edMeta(r.data.error || 'no se pudo guardar', true); return; }
    if (ED.path === path) { ED.loaded = content; ED.dirty = eta.value !== content; } // el usuario pudo seguir tipeando
    drafts.delete(path); ED.saving = false;
    edMeta('guardado'); setTimeout(() => { if (ED.path === path && !ED.dirty) edMeta(); }, 1800);
    if (typeof treeChanged === 'function') treeChanged();
  } catch (e) { ED.saving = false; edMeta('no se pudo guardar: ' + e.message, true); }
}
function edConflict() {
  $('#vmeta').innerHTML = `<span class="warn">cambió en disco mientras lo editabas</span> · <a href="#" id="edover">sobrescribir</a> · <a href="#" id="edreload">recargar (pierde tus cambios)</a>`;
  $('#edover').onclick = ev => { ev.preventDefault(); edSave(true); };
  $('#edreload').onclick = ev => { ev.preventDefault(); drafts.delete(ED.path); ED.dirty = false; openFile(ED.path); };
}
// una tool del agente pudo tocar el archivo abierto (chat.js): sin cambios locales se recarga solo conservando el
// scroll; con cambios locales se avisa y el conflicto se resuelve al guardar
async function edTouched(path) {
  if (!edVisible()) return;
  const p = path ? String(path).replace(/\\/g, '/').replace(/^\.\//, '') : '';
  if (p && p !== ED.path) return;
  try {
    const r = await fetch(BASE + '/api/file?path=' + encodeURIComponent(ED.path)); const d = await r.json();
    if (!r.ok || String(d.content) === ED.loaded) return;
    if (ED.dirty) { edMeta('el agente cambió este archivo en disco · al guardar podés sobrescribir o recargar', true); return; }
    const st = eta.scrollTop, sl = eta.scrollLeft;
    ED.loaded = String(d.content); eta.value = ED.loaded; ED.readonly = !!d.truncated; eta.readOnly = ED.readonly;
    edRender(); edMeta('actualizado: el agente lo cambió'); eta.scrollTop = st; eta.scrollLeft = sl; edSync();
    setTimeout(() => { if (!ED.dirty) edMeta(); }, 2500);
  } catch (e) {}
}

// ---- teclado y eventos ----
function edInsert(t) {
  if (!document.execCommand || !document.execCommand('insertText', false, t)) { // execCommand conserva el undo del navegador
    eta.setRangeText(t, eta.selectionStart, eta.selectionEnd, 'end'); eta.dispatchEvent(new Event('input'));
  }
}
eta.addEventListener('input', () => {
  ED.dirty = eta.value !== ED.loaded;
  if (eta.value.length > HL_SYNC_MAX) debounce('edhl', edRender, 40); else edRender();
  edMeta(); edSync();
});
eta.addEventListener('scroll', edSync);
eta.addEventListener('keydown', ev => {
  if (ED.readonly) return;
  if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey) {
    ev.preventDefault();
    const v = eta.value, s = eta.selectionStart, e = eta.selectionEnd;
    if (s === e || !v.slice(s, e).includes('\n')) { if (!ev.shiftKey) edInsert('    '); return; } // 4 espacios: la indentación de Synsema
    // varias líneas seleccionadas: indentar / desindentar el bloque
    const ls = v.lastIndexOf('\n', s - 1) + 1; let le = v.indexOf('\n', e - 1); if (le < 0) le = v.length;
    const lines = v.slice(ls, le).split('\n');
    const out = lines.map(l => ev.shiftKey ? l.replace(/^(    |\t| {1,3})/, '') : '    ' + l).join('\n');
    eta.setSelectionRange(ls, le); edInsert(out); eta.setSelectionRange(ls, ls + out.length);
  } else if (ev.key === 'Enter' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) {
    ev.preventDefault();
    const v = eta.value, s = eta.selectionStart; const ls = v.lastIndexOf('\n', s - 1) + 1;
    const ind = (v.slice(ls, s).match(/^[ \t]*/) || [''])[0];
    edInsert('\n' + ind); // conserva la indentación de la línea anterior
  } else if (ev.key === 'Escape') { eta.blur(); }
});
document.addEventListener('keydown', ev => {
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 's' && edVisible()) { ev.preventDefault(); edSave(); }
});
$('#vsave').onclick = () => edSave();
window.addEventListener('beforeunload', ev => { if (ED.dirty || drafts.size) { ev.preventDefault(); ev.returnValue = ''; } });
