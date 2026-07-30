const CACHE = "norte-sul-vendas-v7";
const SHELL = [
  "/manifest.webmanifest",
  "/brand-logo.png",
  "/favicon-48.png",
  "/brand-app-icon-192.png",
  "/brand-app-icon-512.png",
  "/brand-app-icon-maskable-512.png",
  "/brand-apple-touch-icon.png",
  "/notification-badge-96.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    const rootResponse = await fetch("/");
    if (rootResponse.ok) {
      const html = await rootResponse.clone().text();
      const assets = [...html.matchAll(/["'](\/assets\/[^"'?]+\.(?:css|js))["']/g)]
        .map((match) => match[1]);
      await cache.put("/", rootResponse);
      await cache.addAll([...new Set(assets)]);
    }
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === "navigate") {
        const appShell = await caches.match("/");
        if (appShell) return appShell;
      }
      return new Response("Conteúdo indisponível offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/?open=communication";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows[0];
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: "OPEN_COMMUNICATION" });
      return;
    }
    await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "Você recebeu uma nova mensagem." };
  }
  event.waitUntil(self.registration.showNotification(payload.title || "Nova mensagem", {
    body: payload.body || "Você recebeu uma nova mensagem.",
    icon: payload.icon || "/brand-app-icon-192.png",
    badge: payload.badge || "/notification-badge-96.png",
    tag: payload.tag || "chat-message",
    renotify: true,
    vibrate: [200, 100, 200],
    data: payload.data || { url: "/?open=communication" },
  }));
});
