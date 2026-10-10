// IRA Presence V2 - Standards-based Web Push & Device Subscription Manager
import { supabase } from './supabase';

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : ({} as Record<string, any>);
export const VAPID_PUBLIC_KEY =
  (env.VITE_VAPID_PUBLIC_KEY as string | undefined) ||
  'BNWjdwx1DlkshpNNLzmJKNfIEpySs_Yru1_smlmVUuk3yLdUlpvcAjf3NWwwffSh0QquTUKgPZwtsZic4N23KR0';

export type PushPermissionStatus = 'unsupported' | 'default' | 'granted' | 'denied';

export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isIosDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isIosStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  const isStandalone =
    ('standalone' in window.navigator && Boolean((window.navigator as any).standalone)) ||
    window.matchMedia('(display-mode: standalone)').matches;
  return Boolean(isStandalone);
}

export function isIosNeedsHomeScreen(): boolean {
  return isIosDevice() && !isIosStandalonePWA();
}

export function getPushPermissionState(): PushPermissionStatus {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission as PushPermissionStatus;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const decodeFn = typeof window !== 'undefined' && window.atob ? window.atob : (typeof globalThis !== 'undefined' && globalThis.atob ? globalThis.atob : (s: string) => Buffer.from(s, 'base64').toString('binary'));
  const rawData = decodeFn(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = typeof window !== 'undefined' && window.btoa ? window.btoa(binary) : (typeof globalThis !== 'undefined' && (globalThis as any).btoa ? (globalThis as any).btoa(binary) : Buffer.from(binary, 'binary').toString('base64'));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    // Guard against ready promise hanging indefinitely on backgrounded tabs
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
    return registration;
  } catch (err) {
    console.error('[WebPush] Service Worker registration failed:', err);
    return null;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.getRegistration('/'));
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch (err) {
    console.warn('[WebPush] Error checking existing subscription:', err);
    return null;
  }
}

export async function syncExistingPushSubscription(userId: string): Promise<boolean> {
  if (!isPushSupported() || !userId) return false;
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.getRegistration('/'));
    if (!reg) return false;
    let subscription = await reg.pushManager.getSubscription();

    // If notification permission was already granted by user, but PushManager subscription is missing or expired, renew it
    if (!subscription && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as any,
        });
      } catch (renewErr) {
        console.debug('[WebPush] Auto-renew subscription exception:', renewErr);
      }
    }

    if (!subscription) return false;

    const subJson = subscription.toJSON();
    let p256dh = subJson.keys?.p256dh;
    let auth = subJson.keys?.auth;

    // Fallback: extract directly from ArrayBuffer if toJSON omits keys (WebKit / iOS Safari)
    if (!p256dh && subscription.getKey) {
      const p256dhRaw = subscription.getKey('p256dh');
      if (p256dhRaw) p256dh = arrayBufferToBase64(p256dhRaw);
    }
    if (!auth && subscription.getKey) {
      const authRaw = subscription.getKey('auth');
      if (authRaw) auth = arrayBufferToBase64(authRaw);
    }

    if (!subscription.endpoint || !p256dh || !auth) return false;

    const { error } = await (supabase as any).rpc('save_push_subscription', {
      p_endpoint: subscription.endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent.slice(0, 500),
    });

    if (error) {
      console.warn('[WebPush] Background sync error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.debug('[WebPush] Background sync exception:', err);
    return false;
  }
}

export async function subscribeToPush(
  userId: string
): Promise<{ success: boolean; subscription?: PushSubscription; error?: string }> {
  // CRITICAL: On iOS, Web Push is strictly blocked in Safari tabs and only allowed in standalone PWA mode.
  if (isIosNeedsHomeScreen()) {
    return {
      success: false,
      error: 'iPhone requires adding this app to your Home Screen first. Tap the Safari Share button (square with arrow up), tap "Add to Home Screen", then open the app from your Home Screen to enable notifications.',
    };
  }

  if (!isPushSupported()) {
    return { success: false, error: 'Web Push notifications are not supported in this browser or device.' };
  }

  if (!userId) {
    return { success: false, error: 'User authentication required to subscribe.' };
  }

  try {
    // 1. Request permission explicitly via user gesture (supports both Promise & callback)
    let permission = Notification.permission;
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = await new Promise((resolve) => {
          Notification.requestPermission((p) => resolve(p));
        });
      }
    }

    if (permission !== 'granted') {
      return {
        success: false,
        error: permission === 'denied'
          ? 'Notification permission was denied. Please allow notifications in your browser/device settings.'
          : 'Notification permission was dismissed.',
      };
    }

    // 2. Register Service Worker
    const registration = await registerServiceWorker();
    if (!registration) {
      return { success: false, error: 'Failed to initialize the Service Worker.' };
    }

    // 3. Subscribe with PushManager
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as any,
        });
      } catch (subErr) {
        // If an existing subscription had mismatched keys, unsubscribe and renew
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          await existing.unsubscribe();
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey as any,
          });
        } else {
          throw subErr;
        }
      }
    }

    // 4. Extract keys with ArrayBuffer fallback and persist to Supabase using secure RPC
    const subJson = subscription.toJSON();
    let p256dh = subJson.keys?.p256dh;
    let auth = subJson.keys?.auth;

    if (!p256dh && subscription.getKey) {
      const p256dhRaw = subscription.getKey('p256dh');
      if (p256dhRaw) p256dh = arrayBufferToBase64(p256dhRaw);
    }
    if (!auth && subscription.getKey) {
      const authRaw = subscription.getKey('auth');
      if (authRaw) auth = arrayBufferToBase64(authRaw);
    }

    if (!subscription.endpoint || !p256dh || !auth) {
      return { success: false, error: 'Failed to extract push encryption credentials.' };
    }

    const { error: dbError } = await (supabase as any).rpc('save_push_subscription', {
      p_endpoint: subscription.endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent.slice(0, 500),
    });

    if (dbError) {
      console.error('[WebPush] Database save failed:', dbError.message);
      return { success: false, error: `Failed to record device subscription: ${dbError.message}` };
    }

    return { success: true, subscription };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during push subscription';
    console.error('[WebPush] Subscribe error:', err);
    return { success: false, error: message };
  }
}

export async function unsubscribeFromPush(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const subscription = await getExistingSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      try {
        await (supabase as any)
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', endpoint);
      } catch (dbErr) {
        console.warn('[WebPush] Error removing subscription from DB:', dbErr);
      }
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to unsubscribe';
    return { success: false, error: message };
  }
}

/**
 * Triggers a local verification notification directly through the active Service Worker.
 * Proves that the service worker notification lifecycle and click routing work on this device.
 */
export async function sendLocalTestPushNotification(
  title = 'IRA Presence - Notification Test',
  body = 'Push notification channel is active and operating correctly on your device.',
  actionUrl = '/'
): Promise<boolean> {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return false;
    }
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'ira-test-' + Date.now(),
      renotify: true,
      data: { url: actionUrl, timestamp: Date.now() },
      vibrate: [120, 60, 120],
    } as any);
    return true;
  } catch (err) {
    console.error('[WebPush] Local test notification failed:', err);
    return false;
  }
}
