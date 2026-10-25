// inbox.js — lo que te espera, de todos los proyectos: preguntas y aprobaciones de los objetivos, merges y push con lo
// que entra, pases a otro equipo y comandos que piden permiso. UNA implementación para todas las pantallas:
//   * la bandeja: el botón ⚑ de la cabecera (donde la página pone <span data-inbox></span>) abre un panel a la derecha
//     (a pantalla completa en el celular) con todo, agrupado por proyecto. /#inbox la abre al cargar.
//   * Inbox.objective(el, slug, id): la pregunta de un objetivo en su propia página, con la respuesta ahí mismo.
//   * Inbox.strip(el, slug, id): esa pregunta en una línea (la pantalla en vivo); tocarla abre la bandeja en ella.
// Lee GET /api/teams-home (el resumen de cada workspace) y, si un proyecto tiene aprobaciones, su /w/<slug>/api/approvals
// (trae la vista previa del merge: lib/worktree.syn → preview). Responder va directo al workspace por el proxy del hub.
// Estilos: css/inbox.css.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const short = (slug) => String(slug).replace(/-[0-9a-f]{8}$/, '');
  const unescapeU = (t) => String(t ?? '').replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - (t || 0)); return s < 60 ? 'recién' : s < 3600 ? `hace ${Math.floor(s / 60)} min` : s < 86400 ? `hace ${Math.floor(s / 3600)} h` : `hace ${Math.floor(s / 86400)} d`; };
  const when = (t) => new Date((t || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const SVG = (inner, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const ICON = {
    ask: SVG('<path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><circle class="dot" cx="8.5" cy="11" r="1"/><circle class="dot" cx="12" cy="11" r="1"/><circle class="dot" cx="15.5" cy="11" r="1"/>'),
    ok: SVG('<circle cx="8" cy="15" r="4.5"/><path d="M11.3 11.7 20 3M16.5 6.5l2.5 2.5M14 9l2 2"/>'),
    git: SVG('<circle cx="6" cy="5.5" r="2.2"/><circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="7.5" r="2.2"/><path d="M6 7.7v8.6"/><path d="M18 9.7c0 4.3-7.5 3.3-11.2 6.9"/>'),
    pass: SVG('<rect x="2.5" y="6" width="13" height="10" rx="1.8"/><path d="M3 7l6 4.4L15 7"/><path d="M15 17.5h6.5M18.5 14.5l3 3-3 3"/>'),
  };
  const ARROW = '<svg class="arr" viewBox="0 0 24 12" aria-hidden="true"><path d="M1 6h20M16 1.5 21 6l-5 4.5"/></svg>';

  // ---------- texto con formato: párrafos, listas, `código`, **negrita** ----------
  const mdInline = (t) => esc(unescapeU(t)).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  function md(txt) {
    const lines = String(txt || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
    let html = '', list = false;
    for (const l of lines) {
      const li = l.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
      if (li && !list) { html += '<ul>'; list = true; }
      if (!li && list) { html += '</ul>'; list = false; }
      html += li ? `<li>${mdInline(li[1])}</li>` : `<p>${mdInline(l)}</p>`;
    }
    return html + (list ? '</ul>' : '');
  }
  // por qué pide permiso, en palabras
  function whyText(why) {
    const w = String(why || '').replace(/ · agent \S+$/, '');
    let m;
    if ((m = w.match(/dangerous pattern: (.+)$/))) return `Es un comando que puede borrar o cambiar cosas difíciles de recuperar (${m[1].trim()}).`;
    if ((m = w.match(/asks before every (\S+) call/))) return `Este agente pide permiso antes de cada «${m[1]}».`;
    if (/once per objective/.test(w)) return 'Trabaja en tu propia copia del proyecto (tu checkout). Si aprobás, el equipo puede trabajar ahí sin volver a preguntarte hasta que termine este objetivo: correr cosas, integrar a tu rama principal (merge), arreglar, etiquetar. El push te lo sigue preguntando.';
    if (/git push/.test(w)) return 'Sube cambios fuera de esta máquina: cada push lo aprobás vos.';
    if (/shared history/.test(w)) return 'Toca la historia compartida del proyecto: siempre lo aprobás vos.';
    return w;
  }
  const filesOpen = new Set();
  function mergeHtml(a) {
    const p = a.preview;
    if (!p) return `<pre class="av-cmd">${esc(a.message)}</pre>`;
    if (p.missing) return `<p class="av-warn">La rama <code>${esc(p.branch)}</code> no existe: si lo aprobás, el comando va a fallar.</p><pre class="av-cmd">${esc(a.message)}</pre>`;
    const add = p.files.reduce((n, f) => n + f.add, 0), del = p.files.reduce((n, f) => n + f.del, 0);
    const badge = p.conflicts ? `<span class="av-badge bad">choca con ${esc(p.into)}</span>` : `<span class="av-badge ok">${p.ff ? 'avance directo' : 'sin conflictos'}</span>`;
    return `<div class="av-merge">
      <div class="av-flow"><code>${esc(p.branch)}</code>${ARROW}<code>${esc(p.into || 'remoto')}</code>${badge}</div>
      ${p.count ? `<p class="av-stat">${p.count} commit${p.count === 1 ? '' : 's'} · ${p.files.length} archivo${p.files.length === 1 ? '' : 's'} <span class="add">+${add}</span> <span class="del">−${del}</span></p>
      <ul class="av-commits">${p.commits.slice(0, 4).map((c) => `<li><span class="sha">${esc(c.sha)}</span><span class="sj">${esc(c.subject)}</span><span class="by">${esc(String(c.author).split(' · ')[0])}</span></li>`).join('')}${p.count > 4 ? `<li class="more">y ${p.count - 4} más</li>` : ''}</ul>
      <details class="av-files" data-k="${esc(a.id)}"${filesOpen.has(a.id) ? ' open' : ''}><summary>ver archivos y comando</summary><ul>${p.files.map((f) => `<li><span class="fp">${esc(f.path)}</span><span class="add">+${f.add}</span><span class="del">−${f.del}</span></li>`).join('')}</ul><pre class="av-cmd">${esc(a.message)}</pre></details>` : `<p class="av-stat">No trae nada nuevo: ${esc(p.into)} ya tiene todo lo de esta rama.</p>`}
      ${p.conflicts ? '<p class="av-warn">Toca las mismas líneas que cambiaron en la rama principal: si lo aprobás, el merge se frena con conflictos y el agente tiene que resolverlos.</p>' : ''}
    </div>`;
  }

  // ---------- los datos: un ítem por cosa que te espera ----------
  let items = [], loaded = false;
  const apCache = {};   // slug → {sig, list}: las aprobaciones con su vista previa, pedidas solo si cambiaron
  async function getJSON(u) { const r = await fetch(u); if (r.status === 401) { location.href = '/login'; return {}; } return r.json(); }
  async function load() {
    let ws = [];
    try { ws = (await getJSON('/api/teams-home')).workspaces || []; } catch (e) { return items; }
    const out = [];
    for (const w of ws) {
      const seat = (agent) => { for (const t of w.teams || []) { const s = (t.seats || []).find((x) => x.agent === agent); if (s) return { role: s.role || agent, team: t }; } return { role: agent, team: null }; };
      const teamName = (id) => { const t = (w.teams || []).find((x) => x.id === id); return t ? t.name || t.id : id; };
      for (const o of (w.objectives || []).filter((o) => o.status === 'waiting')) {
        const s = seat(o.agent), team = s.team || (w.teams || []).find((t) => t.id === o.team);
        const href = '/w/' + encodeURIComponent(w.slug) + (o.team ? '/equipos/' + encodeURIComponent(o.team) + '/objetivos/' : '/objetivos/') + o.id;
        out.push({ key: w.slug + ':o' + o.id, slug: w.slug, ws: w.name || short(w.slug), kind: 'objective', o, who: s.role, team: team ? team.name || team.id : '', href, at: o.updated_at, teamName });
      }
      const pend = w.approvals || [];
      if (pend.length) {
        const sig = pend.map((a) => a.id).join(',');
        if (!apCache[w.slug] || apCache[w.slug].sig !== sig) {
          let full = [];
          try { full = ((await getJSON('/w/' + encodeURIComponent(w.slug) + '/api/approvals')).approvals || []).filter((a) => a.status === 'pending'); } catch (e) {}
          apCache[w.slug] = { sig, list: full };
        }
        for (const a0 of pend) {
          const a = apCache[w.slug].list.find((x) => x.id === a0.id) || a0;
          const agent = (String(a.why || '').match(/agent (\S+)/) || [])[1], s = agent ? seat(agent) : { role: 'un agente', team: null };
          out.push({ key: w.slug + ':a' + a.id, slug: w.slug, ws: w.name || short(w.slug), kind: 'approval', a, who: s.role, team: s.team ? s.team.name || s.team.id : '', at: a.created });
        }
      }
    }
    items = out.sort((x, y) => (y.at || 0) - (x.at || 0)); loaded = true;
    paintButtons();
    listeners = listeners.filter((l) => l.el.isConnected); listeners.forEach((l) => l.draw());
    return items;
  }

  // ---------- un aviso ----------
  const seen = new Set();
  function avisoHtml(it) {
    const meta = `${it.team ? esc(it.team) + ' · ' : ''}${it.href ? `<a href="${esc(it.href)}">${esc(it.o.ref)}</a> · ` : ''}${ago(it.at)}`;
    const box = (kind, verb, body, acts) => {
      const fresh = !seen.has(it.key); seen.add(it.key);
      return `<article class="aviso k-${kind}${fresh ? ' fresh' : ''}" data-key="${esc(it.key)}"><span class="av-ico">${ICON[kind]}</span><div class="av-body">
        <header><span class="av-who"><b>${esc(it.who)}</b> ${verb}</span><span class="av-meta">${meta}</span></header>${body}<div class="av-acts">${acts}</div></div></article>`;
    };
    const k = esc(it.key);
    if (it.kind === 'objective') {
      const o = it.o, pass = String(o.question || '').match(/^hand over to team (\S+):\n?([\s\S]*)$/);
      if (pass) return box('pass', `quiere pasarle el trabajo a <b>${esc(it.teamName(pass[1]))}</b>`, `<p class="av-lbl">Lo que le va a pedir:</p><blockquote class="av-q">${md(pass[2])}</blockquote>`,
        `<input data-in="${k}" placeholder="nota para ${esc(it.who)} (opcional)"><button class="ok" data-do="approve">Pasárselo</button><button class="no" data-do="deny">No pasarlo</button>`);
      if (o.question_kind === 'approval') return box('ok', 'te pide aprobación', `<div class="av-q">${md(o.question)}</div>`,
        `<input data-in="${k}" placeholder="nota (opcional)"><button class="ok" data-do="approve">Aprobar</button><button class="no" data-do="deny">Denegar</button>`);
      return box('ask', 'te pregunta', `<div class="av-q">${md(o.question)}</div>`, `<input data-in="${k}" placeholder="tu respuesta"><button class="primary" data-do="answer">Responder</button>`);
    }
    const a = it.a, p = a.preview, exp = a.expires_at ? `<span class="av-exp">vence ${esc(when(a.expires_at))}</span>` : '';
    if (p) return box('git', p.kind === 'push' ? `quiere subir <b>${esc(p.branch)}</b>` : `quiere llevar el trabajo a <b>${esc(p.into)}</b>`,
      mergeHtml(a) + `<p class="av-why">${esc(whyText(a.why))}</p>`, `<button class="ok" data-do="qok">${p.kind === 'push' ? 'Aprobar push' : 'Aprobar merge'}</button>${/once per objective/.test(a.why || '') ? '<button data-do="qonce">Solo esta vez</button>' : ''}<button class="no" data-do="qno">Denegar</button>${exp}`);
    // en tu copia: aprobar vale para todo el objetivo; «solo esta vez» deja correr este comando y el próximo vuelve a preguntar
    const scoped = /once per objective/.test(a.why || '');
    return box('ok', 'quiere correr un comando', `<pre class="av-cmd">${esc(a.message)}</pre><p class="av-why">${esc(whyText(a.why))}</p>`,
      `<button class="ok" data-do="qok">${scoped ? 'Aprobar para este objetivo' : 'Aprobar'}</button>${scoped ? '<button data-do="qonce">Solo esta vez</button>' : ''}<button class="no" data-do="qno">Denegar</button>${exp}`);
  }

  // ---------- dibujar y responder (lo escrito y el foco sobreviven al pulso) ----------
  const typed = {};
  async function post(u, body) { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (r.status === 401) location.href = '/login'; return r.ok; }
  async function act(it, what, text) {
    const base = '/w/' + encodeURIComponent(it.slug) + '/api/';
    if (what === 'qok' || what === 'qno' || what === 'qonce') await post(base + 'approve', { id: it.a.id, decision: what === 'qonce' ? 'once' : what === 'qok' });
    else await post(base + 'objectives/' + it.o.id + '/reply', { text, approved: what === 'approve' });
    delete typed[it.key];
    await load();
  }
  function render(el, list, group) {
    let html = '', last = '';
    for (const it of list) {
      if (group && it.ws !== last) { html += `<p class="inbox-ws">${esc(it.ws)}</p>`; last = it.ws; }
      html += avisoHtml(it);
    }
    if (el._html === html) return;
    const focus = document.activeElement && el.contains(document.activeElement) && document.activeElement.dataset.in;
    el._html = html; el.innerHTML = html;
    el.querySelectorAll('details[data-k]').forEach((d) => (d.ontoggle = () => (d.open ? filesOpen.add(d.dataset.k) : filesOpen.delete(d.dataset.k))));
    el.querySelectorAll('input[data-in]').forEach((i) => {
      if (typed[i.dataset.in]) i.value = typed[i.dataset.in];
      if (focus === i.dataset.in) i.focus();
      i.oninput = () => (typed[i.dataset.in] = i.value);
      i.onkeydown = (e) => { if (e.key === 'Enter') { const b = i.parentElement.querySelector('[data-do="answer"], [data-do="approve"]'); if (b) b.click(); } };
    });
    el.querySelectorAll('[data-do]').forEach((b) => (b.onclick = () => {
      const art = b.closest('.aviso'), it = list.find((x) => x.key === art.dataset.key); if (!it) return;
      const inp = art.querySelector('input[data-in]'), text = inp ? inp.value : '';
      if (b.dataset.do === 'answer' && !text.trim()) { inp.focus(); return; }
      art.classList.add('going'); art.querySelectorAll('button').forEach((x) => (x.disabled = true));
      act(it, b.dataset.do, text);
    }));
  }

  // ---------- la bandeja ----------
  let drawer = null;
  let listeners = [];   // {el, draw}: los avisos de un objetivo en su página (se sueltan cuando la página los quita)
  function paintButtons() {
    const n = items.length;
    document.querySelectorAll('[data-inbox]').forEach((ph) => {
      let b = ph.querySelector('.inbox-btn');
      if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'inbox-btn'; b.onclick = open; ph.appendChild(b); }
      b.hidden = n === 0; b.innerHTML = `⚑ ${n}<span class="t"> te espera${n === 1 ? '' : 'n'}</span>`; b.title = 'preguntas y aprobaciones de tus agentes';
    });
    if (drawer && !drawer.panel.hidden) paintDrawer();
  }
  function paintDrawer() {
    drawer.count.textContent = items.length ? String(items.length) : '';
    if (!items.length) { drawer.list._html = ''; drawer.list.innerHTML = '<p class="inbox-empty">Nada te espera. Cuando un agente te pregunte algo o pida permiso, aparece acá.</p>'; return; }
    render(drawer.list, items, new Set(items.map((i) => i.ws)).size > 1);
  }
  // focus: la clave de un aviso para llevarlo a la vista, marcado y con el cursor en su respuesta
  function open(focus) {
    if (!drawer) {
      const veil = document.createElement('div'); veil.className = 'inbox-veil'; veil.hidden = true;
      const panel = document.createElement('aside'); panel.className = 'inbox'; panel.hidden = true; panel.setAttribute('aria-label', 'lo que te espera');
      panel.innerHTML = '<div class="inbox-head"><h2>Te espera<small></small></h2><button type="button" data-close title="cerrar (Esc)">✕</button></div><div class="inbox-list"></div>';
      document.body.append(veil, panel);
      drawer = { veil, panel, list: panel.querySelector('.inbox-list'), count: panel.querySelector('small') };
      veil.onclick = close; panel.querySelector('[data-close]').onclick = close;
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.panel.hidden) close(); });
    }
    drawer.veil.hidden = false; drawer.panel.hidden = false; paintDrawer(); load();
    const art = typeof focus === 'string' && [...drawer.list.querySelectorAll('.aviso')].find((x) => x.dataset.key === focus);
    if (art) {
      art.scrollIntoView({ block: 'start' }); art.classList.remove('lit'); void art.offsetWidth; art.classList.add('lit');
      const inp = art.querySelector('input[data-in]'); if (inp) inp.focus({ preventScroll: true });
    }
  }
  function close() { if (drawer) { drawer.veil.hidden = true; drawer.panel.hidden = true; } if (location.hash === '#inbox') history.replaceState(null, '', location.pathname + location.search); }

  // la pregunta de un objetivo en su página: el mismo aviso, con la respuesta en el lugar
  function objective(el, slug, id) {
    const draw = () => { if (!el.isConnected) return; render(el, items.filter((it) => it.slug === slug && it.kind === 'objective' && it.o.id === id), false); };
    if (!el._inboxHooked) { el._inboxHooked = true; listeners.push({ el, draw }); }
    if (loaded) draw(); else load();
  }

  // la misma pregunta en una línea, para la pantalla en vivo (el grafo y el tablero no se corren): tocarla abre la bandeja
  // en ese aviso
  function strip(el, slug, id) {
    const draw = () => {
      if (!el.isConnected) return;
      const it = items.find((x) => x.slug === slug && x.kind === 'objective' && x.o.id === id);
      let html = '';
      if (it) {
        const q = String(it.o.question || ''), pass = q.match(/^hand over to team (\S+):/);
        const [kind, verb, go] = pass ? ['pass', `quiere pasarle el trabajo a ${esc(it.teamName(pass[1]))}`, 'Ver y decidir']
          : it.o.question_kind === 'approval' ? ['ok', 'te pide aprobación', 'Ver y decidir'] : ['ask', 'te pregunta', 'Responder'];
        const gist = unescapeU(pass ? q.replace(/^[^\n]*\n?/, '') : q).replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
        html = `<button type="button" class="ob-strip k-${kind}" data-key="${esc(it.key)}"><span class="av-ico">${ICON[kind]}</span><span class="sx"><b>${esc(it.who)}</b> ${verb} · <span class="g">${esc(gist)}</span></span><span class="go">${go} →</span></button>`;
      }
      if (el._html === html) return;
      el._html = html; el.innerHTML = html;
      const b = el.querySelector('.ob-strip'); if (b) b.onclick = () => open(b.dataset.key);
    };
    if (!el._inboxHooked) { el._inboxHooked = true; listeners.push({ el, draw }); }
    if (loaded) draw(); else load();
  }

  window.Inbox = { open, close, load, objective, strip, get count() { return items.length; } };
  document.addEventListener('click', (e) => { const a = e.target.closest('a[href="#inbox"]'); if (a) { e.preventDefault(); open(); } });
  load().then(() => { if (location.hash === '#inbox') open(); });
  setInterval(load, 5000);
})();
