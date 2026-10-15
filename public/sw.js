/* Canny Capital Portal — service worker (CRM Phase 2).
 *
 * Offline policy: cache ONLY non-sensitive shell assets (offline page,
 * icons, manifest, hashed static bundles). API responses are NEVER
 * cached — no deal data, valuations, or Directory notes offline.
 * Navigations are network-first and fall back to the branded /offline
 * page when the network is unreachable.
 */

const CACHE = "ccp-shell-v2";

const SHELL_ASSETS = [
  "/offline",
  "/manifest.webmanifest",
  "/icon-192-v7",
  "/icon-512-v7",
  "/icon-maskable-v7",
  "/apple-touch-icon-v7",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API: network only, never cached.
  if (url.pathname.startsWith("/api/")) return;

  // Page navigations: network-first, branded offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE);
        const offline = await cache.match("/offline");
        return (
          offline ||
          new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          })
        );
      })
    );
    return;
  }

  // Cross-origin (brand photos etc.): let the browser handle it.
  if (url.origin !== self.location.origin) return;

  // Hashed static assets + generated icons/manifest: cache-first.
  const cacheFirst =
    url.pathname.startsWith("/_next/static/") ||
    SHELL_ASSETS.includes(url.pathname) ||
    url.pathname.startsWith("/splash/");
  if (cacheFirst) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return res;
          })
      )
    );
  }
});

/* ---------------- Web Push ----------------
 * Payload contract (push backend): JSON { title, body, url, tag, badge? }.
 * Lock-screen text is composed server-side (generic by default), so the
 * SW simply displays what it receives. */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Canny Capital Portal";
  const options = {
    body: data.body || "",
    icon: "/icon-192-v7",
    badge: "/icon-192-v7",
    tag: data.tag || undefined,
    data: { url: data.url || "/overview" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/overview";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          try {
            const clientUrl = new URL(client.url);
            if (clientUrl.pathname === new URL(target, self.location.origin).pathname) {
              client.navigate(target);
              return client.focus();
            }
          } catch (e) {
            /* fall through to openWindow */
          }
        }
        const open = clients.find((c) => "focus" in c);
        if (open) {
          open.navigate(target);
          return open.focus();
        }
        return self.clients.openWindow(target);
      })
  );
});

/* If the browser rotates/drops the subscription, re-subscribe with the
 * same options and hand the new subscription to the backend so pushes
 * keep flowing to this device. */
self.addEventListener("pushsubscriptionchange", (event) => {
  const resubscribe = async () => {
    let sub = event.newSubscription || null;
    if (!sub && event.oldSubscription) {
      try {
        sub = await self.registration.pushManager.subscribe(
          event.oldSubscription.options
        );
      } catch (e) {
        sub = null;
      }
    }
    if (!sub) return;
    await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub }),
    });
  };
  event.waitUntil(resubscribe());
});
