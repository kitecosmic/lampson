// tree.js — árbol de archivos (panel derecho) con estado git, el visor de archivos y el explorador:
// clic derecho = menú contextual (nuevo archivo/carpeta, abrir, renombrar, duplicar, copiar/cortar/pegar,
// copiar ruta relativa/absoluta, insertar la ruta en el chat, eliminar), arrastrar y soltar para mover
// (Ctrl al soltar = copiar; sobre un archivo = a su carpeta), F2 / Supr / Ctrl+C·X·V sobre la fila
// seleccionada. Las operaciones van a POST /api/fs (lib/fs.syn) y nunca pisan un destino existente.
// Las carpetas abiertas se recuerdan (localStorage lampson.tree.open) para que un cambio no las cierre.
let gitStatus = { changes: {} };
let treeRoot = '';        // ruta absoluta del workspace (para «copiar ruta absoluta»)
let treeSel = null;       // {path, is_dir, row}: última fila clickeada (izquierdo o derecho)
let treeClip = null;      // {path, is_dir, op: 'copy'|'cut'}
let treeDrag = null;      // {path, is_dir} mientras se arrastra
const openDirs = new Set((() => { try { return JSON.parse(localStorage.getItem('lampson.tree.open') || '[]'); } catch (e) { return []; } })());
function saveOpen() { try { localStorage.setItem('lampson.tree.open', JSON.stringify([...openDirs])); } catch (e) {} }

async function loadGit() {
  try { gitStatus = await (await fetch(BASE + '/api/git')).json(); } catch (e) { gitStatus = { repo: false, changes: {} }; }
  const g = $('#git'); if (!gitStatus.repo) { g.style.display = 'none'; return; }
  const k = gitStatus.counts || {}; const nuevos = (k.added||0)+(k.untracked||0);
  const parts = []; // solo contadores distintos de cero — lo demás es ruido
  if (k.modified) parts.push(`<b class="w">~${k.modified}</b>`);
  if (nuevos) parts.push(`<b class="g">+${nuevos}</b>`);
  if (k.deleted) parts.push(`<b class="r">−${k.deleted}</b>`);
  g.innerHTML = `⎇ <span class="br">${esc(gitStatus.branch)}</span>` + (parts.length ? parts.join('') : '<b class="c">✓</b>');
  g.title = parts.length ? `${k.modified||0} modificados · ${nuevos} nuevos · ${k.deleted||0} borrados` : 'working tree limpio';
  g.style.display = 'flex';
}
function gitClass(path, isDir) {
  const ch = gitStatus.changes || {};
  if (!isDir) { const c = ch[path]; return c === '??' ? 'gU' : c === 'A' ? 'gA' : c === 'D' ? 'gD' : c ? 'gM' : ''; }
  const p = path + '/'; for (const k in ch) if (k.startsWith(p)) return 'gM'; return '';
}
function parentOf(p) { const i = p.lastIndexOf('/'); return i < 0 ? '.' : p.slice(0, i); }
function baseOf(p) { return p.slice(p.lastIndexOf('/') + 1); }
function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
function rowOf(path) { return $('#tree').querySelector(`.row[data-path="${cssEsc(path)}"]`); }

async function loadTree() {
  await loadGit();
  const box = $('#tree'); box.innerHTML = ''; box.tabIndex = 0;
  let t; try { t = await (await fetch(BASE + '/api/tree')).json(); } catch (e) { box.innerHTML = '<div class="row none">sin árbol</div>'; return; }
  treeRoot = t.root || '';
  const render = (entries, parent) => {
    for (const e of entries) {
      const n = document.createElement('div'); n.className = 'node';
      const gc = gitClass(e.path, e.is_dir); const code = (gitStatus.changes || {})[e.path];
      const cut = treeClip && treeClip.op === 'cut' && treeClip.path === e.path;
      const r = document.createElement('div'); r.className = 'row' + (e.is_dir ? ' dir' : '') + (gc ? ' ' + gc : '') + (cut ? ' cut' : '');
      r.title = e.path + (code ? ' · git ' + code : ''); r.dataset.path = e.path; r.dataset.dir = e.is_dir ? '1' : '';
      r.innerHTML = `<span class="tw">${e.is_dir ? '▸' : ''}</span><span class="nm">${esc(e.name)}${e.is_dir ? '/' : ''}</span>` + (code && !e.is_dir ? `<span class="gs">${code === '??' ? 'N' : code}</span>` : '');
      n.appendChild(r);
      wireRow(r, e);
      if (e.is_dir) {
        const open = openDirs.has(e.path);
        const k = document.createElement('div'); k.className = 'kids' + (open ? '' : ' hidden'); render(e.children || [], k); n.appendChild(k);
        r.querySelector('.tw').textContent = open ? '▾' : '▸';
        r.onclick = () => { select(r, e); toggleDir(r, k, e.path); };
      } else { r.onclick = () => { select(r, e); openFile(e.path, r); }; }
      parent.appendChild(n);
    }
  };
  render(t.entries || [], box);
  if (t.truncated) { const d = document.createElement('div'); d.className = 'row none'; d.textContent = '… árbol truncado'; box.appendChild(d); }
  if (treeSel) { const r = rowOf(treeSel.path); if (r) { treeSel.row = r; r.classList.add('sel'); } else treeSel = null; }
  const vp = $('#vpath').textContent; const ar = vp && rowOf(vp); if (ar && $('#viewer').style.display !== 'none') ar.classList.add('active');
}
function toggleDir(r, k, path) {
  k.classList.toggle('hidden'); const open = !k.classList.contains('hidden');
  r.querySelector('.tw').textContent = open ? '▾' : '▸';
  if (open) openDirs.add(path); else openDirs.delete(path); saveOpen();
}
function expandDir(path) { if (!path || path === '.') return; openDirs.add(path); saveOpen(); }
function select(r, e) {
  document.querySelectorAll('#tree .row.sel').forEach(x => x.classList.remove('sel'));
  r.classList.add('sel'); treeSel = { path: e.path, is_dir: e.is_dir, row: r };
}

