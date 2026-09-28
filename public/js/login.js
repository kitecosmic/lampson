// login.js — /login (passkey de un dispositivo ya emparejado) y /pair#<código> (registrar una passkey nueva).
// Los binarios de WebAuthn viajan en base64url: el server manda challenge / user.id / ids así, y recibe la
// credencial en la forma de PublicKeyCredential.toJSON() (armada a mano: toJSON no está en todos los Safari).
const $ = s => document.querySelector(s);
const b64uToBuf = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
const bufToB64u = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
function say(text, kind) { const m = $('#msg'); m.textContent = text || ''; m.className = 'msg' + (kind ? ' ' + kind : ''); }
async function post(path, body) { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); let data = {}; try { data = await r.json(); } catch (e) {} return { ok: r.ok, status: r.status, data }; }
function credJSON(c) {
  const r = c.response, out = { id: c.id, rawId: bufToB64u(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults ? c.getClientExtensionResults() : {}, response: { clientDataJSON: bufToB64u(r.clientDataJSON) } };
  if (c.authenticatorAttachment) out.authenticatorAttachment = c.authenticatorAttachment;
  if (r.attestationObject) { out.response.attestationObject = bufToB64u(r.attestationObject); if (r.getTransports) out.response.transports = r.getTransports(); }
  if (r.authenticatorData) out.response.authenticatorData = bufToB64u(r.authenticatorData);
  if (r.signature) out.response.signature = bufToB64u(r.signature);
  if (r.userHandle) out.response.userHandle = bufToB64u(r.userHandle);
  return out;
}
function why(e) {
  if (!e) return 'algo falló';
  if (e.name === 'NotAllowedError') return 'cancelado o sin respuesta — volvé a intentar';
  if (e.name === 'InvalidStateError') return 'este dispositivo ya tiene una passkey de lampson para este dominio — entrá desde /login';
  if (e.name === 'SecurityError') return 'el navegador rechazó el dominio: las passkeys necesitan https (o localhost)';
  return (e.name ? e.name + ': ' : '') + (e.message || String(e));
}
function guessName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'dispositivo';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? os + ' · ' + br : os;
}
const next = () => { const n = new URLSearchParams(location.search).get('next'); return n && n.startsWith('/') && !n.startsWith('//') ? n : '/'; };
const supported = () => window.isSecureContext && window.PublicKeyCredential && navigator.credentials;

async function doPair(code) {
  const btn = $('#doPair'); btn.disabled = true; say('preparando…');
  try {
    const o = await post('/api/auth/register/options', { code, name: $('#devName').value.trim() || guessName() });
    if (!o.ok) { say(o.data.error || ('error ' + o.status), 'err'); btn.disabled = false; return; }
    const pk = o.data.publicKey;
    pk.challenge = b64uToBuf(pk.challenge); pk.user.id = b64uToBuf(pk.user.id);
    say('seguí las instrucciones del dispositivo…');
    const cred = await navigator.credentials.create({ publicKey: pk });
    const r = await post('/api/auth/register', { code, challenge_id: o.data.challenge_id, name: $('#devName').value.trim() || guessName(), credential: credJSON(cred) });
    if (!r.ok) { say(r.data.error || ('error ' + r.status), 'err'); btn.disabled = false; return; }
    say('listo · entrando…', 'ok');
    history.replaceState(null, '', '/pair');   // el código ya no sirve: que no quede en el historial
    setTimeout(() => { location.href = '/'; }, 500);
  } catch (e) { say(why(e), 'err'); btn.disabled = false; }
}

async function doLogin() {
  const btn = $('#doLogin'); btn.disabled = true; say('');
  try {
    const o = await post('/api/auth/login/options', {});
    if (!o.ok) { say(o.data.error || ('error ' + o.status), 'err'); btn.disabled = false; return; }
    if (!o.data.known) { say('no hay dispositivos emparejados para este dominio: emparejá este desde la PC', 'err'); btn.disabled = false; return; }
    const pk = o.data.publicKey;
    pk.challenge = b64uToBuf(pk.challenge); pk.allowCredentials = (pk.allowCredentials || []).map(c => ({ type: c.type, id: b64uToBuf(c.id) }));
    const cred = await navigator.credentials.get({ publicKey: pk });
    const r = await post('/api/auth/login', { challenge_id: o.data.challenge_id, credential: credJSON(cred) });
    if (!r.ok) { say(r.data.error || ('error ' + r.status), 'err'); btn.disabled = false; return; }
    say('entrando…', 'ok'); location.href = next();
  } catch (e) { say(why(e), 'err'); btn.disabled = false; }
}

(async () => {
  const code = location.pathname === '/pair' ? decodeURIComponent(location.hash.slice(1)) : '';
  if (code) {
    $('#pair').hidden = false; $('#devName').value = guessName();
    $('#doPair').onclick = () => doPair(code);
  } else {
    // ¿ya adentro? (esta PC o una sesión viva) → directo al hub
    try { const me = await (await fetch('/api/auth/me')).json(); if (me.authenticated) { location.href = next(); return; } } catch (e) {}
    $('#login').hidden = false; $('#doLogin').onclick = doLogin;
    if (location.pathname === '/pair') say('este link no trae código: escaneá el QR de nuevo', 'err');
  }
  if (!supported()) { say('este navegador no puede usar passkeys aquí: hace falta https (el túnel) y un navegador actual', 'err'); document.querySelectorAll('button.primary').forEach(b => b.disabled = true); }
})();
