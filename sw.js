/* Recall service worker: network-first (fresh when online), cache fallback (works offline).
 * No manual cache-version bumps needed — every successful fetch refreshes the cache. */
const CACHE = "recall-v1";
const SHELL = ["./", "index.html", "styles.css", "sched.js", "col.js", "store.js", "importer.js", "app.js",
  "manifest.webmanifest", "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
  "decks/index.json"];
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Versioned CDN libraries never change: cache-first.
  if (CDN.test(req.url)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      // <script> loads are no-cors (opaque); those are still safe to cache for pinned versions.
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  // Same-origin: network first with a short timeout, then cache.
  const key = url.pathname.startsWith(new URL("decks/", self.registration.scope).pathname) ? url.origin + url.pathname : req;
  e.respondWith((async () => {
    try {
      const res = await Promise.race([fetch(req, { cache: "no-cache" }), timeout(4000)]);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return res;
    } catch {
      const hit = await caches.match(key, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") return caches.match("index.html");
      return Response.error();
    }
  })());
});