// ---- arrastrar y soltar: mover (Ctrl = copiar); sobre un archivo = a la carpeta del archivo ----
function canDrop(d, dir) {
  if (!d) return false;
  if (parentOf(d.path) === dir) return false;                                   // ya está ahí
  if (d.is_dir && (dir === d.path || dir.startsWith(d.path + '/'))) return false; // carpeta dentro de sí misma
  return true;
}
function wireRow(r, e) {
  r.oncontextmenu = ev => { ev.preventDefault(); ev.stopPropagation(); select(r, e); showMenu(ev.clientX, ev.clientY, { path: e.path, is_dir: e.is_dir, row: r }); };
  r.draggable = true;
  r.ondragstart = ev => { treeDrag = { path: e.path, is_dir: e.is_dir }; ev.dataTransfer.effectAllowed = 'copyMove'; ev.dataTransfer.setData('text/plain', e.path); r.classList.add('dragging'); };
  r.ondragend = () => { treeDrag = null; r.classList.remove('dragging'); document.querySelectorAll('#tree .drop').forEach(x => x.classList.remove('drop')); };
  // soltar sobre una carpeta = dentro de ella; sobre un archivo = en la carpeta del archivo (se ilumina esa)
  const dir = e.is_dir ? e.path : parentOf(e.path);
  const lit = () => (e.is_dir ? r : (rowOf(dir) || $('#tree')));
  r.ondragover = ev => { if (!canDrop(treeDrag, dir)) return; ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = ev.ctrlKey ? 'copy' : 'move'; lit().classList.add('drop'); };
  r.ondragleave = () => lit().classList.remove('drop');
  r.ondrop = ev => { ev.preventDefault(); ev.stopPropagation(); document.querySelectorAll('#tree .drop, #tree.drop').forEach(x => x.classList.remove('drop')); dropInto(dir, ev.ctrlKey); };
}
async function dropInto(dir, copy) {
  const d = treeDrag; treeDrag = null;
  if (!canDrop(d, dir)) return;
  await fsOp(copy ? { op: 'copy', path: d.path, to: dir } : { op: 'move', path: d.path, to: dir }, res => { expandDir(dir); if (!copy) afterMove(d.path, res.path); });
}
{
  const box = $('#tree');
  box.ondragover = ev => { if (!canDrop(treeDrag, '.')) return; ev.preventDefault(); ev.dataTransfer.dropEffect = ev.ctrlKey ? 'copy' : 'move'; box.classList.add('drop'); };
  box.ondragleave = () => box.classList.remove('drop');
  box.ondrop = ev => { ev.preventDefault(); box.classList.remove('drop'); dropInto('.', ev.ctrlKey); };
  box.oncontextmenu = ev => { if (ev.target.closest('.row')) return; ev.preventDefault(); showMenu(ev.clientX, ev.clientY, null); };
  box.onkeydown = ev => {
    if (ev.target.tagName === 'INPUT' || !treeSel) return;
    const s = treeSel; const key = ev.key.toLowerCase();
    if (ev.key === 'F2') { ev.preventDefault(); renameInline(s); }
    else if (ev.key === 'Delete') { ev.preventDefault(); const b = s.row.getBoundingClientRect(); showMenu(b.left + 60, b.bottom, s, 'delete'); }
    else if (ev.ctrlKey && key === 'c') { ev.preventDefault(); setClip(s, 'copy'); }
    else if (ev.ctrlKey && key === 'x') { ev.preventDefault(); setClip(s, 'cut'); }
    else if (ev.ctrlKey && key === 'v') { ev.preventDefault(); pasteInto(s.is_dir ? s.path : parentOf(s.path)); }
    else if (ev.key === 'Escape') { closeMenu(); }
  };
}

