// sw.js — service worker de la PWA de lampson (base: el scaffold de `synsema init --pwa`).
// Red primero para todo: lampson cambia seguido y es una herramienta en vivo; mostrar una versión vieja de la UI
// sería peor que avisar. El caché solo sirve para abrir sin red: íconos, CSS/JS/fuentes y una página «sin conexión».
// Nunca se cachea el API (/api/…, /w/<slug>/api/…) ni una respuesta que falló, ni las páginas con datos del usuario.
const CACHE = "lampson-shell-v2";
const SHELL = ["/offline.html", "/manifest.webmanifest", "/icon-192.png", "/favicon.svg", "/css/tokens.css"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const tunnelDown = (res) => res.headers.get("x-synsema-tunnel") === "offline" || [502, 503, 504, 521, 522, 523, 524, 530].includes(res.status);
const isApi = (p) => p.startsWith("/api/") || /^\/w\/[^/]+\/(api|approve)\//.test(p);
const isAsset = (p) => /^\/(css|js|fonts|vendor)\//.test(p) || /\.(png|svg|webmanifest|woff2)$/.test(p);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (isApi(url.pathname)) return;   // SSE, WebSocket y JSON van directo a la red, sin tocar
  if (e.request.mode === "navigate") {
    // PC apagada o lampson caído: sin red → error de fetch; detrás de un túnel, el túnel SÍ responde, con su propia
    // página de error (Cloudflare: 530/1033, 502, 504; un túnel de la plataforma marca X-Synsema-Tunnel: offline).
    // En los dos casos, la pantalla de lampson. El hub nunca responde una página con esos códigos.
    e.respondWith(fetch(e.request).then((res) => {
      if (tunnelDown(res)) return caches.match("/offline.html").then((c) => c || res);
      return res;
    }).catch(() => caches.match("/offline.html")));
    return;
  }
  if (isAsset(url.pathname)) {
    e.respondWith(fetch(e.request).then(async (res) => {
      if (res.ok) { const c = await caches.open(CACHE); await c.put(e.request, res.clone()); }
      return res;
    }).catch(async () => (await caches.match(e.request)) || Response.error()));
  }
});

// push (para después: avisos de aprobaciones y de tareas terminadas)
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data ? e.data.text() : "" }; }
  const opts = { body: data.body || "", icon: "/icon-192.png", badge: "/badge-96.png", data };
  if (data.tag) { opts.tag = String(data.tag); opts.renotify = true; }
  e.waitUntil(self.registration.showNotification(data.title || "Lampson", opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    const win = wins.find((w) => "focus" in w);
    if (win) { win.postMessage({ type: "notificationclick", url }); return win.focus(); }
    return clients.openWindow(url);
  }));
});
