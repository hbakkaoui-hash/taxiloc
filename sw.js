/* TAXILOC — service worker
   Stratégie "réseau d'abord" : en ligne = toujours la dernière version ;
   hors-ligne = on sert la dernière copie connue. */
const CACHE = "baktaxi-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./data.js",
  "./supabase-config.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Requêtes externes (Supabase API, CDN) : on laisse passer normalement.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // Réseau d'abord, repli sur le cache si hors-ligne.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
