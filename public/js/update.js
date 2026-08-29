// update.js — actualizaciones de Lampson (una vez por carga; el fetch a origin puede tardar)
async function checkUpdate() {
  let u; try { u = await (await fetch('/api/update')).json(); } catch (e) { return; }
  const b = $('#update'); if (!u.available) { b.style.display = 'none'; return; }
  b.textContent = `⬆ actualizar · ${u.behind} commit${u.behind === 1 ? '' : 's'}`;
  b.title = `${u.current} → ${u.latest}\n${(u.notes || []).map(n => '· ' + n).join('\n')}\n\nen terminal: ${u.command}`;
  b.style.display = '';
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'actualizando…';
    let r; try { r = await (await fetch('/api/update', { method: 'POST' })).json(); } catch (e) { r = { result: 'no se pudo actualizar: ' + e.message }; }
    add('meta', '⬆ ' + esc(r.result || ''));
    b.disabled = false; b.textContent = '⬆ reiniciá el servidor'; b.onclick = null;
  };
}
