// SIGMA 1 - Web Push Service Worker
// Standards-based Push API and Notification Handling

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: 'SIGMA 1', body: event.data.text() };
    }
  }
  // Server sends both the Declarative Web Push shape (payload.notification) and flat fields.
  const decl = payload.notification || {};
  const title = payload.title || decl.title || 'SIGMA 1';
  const body = payload.body || decl.body || payload.message || 'You have a new update.';
  const icon = payload.icon || '/brand/sigma1-icon-192.png';
  const badge = payload.badge_icon || payload.badge || icon;
  let url = payload.action_url || payload.url || '/';
  if (!url.startsWith('/') && decl.navigate) {
    try { url = new URL(decl.navigate).pathname + new URL(decl.navigate).search; } catch { url = '/'; }
  }
  const tag = payload.tag || decl.tag || (payload.id ? `sigma-${payload.id}` : 'sigma-push');

  const options = {
    body,
    icon,
    badge,
    tag,
    renotify: true,
    timestamp: Date.now(),
    data: { url, id: payload.id, type: payload.type, timestamp: Date.now() },
  };
  if (Array.isArray(payload.actions) && payload.actions.length > 0) options.actions = payload.actions;

  const unread = typeof payload.unread === 'number' ? payload.unread : decl.app_badge;
  const badgeWork = typeof unread === 'number' && self.navigator && 'setAppBadge' in self.navigator
    ? (unread > 0 ? self.navigator.setAppBadge(unread) : self.navigator.clearAppBadge()).catch(() => {})
    : Promise.resolve();

  event.waitUntil(Promise.all([
    badgeWork,
    self.registration.showNotification(title, options).catch((err) => {
      console.warn('[SW] showNotification failed with full options, retrying basic:', err);
      return self.registration.showNotification(title, { body, icon, data: { url } });
    }),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  let targetUrl = (event.notification.data && event.notification.data.url) || '/';
  if (typeof targetUrl !== 'string' || (!targetUrl.startsWith('/') && !targetUrl.startsWith(self.location.origin))) {
    targetUrl = '/';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it and navigate
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url && client.url.includes(self.location.origin)) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
