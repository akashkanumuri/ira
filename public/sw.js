// IRA Presence V2 - Web Push Service Worker
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
      payload = { title: 'IRA Presence', body: event.data.text() };
    }
  }

  const title = payload.title || 'IRA Presence Update';
  const body = payload.body || payload.message || 'You have a new work notification.';
  const icon = payload.icon || '/icon-192.png';
  const badge = payload.badge || '/icon-192.png';
  const url = payload.action_url || payload.url || '/';
  const tag = payload.tag || (payload.id ? `ira-${payload.id}` : 'ira-presence-push');

  const options = {
    body,
    icon,
    badge,
    tag,
    renotify: true,
    data: {
      url,
      id: payload.id,
      timestamp: Date.now(),
    },
  };

  // Safe checks for vibration and actions to prevent iOS WebKit errors
  if ('vibrate' in navigator) {
    options.vibrate = [120, 60, 120];
  }
  if (Array.isArray(payload.actions) && payload.actions.length > 0) {
    options.actions = payload.actions;
  }

  event.waitUntil(
    self.registration.showNotification(title, options).catch((err) => {
      // Fallback for browsers (such as iOS WebKit) that reject extended options
      console.warn('[SW] showNotification failed with full options, retrying basic:', err);
      return self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        data: { url },
      });
    })
  );
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
