/**
 * Development service worker: no precache (use after `bun run build` for offline shell).
 */
self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});
