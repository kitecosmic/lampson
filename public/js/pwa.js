// pwa.js — registra el service worker (instalable en el celular y en el escritorio). Solo en contexto seguro:
// https (túnel, VPS) o localhost; por http en la LAN el navegador no lo permite y la app sigue como sitio.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); });
}
