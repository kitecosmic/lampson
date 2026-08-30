// tree.js — árbol de archivos (panel derecho) con estado git, y el visor de archivos
let gitStatus = { changes: {} };
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
async function loadTree() {
  await loadGit();
  const box = $('#tree'); box.innerHTML = '';
  let t; try { t = await (await fetch(BASE + '/api/tree')).json(); } catch (e) { box.innerHTML = '<div class="row none">sin árbol</div>'; return; }
  const render = (entries, parent, depth) => {
    for (const e of entries) {
      const n = document.createElement('div'); n.className = 'node';
      const gc = gitClass(e.path, e.is_dir); const code = (gitStatus.changes || {})[e.path];
      const r = document.createElement('div'); r.className = 'row' + (e.is_dir ? ' dir' : '') + (gc ? ' ' + gc : ''); r.title = e.path + (code ? ' · git ' + code : '');
      r.innerHTML = `<span class="tw">${e.is_dir ? '▸' : ''}</span><span>${esc(e.name)}${e.is_dir ? '/' : ''}</span>` + (code && !e.is_dir ? `<span class="gs">${code === '??' ? 'N' : code}</span>` : '');
      n.appendChild(r);
      if (e.is_dir) {
        const k = document.createElement('div'); k.className = 'kids hidden'; render(e.children || [], k, depth + 1); n.appendChild(k);
        r.querySelector('.tw').textContent = '▸';
        r.onclick = () => { k.classList.toggle('hidden'); r.querySelector('.tw').textContent = k.classList.contains('hidden') ? '▸' : '▾'; };
      } else { r.onclick = () => openFile(e.path, r); }
      parent.appendChild(n);
    }
  };
  render(t.entries || [], box, 0);
  if (t.truncated) { const d = document.createElement('div'); d.className = 'row none'; d.textContent = '… árbol truncado'; box.appendChild(d); }
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
