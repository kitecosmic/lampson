// chat.js — el composer (texto + imágenes), el envío por SSE y el pintado de cada evento del loop
// ---- imágenes pegadas / arrastradas al composer ----
// Se reducen en el navegador (lado mayor ≤ 1568 px, el límite útil de los modelos con visión) y viajan como
// base64 en el POST; PNG si sigue liviano (capturas con texto), JPEG si no. Máximo 4 por mensaje.
let attachments = []; // [{media_type, data(base64), preview(dataURL), bytes}]
const MAX_IMAGES = 4, MAX_SIDE = 1568;
function fmtBytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }
async function shrinkImage(file) {
  const url = URL.createObjectURL(file); const img = new Image();
  await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = url; }); URL.revokeObjectURL(url);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  let dataUrl = c.toDataURL('image/png'); let type = 'image/png';
  if (dataUrl.length > 1.4 * 1048576) { dataUrl = c.toDataURL('image/jpeg', 0.85); type = 'image/jpeg'; }
  const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return { media_type: type, data, preview: dataUrl, bytes: Math.round(data.length * 0.75), w: c.width, h: c.height };
}
function paintAttach() {
  const box = $('#attach'); box.innerHTML = '';
  if (attachments.length && cfg.vision === false) { const w = document.createElement('div'); w.className = 'novision'; w.textContent = `${cfg.provider} · ${cfg.model} no acepta imágenes: el modelo recibirá solo una nota. Cambiá a un modelo con visión (clic en el modelo, arriba) para que la vea.`; box.appendChild(w); }
  attachments.forEach((a, i) => { const d = document.createElement('div'); d.className = 'th'; d.title = `${a.w}×${a.h} · ${a.media_type} · ${fmtBytes(a.bytes)}`; d.innerHTML = `<img src="${a.preview}" alt=""><span class="rm" title="quitar">✕</span><span class="sz">${fmtBytes(a.bytes)}</span>`; d.querySelector('.rm').onclick = () => { attachments.splice(i, 1); paintAttach(); }; box.appendChild(d); });
}
async function addImages(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    if (attachments.length >= MAX_IMAGES) { add('meta', `máximo ${MAX_IMAGES} imágenes por mensaje`); break; }
    try { attachments.push(await shrinkImage(f)); } catch (e) { add('denied', 'no pude leer la imagen: ' + esc(e.message)); }
  }
  paintAttach(); $('#in').focus();
}
$('#in').addEventListener('paste', e => { const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean); if (files.length) { e.preventDefault(); addImages(files); } });
const composer = document.querySelector('.composer');
composer.addEventListener('dragover', e => { e.preventDefault(); composer.classList.add('drop'); });
composer.addEventListener('dragleave', () => composer.classList.remove('drop'));
composer.addEventListener('drop', e => { e.preventDefault(); composer.classList.remove('drop'); addImages([...e.dataTransfer.files]); });
function imagesHtml(ims) { if (!ims || !ims.length) return ''; return '<div class="ims">' + ims.map(im => `<div class="th"><img src="data:${esc(im.media_type)};base64,${im.data}" alt="imagen adjunta"></div>`).join('') + '</div>'; }
log.addEventListener('click', e => { const im = e.target.closest('.user .th img'); if (im) window.open(im.src, '_blank'); });