// ---- operaciones (POST /api/fs) ----
async function fsOp(body, onOk) {
  const r = await api(BASE + '/api/fs', body);
  if (!r.ok) { add('denied', esc((r.data && r.data.error) || 'error')); loadTree(); return null; }
  const res = r.data.result || {};
  if (onOk) onOk(res);
  await loadTree();
  return res;
}
function afterMove(oldPath, newPath) {
  if (treeClip && treeClip.path === oldPath) treeClip = null;
  if (treeSel && treeSel.path === oldPath) treeSel.path = newPath;
  const vp = $('#vpath'); const v = vp.textContent;
  if (v === oldPath || v.startsWith(oldPath + '/')) vp.textContent = newPath + v.slice(oldPath.length);
}
function afterDelete(path) {
  if (treeClip && treeClip.path === path) treeClip = null;
  if (treeSel && (treeSel.path === path || treeSel.path.startsWith(path + '/'))) treeSel = null;
  const v = $('#vpath').textContent; if (v === path || v.startsWith(path + '/')) { $('#vpath').textContent = ''; showPane('log'); }
}
function setClip(s, op) { treeClip = { path: s.path, is_dir: s.is_dir, op }; loadTree(); }
function canPaste(dir) {
  if (!treeClip) return false;
  if (treeClip.op === 'cut') return canDrop(treeClip, dir);
  return !(treeClip.is_dir && (dir === treeClip.path || dir.startsWith(treeClip.path + '/')));
}
async function pasteInto(dir) {
  if (!canPaste(dir)) return;
  const c = treeClip;
  await fsOp(c.op === 'cut' ? { op: 'move', path: c.path, to: dir } : { op: 'copy', path: c.path, to: dir }, res => { expandDir(dir); if (c.op === 'cut') { afterMove(c.path, res.path); treeClip = null; } });
}
function absPath(path) {
  if (!treeRoot) return path;
  const sep = treeRoot.includes('\\') ? '\\' : '/';
  const root = treeRoot.replace(/[\\/]+$/, '');
  return path === '.' ? root : root + sep + path.split('/').join(sep);
}
function copyText(t, row) {
  const done = () => { if (row) { row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 700); } };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => copyFallback(t, done)); else copyFallback(t, done);
}
function copyFallback(t, done) { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); done(); }
function insertInChat(path) {
  const ta = $('#in'); const v = ta.value;
  ta.value = v + (v && !/\s$/.test(v) ? ' ' : '') + path + ' ';
  ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---- nuevo archivo / carpeta y renombrar: un input en la propia fila ----
function nameInput(r, value, onDone) {
  const nm = r.querySelector('.nm'); const inp = document.createElement('input'); inp.className = 'rn'; inp.value = value; inp.spellcheck = false;
  nm.replaceWith(inp); inp.focus();
  const dot = value.startsWith('.') ? -1 : value.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 ? dot : value.length);
  let finished = false;
  const finish = ok => { if (finished) return; finished = true; onDone(ok ? inp.value.trim() : null); };
  inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } };
  inp.onblur = () => finish(false);
  inp.onclick = ev => ev.stopPropagation(); inp.oncontextmenu = ev => ev.stopPropagation();
}
function newEntry(dir, isDir) {
  closeMenu();
  const box = $('#tree');
  let holder = box;
  if (dir !== '.') {
    const r = rowOf(dir); if (!r) return;
    const k = r.parentNode.querySelector('.kids'); if (k.classList.contains('hidden')) toggleDir(r, k, dir);
    holder = k;
  }
  const n = document.createElement('div'); n.className = 'node';
  const r = document.createElement('div'); r.className = 'row new' + (isDir ? ' dir' : ''); r.innerHTML = `<span class="tw">${isDir ? '▸' : ''}</span><span class="nm"></span>`;
  n.appendChild(r); holder.insertBefore(n, holder.firstChild);
  nameInput(r, '', name => {
    n.remove();
    if (!name) return;
    fsOp({ op: isDir ? 'mkdir' : 'create', path: dir, name }, res => { expandDir(dir); treeSel = { path: res.path, is_dir: !!res.is_dir }; if (!isDir) openFile(res.path); });
  });
}
function renameInline(s) {
  closeMenu();
  const r = s.row || rowOf(s.path); if (!r) return;
  const old = baseOf(s.path);
  nameInput(r, old, name => {
    if (!name || name === old) { loadTree(); return; }
    fsOp({ op: 'rename', path: s.path, name }, res => afterMove(s.path, res.path));
  });
}

