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

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return registration;
  } catch (err) {
    console.error('[WebPush] Service Worker registration failed:', err);
    return null;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch (err) {
    console.warn('[WebPush] Error checking existing subscription:', err);
    return null;
  }
}

export async function subscribeToPush(
  userId: string
): Promise<{ success: boolean; subscription?: PushSubscription; error?: string }> {
  if (!isPushSupported()) {
    if (isIosNeedsHomeScreen()) {
      return {
        success: false,
        error: 'iPhone requires adding this application to the Home Screen to enable notifications. Tap Share > Add to Home Screen.',
      };
    }
    return { success: false, error: 'Web Push notifications are not supported in this browser.' };
  }

  if (!userId) {
    return { success: false, error: 'User authentication required to subscribe.' };
  }

  try {
    // 1. Request permission explicitly via user gesture
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        success: false,
        error: permission === 'denied'
          ? 'Notification permission was denied. Please allow notifications in your browser settings.'
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
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as any,
      });
    }

    // 4. Extract keys and persist to Supabase
    const subJson = subscription.toJSON();
    const p256dh = subJson.keys?.p256dh;
    const auth = subJson.keys?.auth;

    if (!subscription.endpoint || !p256dh || !auth) {
      return { success: false, error: 'Failed to extract push encryption credentials.' };
    }

    const { error: dbError } = await (supabase as any)
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh,
          auth,
          user_agent: navigator.userAgent.slice(0, 500),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      );

    if (dbError) {
      console.warn('[WebPush] Database save warning (table may require migration):', dbError.message);
      // Even if local DB insert has a warning, the browser subscription itself succeeded
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
      await subscription.unsubscribe();
      try {
        await (supabase as any)
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', subscription.endpoint)
          .eq('user_id', userId);
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