// ---- envío (SSE) ----
let aborter = null;
function setBusy(b) { busy = b; $('#f').classList.toggle('busy', b); $('#send').disabled = b; }
$('#stop').onclick = () => { if (aborter) aborter.abort(); };
async function send(message) {
  setBusy(true); aborter = new AbortController();
  if (log.querySelector('.empty')) { log.innerHTML = ''; log.classList.remove('hero'); }
  const images = attachments.map(a => ({ media_type: a.media_type, data: a.data, w: a.w, h: a.h })); attachments = []; paintAttach();
  add('user', esc(message) + imagesHtml(images));
  const thinking = add('working', '<span class="dot"></span><span>pensando…</span>');
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, message, agent: $('#agent').value || 'build', permission: $('#perm').value || 'ask', images }), signal: aborter.signal });
    if (!res.ok || !res.body) { add('denied', 'error HTTP ' + res.status + ' ' + esc(await res.text())); }
    else {
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); handle(chunk, thinking); }
      }
    }
  } catch (e) { add('meta', e.name === 'AbortError' ? '■ detenido por vos (el agente para en el próximo paso; el historial queda guardado hasta ahí)' : '‼ ' + esc(e.message)); }
  thinking.remove(); aborter = null; setBusy(false); loadSessions(); loadTree(); loadProcs(); loadMemory(); loadAgents();
}
let pending = null;
function resultHtml(out, bad) { return `<details><summary class="${bad ? 'bad' : ''}">${esc(out.split('\n')[0].slice(0, 140))} <span style="color:var(--ink-3)">(${out.length} chars)</span></summary><pre>${esc(out)}</pre></details>`; }
function handle(chunk, thinking) {
  const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n'); if (!data) return;
  let ev; try { ev = JSON.parse(data); } catch { return; }
  const k = ev.kind, d = ev.data;
  if (k === 'session') { const changed = d !== session; session = d; localStorage.setItem('lampson.session', d); if (changed) loadTodo(); }
  else if (k === 'assistant') add('assistant', md(d));
  else if (k === 'tool_call') { thinking.querySelector('span:last-child').textContent = 'ejecutando ' + esc(d.name) + '…'; pending = add('step', `<span class="ic">⚙</span>${cmdHtml(describe(d))}`); wireMore(pending); if (d.name === 'process') setTimeout(loadProcs, 2500); if (d.name === 'delegate') { setTimeout(loadAgents, 800); setTimeout(loadAgents, 4000); } if (d.name === 'todo') setTimeout(loadTodo, 300); if (d.name === 'lamp') setTimeout(loadLamps, 300); if (d.name === 'lsp') setTimeout(loadLsp, 1500); }
  else if (k === 'inbox') { add('meta', '✉ ' + esc(String(d).split('\n')[0].slice(0, 160))); loadAgents(); }
  else if (k === 'tool_result') { const out = String(d.output); const bad = /^(ERROR|DENIED)/.test(out);
    if (!bad && d.call && /^(write|edit|bash|process|delegate|lamp|skill)$/.test(d.call.name)) treeChanged();
    if (d.call && d.call.name === 'schedule') { setTimeout(loadSched, 300); if (/^scheduled '/.test(out)) setSec('sched', true); }
    // lámpara recién creada: avisar en el chat con un acceso directo al switch (el modelo no sabe cómo se enciende en esta UI)
    if (d.call && d.call.name === 'lamp' && /^lamp '([^']+)' created/.test(out)) { const nm = out.match(/^lamp '([^']+)' created/)[1]; const m = add('meta', `☼ lámpara <b>${esc(nm)}</b> creada — está apagada: <a href="#" class="lampgo">encenderla en «lámparas»</a>`); m.querySelector('.lampgo').onclick = (ev) => { ev.preventDefault(); openLamps(nm); }; $('#lamps').classList.add('new'); setTimeout(() => $('#lamps').classList.remove('new'), 4000); }
    const el = pending || add('step', '<span class="ic">→</span>'); pending = null; thinking.querySelector('span:last-child').textContent = 'pensando…'; const ic = el.querySelector('.ic'); if (ic) { ic.textContent = bad ? '✗' : '✓'; ic.className = 'ic ' + (bad ? 'bad' : 'ok'); } el.insertAdjacentHTML('beforeend', resultHtml(out, bad)); }
  else if (k === 'approval_request') { const el = add('approval', `<div class="card"><div class="why">⚠ ${esc(d.why)}</div><code>${esc(describe({name: d.name, args: d.args}))}</code><div class="btns"><button class="primary" data-ok="1">Permitir</button><button data-ok="0">Denegar</button></div></div>`); el.querySelectorAll('button').forEach(b => b.onclick = async () => { el.querySelectorAll('button').forEach(x => x.disabled = true); await api('/api/approve', { id: d.id, decision: b.dataset.ok === '1' }); }); el.dataset.id = d.id; }
  else if (k === 'approval_result') { const el = [...log.querySelectorAll('.approval')].find(x => x.dataset.id === d.id); if (el) el.querySelector('.btns').innerHTML = d.approved ? '<span style="color:var(--str)">✓ permitido</span>' : (d.timeout ? '<span class="denied">✗ sin respuesta, denegado</span>' : '<span class="denied">✗ denegado</span>'); }
  else if (k === 'mode') { $('#agent').value = d.agent; $('#perm').value = d.permission; if (d.has_key === false) { add('denied', `‼ no hay API key para ${esc(d.provider)} — cargala en la ventana de modelo (clic en «${esc(d.provider)} · ${esc(d.model)}» arriba)`); } }
  else if (k === 'tool_denied') { const el = pending || add('step', '<span class="ic">✗</span>'); el.insertAdjacentHTML('beforeend', `<span class="denied"> ✗ ${esc(d.reason)}</span>`); }
  // el hint de "modelo inválido" solo cuando el error realmente habla de eso
  else if (k === 'error') { add('denied', '‼ ' + esc(d)); if (/(invalid|unknown|no such|not exist|not found|unsupported).{0,30}model|model.{0,30}(invalid|unknown|does not exist|not found|unsupported)/i.test(String(d))) add('meta', `el proveedor rechazó el nombre del modelo (${esc(cfg.model || '')}) — clic en «${esc(cfg.provider || '')} · ${esc(cfg.model || '')}» arriba: la lista de modelos válidos aparece al elegir el proveedor`); }
  else if (k === 'compact') add('meta', '⧗ compactando contexto (~' + d.before + ' tokens)');
  else if (k === 'done') { if (d.stopped !== 'user_command') add('meta', `${d.steps} paso${d.steps === 1 ? '' : 's'} · ${d.usage.input + d.usage.output} tokens · ${d.stopped}`); }
  log.appendChild(thinking); $('#stage').scrollTop = $('#stage').scrollHeight;
}
$('#f').onsubmit = e => { e.preventDefault(); const t = $('#in').value.trim(); if ((!t && !attachments.length) || busy) return; $('#in').value = ''; send(t || '(imagen adjunta)'); };
$('#in').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy) $('#f').requestSubmit(); } });
$('#in').addEventListener('input', () => { const t = $('#in'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; });