// ---- menú contextual ----
let ctxEl = null;
function closeMenu() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
document.addEventListener('mousedown', ev => { if (ctxEl && !ctxEl.contains(ev.target)) closeMenu(); }, true);
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeMenu(); });
window.addEventListener('blur', closeMenu); window.addEventListener('resize', closeMenu);
$('#tree').addEventListener('scroll', closeMenu);
// e = {path, is_dir, row} o null (raíz); only = 'delete' abre solo la confirmación de borrado (tecla Supr)
function showMenu(x, y, e, only) {
  closeMenu();
  const isRoot = !e; const path = isRoot ? '.' : e.path; const isDir = isRoot || e.is_dir; const row = e && e.row;
  const dir = isDir ? path : parentOf(path);      // carpeta donde se crea o se pega
  const items = [];
  const del = { l: 'Eliminar', k: 'Supr', danger: true, confirm: '¿eliminar ' + baseOf(path) + (isDir ? '/' : '') + '?', f: () => fsOp({ op: 'delete', path }, () => afterDelete(path)) };
  if (only === 'delete') items.push(del);
  else {
    if (!isDir) items.push({ l: 'Abrir', f: () => openFile(path, row) });
    items.push({ l: 'Nuevo archivo…', f: () => newEntry(dir, false) }, { l: 'Nueva carpeta…', f: () => newEntry(dir, true) }, 'sep');
    if (!isRoot) items.push({ l: 'Renombrar', k: 'F2', f: () => renameInline(e) }, { l: 'Duplicar', f: () => fsOp({ op: 'copy', path }) }, 'sep', { l: 'Copiar', k: 'Ctrl+C', f: () => setClip(e, 'copy') }, { l: 'Cortar', k: 'Ctrl+X', f: () => setClip(e, 'cut') });
    items.push({ l: 'Pegar' + (treeClip ? ' «' + baseOf(treeClip.path) + '»' : ''), k: 'Ctrl+V', dis: !canPaste(dir), f: () => pasteInto(dir) }, 'sep');
    items.push({ l: 'Copiar ruta', f: () => copyText(path, row) }, { l: 'Copiar ruta absoluta', dis: !treeRoot, f: () => copyText(absPath(path), row) }, { l: 'Insertar en el chat', f: () => insertInChat(path) });
    if (!isRoot) items.push('sep', del);
    items.push('sep', { l: 'Recargar', f: loadTree });
  }
  const m = document.createElement('div'); m.className = 'ctx';
  for (const it of items) {
    if (it === 'sep') { const s = document.createElement('div'); s.className = 'sep'; m.appendChild(s); continue; }
    const d = document.createElement('div'); d.className = 'it' + (it.dis ? ' dis' : '') + (it.danger ? ' danger' : '');
    d.innerHTML = `<span>${esc(it.l)}</span>` + (it.k ? `<span class="k">${esc(it.k)}</span>` : '');
    d.onclick = ev => { ev.stopPropagation(); if (it.confirm) inlineConfirm(d, it.confirm, () => { closeMenu(); it.f(); }); else { closeMenu(); it.f(); } };
    m.appendChild(d);
  }
  document.body.appendChild(m); ctxEl = m;
  const W = window.innerWidth, H = window.innerHeight, mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(4, Math.min(x, W - mw - 4)) + 'px'; m.style.top = Math.max(4, Math.min(y, H - mh - 4)) + 'px';
  if (only === 'delete') { const first = m.querySelector('.it'); if (first) first.click(); }
}

async function openFile(path, row) {
  document.querySelectorAll('.row.active').forEach(x => x.classList.remove('active')); if (row) row.classList.add('active');
  const r = await fetch(BASE + '/api/file?path=' + encodeURIComponent(path)); const d = await r.json();
  if (!r.ok) { add('denied', esc(d.error || 'error')); return; }
  $('#vpath').textContent = d.path; $('#vmeta').textContent = d.lines + ' líneas';
  $('#vbody').className = ''; $('#vbody').innerHTML = String(d.content).split('\n').map((l, i) => `<span class="ln">${i + 1}</span>${esc(l)}`).join('\n');
  showPane('viewer'); $('#stage').scrollTop = 0;
}
// el árbol se refresca solo cuando una tool pudo crear/borrar archivos, con un pequeño debounce; ↻ lo fuerza a mano
function treeChanged() { debounce('tree', loadTree, 400); }
$('#tree-reload').onclick = e => { e.stopPropagation(); const b = e.currentTarget; b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin'); loadTree(); };
$('#vclose').onclick = () => { showPane('log'); procOpen = null; clearInterval(procTimer); $('#vbody').className = ''; document.querySelectorAll('.row.active, .m.active, .p.active').forEach(x => x.classList.remove('active')); memOpen = null; };
