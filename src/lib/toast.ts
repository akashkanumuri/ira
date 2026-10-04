export type ToastType = 'success' | 'error' | 'info';
export type NotificationCategory = 'attendance' | 'leave' | 'wfh';

export interface ToastPayload {
  id?: string;
  type: ToastType;
  message: string;
  duration?: number;
  notificationCategory?: NotificationCategory;
}

export function notify(message: string, type: ToastType = 'info', duration = 4200, notificationCategory?: NotificationCategory) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastPayload>('ira:toast', {
    detail: { id: crypto.randomUUID(), type, message, duration, notificationCategory },
  }));
}
