export type ToastType = 'success' | 'error' | 'info';

export interface ToastPayload {
  id?: string;
  type: ToastType;
  message: string;
  duration?: number;
}

export function notify(message: string, type: ToastType = 'info', duration = 4200) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastPayload>('ira:toast', {
    detail: { id: crypto.randomUUID(), type, message, duration },
  }));
}
