// core.js — estado compartido y helpers que usan todos los módulos (se carga primero)
const $ = s => document.querySelector(s);
// detrás del hub la UI vive en /w/<slug>/ y su API en /w/<slug>/api/…; standalone (sin hub) BASE = ''
const BASE = (location.pathname.match(/^\/w\/[^/]+/) || [''])[0];
const WS_SLUG = BASE ? BASE.slice(3) : '';
const log = $('#log');
let session = new URLSearchParams(location.search).get('session') || localStorage.getItem('lampson.session') || '';
let busy = false; let cfg = {};

function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function md(src) { // Markdown mínimo: code fences, inline code, bold, headers, listas, párrafos
  const blocks = []; src = String(src ?? '').replace(/```(\w*)\n([\s\S]*?)```/g, (m, l, c) => { blocks.push('<pre><code>' + esc(c) + '</code></pre>'); return '\uE000' + (blocks.length - 1) + '\uE001'; }); // marcador = índice entre U+E000/U+E001, NUNCA dígitos a secas (se perdieron dos veces al reescribir el archivo y todo número salía undefined)
  let h = esc(src).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  h = h.split(/\n{2,}/).map(p => {
    if (/^\uE000\d+\uE001$/.test(p.trim())) return p;
    if (/^#{1,3} /.test(p)) return '<h3>' + p.replace(/^#{1,3} /, '') + '</h3>';
    if (/^(\s*[-*] .*\n?)+$/.test(p)) return '<ul>' + p.split('\n').map(l => '<li>' + l.replace(/^\s*[-*] /, '') + '</li>').join('') + '</ul>';
    if (/^(\s*\d+[.)] .*\n?)+$/.test(p)) return '<ol>' + p.split('\n').map(l => '<li>' + l.replace(/^\s*\d+[.)] /, '') + '</li>').join('') + '</ol>';
    return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');
  return h.replace(/\uE000(\d+)\uE001/g, (m, i) => blocks[+i]);
}
// un bloque en el chat: 'user' | 'assistant' | 'step' | 'meta' | 'denied' | 'approval' | 'working'
function add(cls, html) { showPane('log'); log.classList.remove('hero'); const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html; log.appendChild(d); $('#stage').scrollTop = $('#stage').scrollHeight; return d; }
function describe(c) { const a = c.args || {}; if (c.name === 'bash') return '$ ' + (a.command || ''); if (c.name === 'fetch') return 'fetch ' + (a.url || '') + (a.format && a.format !== 'markdown' ? ' (' + a.format + ')' : ''); if (c.name === 'delegate') return 'delegate → ' + a.agent + ': ' + String(a.brief || '').slice(0, 80); if (a.path) return c.name + ' ' + a.path; if (a.pattern) return c.name + ' ' + a.pattern; if (a.name) return c.name + ' ' + a.name; return c.name + ' ' + JSON.stringify(a); }
function cmdHtml(text) { const t = String(text); const long = t.length > 220 || t.split('\n').length > 4; return `<span class="cmd">${esc(t)}</span>` + (long ? ' <span class="more">ver todo</span>' : ''); }
function wireMore(el) { const m = el.querySelector('.more'); if (m) m.onclick = () => { el.querySelector('.cmd').classList.toggle('open'); m.textContent = el.querySelector('.cmd').classList.contains('open') ? 'menos' : 'ver todo'; }; }
// POST JSON → {ok, status, data}
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {}; try { data = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, data };
}
// zona central: 'log' | 'viewer' | 'term'
function showPane(which) {
  log.style.display = which === 'log' ? '' : 'none';
  $('#viewer').style.display = which === 'viewer' ? 'block' : 'none';
  $('#termpane').style.display = which === 'term' ? 'flex' : 'none';
  // volver al chat = al final de la conversación (el viewer de archivos deja el scroll de #stage arriba)
  if (which === 'log') $('#stage').scrollTop = $('#stage').scrollHeight;
}
// visor de texto (archivo, log, traza, memoria): título, meta y contenido plano
function showText(title, meta, text, toEnd) {
  $('#vpath').textContent = title; $('#vmeta').textContent = meta || '';
  const pre = $('#vbody'); pre.className = 'log'; pre.textContent = text;
  showPane('viewer'); $('#stage').scrollTop = toEnd ? $('#stage').scrollHeight : 0;
}
// confirmación en línea (sin confirm() del navegador): el ✕ se convierte en «¿borrar? sí · no»
function inlineConfirm(el, label, onYes) {
  const prev = el.innerHTML; el.classList.add('ask');
  el.innerHTML = `<span class="q">${esc(label)}</span> <span class="yes">sí</span> · <span class="no">no</span>`;
  const restore = () => { el.innerHTML = prev; el.classList.remove('ask'); };
  el.querySelector('.yes').onclick = (ev) => { ev.stopPropagation(); onYes(); };
  el.querySelector('.no').onclick = (ev) => { ev.stopPropagation(); restore(); };
  setTimeout(() => { if (el.classList.contains('ask')) restore(); }, 6000);
}
const debounces = {};
function debounce(key, fn, ms) { clearTimeout(debounces[key]); debounces[key] = setTimeout(fn, ms); }
function fmtWhen(ts) { if (!ts) return '—'; return new Date(ts * 1000).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function fmtIso(s) { return String(s || '').replace('T', ' ').replace('Z', ''); }
function fmtOff(sec) { const a = Math.abs(sec), h = Math.floor(a / 3600), m = Math.floor((a % 3600) / 60); return (sec < 0 ? '-' : '+') + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
function hl(s, q) { const t = esc(s); if (!q) return t; const i = t.toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? t : t.slice(0, i) + '<mark>' + t.slice(i, i + q.length) + '</mark>' + t.slice(i + q.length); }
// portada cuando no hay conversación
function empty() {
  const name = (cfg.workspace || '').split(/[\\/]/).filter(Boolean).pop() || 'workspace';
  log.classList.add('hero');
  log.innerHTML = `<div class="empty">
    <p class="eyebrow">workspace</p>
    <h1>${esc(name)}</h1>
    <p class="lead">Un agente con herramientas acotadas a este proyecto. Vos pedís; él lee, busca, edita y corre comandos — y cada paso queda a la vista.</p>
    <div class="grid">
      <div class="card"><h3>Probá</h3>
        <p><span class="try">Explicame la estructura de este proyecto</span></p>
        <p><span class="try">¿Dónde está el punto de entrada y qué hace?</span></p>
        <p><span class="try">Buscá TODOs y proponé un plan para resolverlos</span></p>
        <p><span class="try">Corré los tests y contame qué falla</span></p></div>
      <div class="card"><h3>Agentes</h3>
        <p><span class="k">build</span> edita y ejecuta (por defecto)</p>
        <p><span class="k">plan</span> solo lectura: investiga y propone</p>
        <p><span class="k">review</span> lee y corre tests, no edita</p>
        <p><span class="k">explore</span> localiza código</p></div>
      <div class="card"><h3>Qué puede tocar</h3>
        <p>Solo archivos dentro de <code>${esc(name)}/</code>.</p>
        <p>Comandos peligrosos (<code>rm -rf</code>, <code>git push --force</code>, <code>sudo</code>…) según el selector <span class="k">permisos</span>: preguntar, permitir todo o denegar.</p>
        <p>Lo destructivo del sistema se bloquea siempre.</p></div>
      <div class="card"><h3>Cómo lo ve el modelo</h3>
        <p>Cada tool y su resultado — errores y rechazos incluidos — queda en el historial y se le reenvía en cada turno.</p>
        <p>Hacé clic en un archivo del panel de archivos para verlo. Un mensaje que empieza con <code>!</code> lo corrés vos, sin el modelo.</p></div>
    </div></div>`;
  log.querySelectorAll('.try').forEach(el => el.onclick = () => { $('#in').value = el.textContent; $('#in').focus(); });
}
