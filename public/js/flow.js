// flow.js — un lienzo de nodos al estilo React Flow, sin dependencias (lo usa la pantalla de equipos, js/teams.js).
// Fondo de puntos; arrastrar el fondo lo desplaza, la rueda hace zoom; los nodos se arrastran y su posición se guarda
// en el navegador (opts.storeKey). Editando, cada nodo tiene un punto abajo: arrastrado hasta otro nodo, ese nodo pasa
// a reportarle (la jerarquía); soltado en el vacío, crea uno nuevo ahí que le reporta. Una conexión se elige con un
// clic y se quita con su ✕ o con Supr.
//
//   const f = Flow.create(elemento)
//   f.render({ nodes: [{id, title, desc, meta, lead, loose, avatar, working, missing, at}], edges: [{kind:'reports'|'talk', from, to, hot}],
//              editable, selected, storeKey, onSelect(id|null), onConnect(from, to), onConnectEmpty(from, pos), onDeleteEdge(edge) })
//   f.fit() · f.center(id) · f.freeSpot() → una posición libre para un nodo nuevo
const Flow = (() => {
  const NW = 232, NH = 118, GAPX = 44, ROWH = 170;
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // orden automático: niveles por jefe (raíces arriba), cada nivel centrado
  function autoLayout(nodes, edges) {
    const boss = {}; edges.filter((e) => e.kind === 'reports').forEach((e) => (boss[e.to] = e.from));
    const level = {};
    const lv = (id, seen = new Set()) => { if (level[id] !== undefined) return level[id]; const b = boss[id]; if (!b || seen.has(id) || !nodes.some((n) => n.id === b)) return (level[id] = 0); seen.add(id); return (level[id] = lv(b, seen) + 1); };
    nodes.forEach((n) => lv(n.id));
    const rows = {}; nodes.forEach((n) => (rows[level[n.id]] = rows[level[n.id]] || []).push(n.id));
    const pos = {};
    Object.entries(rows).forEach(([l, ids]) => ids.forEach((id, i) => (pos[id] = { x: (i - (ids.length - 1) / 2) * (NW + GAPX) - NW / 2, y: Number(l) * ROWH })));
    return pos;
  }

  function create(root) {
    root.classList.add('flow');
    root.innerHTML = `<div class="fl-pane"><svg class="fl-edges"><g class="fl-e"></g><g class="fl-fx"></g><path class="fl-ghost" d=""/></svg><div class="fl-nodes"></div><svg class="fl-edges fl-top"><g class="fl-fx2"></g></svg><div class="fl-tools"></div></div>
      <div class="fl-ctrl"><button type="button" data-z="in" title="acercar">+</button><button type="button" data-z="out" title="alejar">−</button><button type="button" data-z="fit" title="encuadrar todo">⤢</button><button type="button" data-z="tidy" title="ordenar automáticamente">ordenar</button></div>`;
    const pane = root.querySelector('.fl-pane'), eg = root.querySelector('.fl-e'), fx = root.querySelector('.fl-fx'), fxTop = root.querySelector('.fl-fx2'), ghost = root.querySelector('.fl-ghost'), nodesEl = root.querySelector('.fl-nodes'), tools = root.querySelector('.fl-tools');
    const st = { x: 0, y: 0, k: 1, pos: {}, opts: null, fitted: false, selEdge: null, key: '' };
    const apply = () => { pane.style.transform = `translate(${st.x}px,${st.y}px) scale(${st.k})`; root.style.backgroundPosition = `${st.x}px ${st.y}px`; root.style.backgroundSize = `${20 * st.k}px ${20 * st.k}px`; };
    const toPane = (cx, cy) => { const r = root.getBoundingClientRect(); return { x: (cx - r.left - st.x) / st.k, y: (cy - r.top - st.y) / st.k }; };
    function zoomAt(f, cx, cy) {
      const r = root.getBoundingClientRect(); const px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2;
      const k = Math.min(1.6, Math.max(0.35, st.k * f)), p = toPane(px, py);
      st.x = px - r.left - p.x * k; st.y = py - r.top - p.y * k; st.k = k; apply();
    }
    // encuadrar: todo a la vista, sin agrandar de más un equipo chico (un asiento solo no ocupa media pantalla)
    function fit() {
      const ids = (st.opts?.nodes || []).map((n) => n.id).filter((i) => st.pos[i]); if (!ids.length) return;
      const xs = ids.map((i) => st.pos[i].x), ys = ids.map((i) => st.pos[i].y);
      const minX = Math.min(...xs), maxX = Math.max(...xs) + NW, minY = Math.min(...ys), maxY = Math.max(...ys) + NH;
      const r = root.getBoundingClientRect(), pad = 80;
      const k = Math.min(1, Math.max(0.35, Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY))));
      st.k = k; st.x = r.width / 2 - ((minX + maxX) / 2) * k; st.y = r.height / 2 - ((minY + maxY) / 2) * k; apply();
    }
    const anchor = (id, side) => { const p = st.pos[id]; return side === 'top' ? { x: p.x + NW / 2, y: p.y } : side === 'bottom' ? { x: p.x + NW / 2, y: p.y + NH } : side === 'left' ? { x: p.x, y: p.y + NH / 2 } : { x: p.x + NW, y: p.y + NH / 2 }; };
    function edgePath(e) {
      if (e.kind === 'reports') {
        const a = anchor(e.from, 'bottom'), b = anchor(e.to, 'top'), dy = Math.max(40, Math.abs(b.y - a.y) / 2);
        return { d: `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
      const A = st.pos[e.from], B = st.pos[e.to];
      if (Math.abs(A.x - B.x) >= NW * 0.75) {
        const left = A.x < B.x, a = anchor(e.from, left ? 'right' : 'left'), b = anchor(e.to, left ? 'left' : 'right'), dx = Math.max(30, Math.abs(b.x - a.x) / 2) * (left ? 1 : -1);
        return { d: `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
      const a = anchor(e.from, 'right'), b = anchor(e.to, 'right'), out = Math.max(a.x, b.x) + 50 + Math.abs(a.y - b.y) * 0.1;
      return { d: `M${a.x},${a.y} C${out},${a.y} ${out},${b.y} ${b.x},${b.y}`, mx: out - 12, my: (a.y + b.y) / 2 };
    }
    const ekey = (e) => e.kind + ':' + e.from + '>' + e.to;
    // una curva cúbica «M a C c1 c2 b» al revés (para que la partícula salga del que manda)
    const reversePath = (d) => { const n = d.match(/-?[\d.]+/g).map(Number); return `M${n[6]},${n[7]} C${n[4]},${n[5]} ${n[2]},${n[3]} ${n[0]},${n[1]}`; };
    function drawEdges() {
      const o = st.opts; if (!o) return;
      eg.innerHTML = o.edges.filter((e) => st.pos[e.from] && st.pos[e.to]).map((e) => { const p = edgePath(e), k = ekey(e);
        return `<g class="fl-edge ${e.kind}${e.hot ? ' hot' : ''}${st.selEdge === k ? ' sel' : ''}" data-k="${escH(k)}"><path class="hit" d="${p.d}"/><path class="line" d="${p.d}"/></g>`; }).join('');
      const sel = o.editable && o.edges.find((e) => ekey(e) === st.selEdge);
      tools.innerHTML = sel ? (() => { const p = edgePath(sel); return `<button type="button" class="fl-del" style="left:${p.mx}px;top:${p.my}px" title="quitar la conexión (Supr)">✕</button>`; })() : '';
      const del = tools.querySelector('.fl-del'); if (del) del.onclick = (ev) => { ev.stopPropagation(); removeSel(); };
      if (o.editable) eg.querySelectorAll('.fl-edge').forEach((g) => (g.onpointerdown = (ev) => { ev.stopPropagation(); st.selEdge = g.dataset.k; drawEdges(); }));
    }
    function removeSel() { const o = st.opts; const e = o && o.edges.find((x) => ekey(x) === st.selEdge); st.selEdge = null; if (e && o.onDeleteEdge) o.onDeleteEdge(e); else drawEdges(); }
    function placeNodes() { nodesEl.querySelectorAll('.fl-node').forEach((el) => { const p = st.pos[el.dataset.id]; el.style.transform = `translate(${p.x}px,${p.y}px)`; }); }

    // fondo: desplazar; un clic suelto deselecciona
    root.addEventListener('pointerdown', (ev) => {
      if (ev.target !== root && !ev.target.closest('.fl-pane')) return;
      if (ev.target.closest('.fl-node, .fl-del, .fl-edge')) return;
      const sx = ev.clientX - st.x, sy = ev.clientY - st.y, x0 = ev.clientX, y0 = ev.clientY; root.setPointerCapture(ev.pointerId); root.classList.add('panning');
      if (st.selEdge) { st.selEdge = null; drawEdges(); }
      const mv = (e) => { st.x = e.clientX - sx; st.y = e.clientY - sy; apply(); };
      const up = (e) => { root.classList.remove('panning'); root.removeEventListener('pointermove', mv); root.removeEventListener('pointerup', up);
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < 4 && st.opts.onSelect) st.opts.onSelect(null); };
      root.addEventListener('pointermove', mv); root.addEventListener('pointerup', up);
    });
    root.addEventListener('wheel', (ev) => { if (!ev.target.closest('.fl-pane') && ev.target !== root) return; ev.preventDefault(); zoomAt(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev.clientX, ev.clientY); }, { passive: false });
    root.querySelector('.fl-ctrl').onclick = (ev) => { const z = ev.target.dataset.z; if (z === 'in') zoomAt(1.2); if (z === 'out') zoomAt(1 / 1.2); if (z === 'fit') fit();
      if (z === 'tidy') { st.pos = autoLayout(st.opts.nodes, st.opts.edges); if (st.key) save(st.key, st.pos); placeNodes(); drawEdges(); fit(); } };
    root.tabIndex = 0;
    root.addEventListener('keydown', (ev) => { if ((ev.key === 'Delete' || ev.key === 'Backspace') && st.selEdge && st.opts?.editable && !ev.target.closest('input, textarea, select')) { ev.preventDefault(); removeSel(); } });

    function bindNode(el) {
      const id = el.dataset.id;
      el.addEventListener('pointerdown', (ev) => {
        const h = ev.target.closest('.fl-h');
        ev.stopPropagation();
        if (h) { connect(ev, id); return; }
        // arrastrar el nodo (un clic sin moverse = elegirlo)
        const start = toPane(ev.clientX, ev.clientY), p0 = { ...st.pos[id] }; let moved = false;
        el.setPointerCapture(ev.pointerId);
        const mv = (e) => { const p = toPane(e.clientX, e.clientY); if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 4) return; moved = true; el.classList.add('dragging');
          st.pos[id] = { x: p0.x + p.x - start.x, y: p0.y + p.y - start.y }; el.style.transform = `translate(${st.pos[id].x}px,${st.pos[id].y}px)`; drawEdges(); };
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.classList.remove('dragging');
          if (moved) { if (st.key) save(st.key, st.pos); } else if (st.opts.onSelect) st.opts.onSelect(id); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      });
    }
    // arrastrar desde el punto de abajo: hasta otro nodo (le reporta) o al vacío (uno nuevo ahí)
    function connect(ev, from) {
      const a = anchor(from, 'bottom'); root.classList.add('connecting');
      const mv = (e) => { const p = toPane(e.clientX, e.clientY); const dy = Math.max(30, Math.abs(p.y - a.y) / 2);
        ghost.setAttribute('d', `M${a.x},${a.y} C${a.x},${a.y + dy} ${p.x},${p.y - dy} ${p.x},${p.y}`);
        const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.fl-node');
        nodesEl.querySelectorAll('.fl-node').forEach((n) => n.classList.toggle('target', n.dataset.id !== from && n === over)); };
      const up = (e) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); ghost.setAttribute('d', ''); root.classList.remove('connecting');
        nodesEl.querySelectorAll('.target').forEach((n) => n.classList.remove('target'));
        const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.fl-node');
        if (t && t.dataset.id !== from) { st.opts.onConnect && st.opts.onConnect(from, t.dataset.id); return; }
        const p = toPane(e.clientX, e.clientY);
        if (!t && Math.hypot(p.x - a.x, p.y - a.y) > 40 && e.target.closest && root.contains(e.target) && st.opts.onConnectEmpty) st.opts.onConnectEmpty(from, { x: p.x - NW / 2, y: p.y }); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    }
    // un lugar libre para un nodo nuevo: debajo de todo, centrado en lo visible
    function freeSpot(under) {
      if (under && st.pos[under]) { const kids = Object.values(st.pos).filter((p) => p.y > st.pos[under].y + NH && Math.abs(p.y - (st.pos[under].y + ROWH)) < NH);
        const x = kids.length ? Math.max(...kids.map((p) => p.x)) + NW + GAPX : st.pos[under].x; return { x, y: st.pos[under].y + ROWH }; }
      // suelto: desde el centro de lo visible, el primer lugar que no pise otra tarjeta (en espiral)
      const r = root.getBoundingClientRect(), c = toPane(r.left + r.width / 2 - NW / 2 * st.k, r.top + r.height / 2 - NH / 2 * st.k);
      const busy = (p) => Object.values(st.pos).some((q) => Math.abs(q.x - p.x) < NW + 16 && Math.abs(q.y - p.y) < NH + 16);
      for (let ring = 0; ring < 8; ring++) for (let i = -ring; i <= ring; i++) for (const p of [{ x: c.x + i * (NW + GAPX), y: c.y + ring * (NH + 30) }, { x: c.x + ring * (NW + GAPX), y: c.y + i * (NH + 30) }, { x: c.x - ring * (NW + GAPX), y: c.y + i * (NH + 30) }]) if (!busy(p)) return p;
      return c;
    }

    return {
      render(o) {
        const keyChanged = o.storeKey !== st.key; st.opts = o;
        if (keyChanged) { st.key = o.storeKey || ''; st.pos = st.key ? load(st.key) : {}; st.fitted = false; st.selEdge = null; }
        const auto = autoLayout(o.nodes, o.edges), ids = new Set(o.nodes.map((n) => n.id));
        Object.keys(st.pos).forEach((i) => { if (!ids.has(i)) delete st.pos[i]; });
        o.nodes.forEach((n) => { if (!st.pos[n.id]) st.pos[n.id] = n.at || auto[n.id]; });
        if (st.key) save(st.key, st.pos);
        root.classList.toggle('editable', !!o.editable);
        nodesEl.innerHTML = o.nodes.map((n) => `<div class="fl-node${n.working ? ' working' : ''}${n.missing ? ' missing' : ''}${n.lead ? ' lead' : ''}${n.loose ? ' loose' : ''}${n.cls ? ' ' + escH(n.cls) : ''}${o.selected === n.id ? ' sel' : ''}" data-id="${escH(n.id)}">
          <div class="fl-top"><span class="fl-av">${escH(n.avatar || n.title.slice(0, 1))}</span><b>${escH(n.title)}</b>${n.lead ? '<span class="fl-lead">líder</span>' : ''}<span class="fl-pip"></span></div>
          ${n.html !== undefined ? n.html : `<p class="fl-desc">${escH(n.desc || '')}</p><span class="fl-meta">${escH(n.meta || '')}</span>`}
          ${o.editable ? '<span class="fl-h top" aria-hidden="true"></span><span class="fl-h bottom" title="arrastrá hasta otro asiento: te reporta · soltalo en el vacío: un asiento nuevo"></span>' : ''}</div>`).join('');
        nodesEl.querySelectorAll('.fl-node').forEach(bindNode);
        placeNodes(); drawEdges();
        if (!st.fitted) { st.fitted = true; requestAnimationFrame(fit); }
        apply();
      },
      fit,
      freeSpot,
      // algo que viaja de un nodo a otro (la vista en vivo de un objetivo): por la línea que los une, si la hay; si no,
      // por una curva directa. La línea se enciende del color de quien manda y corre como un flujo mientras el sobre
      // (glyph: SVG centrado en 0,0) la recorre; al llegar, una onda en el destino. Vive en su propia capa (fl-fx),
      // que el repintado no borra. opts: {color, glyph, dur (s)}
      particle(from, to, opts = {}) {
        if (!st.pos[from] || !st.pos[to] || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const e = (st.opts.edges || []).find((x) => (x.from === from && x.to === to) || (x.from === to && x.to === from));
        let d;
        if (e) { d = edgePath(e).d; if (e.from !== from) d = reversePath(d); }
        else { const a = anchor(from, 'bottom'), b = anchor(to, 'top'); d = `M${a.x},${a.y} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y}`; }
        const dur = opts.dur || 1.6, end = d.match(/-?[\d.]+/g).map(Number).slice(-2);
        // la línea encendida va debajo de las tarjetas; el sobre y la onda, encima (si no, la tarjeta lo tapa a la mitad)
        const ns = 'http://www.w3.org/2000/svg', g = document.createElementNS(ns, 'g'), top = document.createElementNS(ns, 'g');
        [g, top].forEach((x) => { x.setAttribute('class', 'fl-particle'); if (opts.color) x.style.setProperty('--flow', opts.color); x.style.setProperty('--dur', dur + 's'); });
        g.innerHTML = `<path class="glow" d="${d}"/><path class="trail" d="${d}"/>`;
        top.innerHTML = `<circle class="ripple" cx="${end[0]}" cy="${end[1]}" r="4"/>
          <g class="glyph">${opts.glyph || '<circle r="6"/>'}<animateMotion dur="${dur}s" fill="freeze" path="${d}" calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.25 1"/></g>`;
        fx.appendChild(g); fxTop.appendChild(top); setTimeout(() => { g.remove(); top.remove(); }, dur * 1000 + 1200);
      },
      // al unir: si el que pasa a reportar quedó arriba (o a la par) de su jefe, va debajo de él — la línea no da vueltas
      placeUnder(child, boss) {
        const c = st.pos[child], b = st.pos[boss]; if (!c || !b || c.y >= b.y + NH + 20) return false;
        delete st.pos[child]; st.pos[child] = freeSpot(boss); if (st.key) save(st.key, st.pos); return true;
      },
      center(id) { const p = st.pos[id]; if (!p) return; const r = root.getBoundingClientRect(); st.x = r.width / 2 - (p.x + NW / 2) * st.k; st.y = r.height / 2 - (p.y + NH / 2) * st.k; apply(); },
    };
  }
  return { create };
})();
