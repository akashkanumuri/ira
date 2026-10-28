// One device per employee login. The browser keeps a random device id; the database decides which device
// currently holds the employee's login (see 20261027120000_employee_single_device.sql).
import { supabase } from './supabase';

const DEVICE_KEY = 'sigma1-device-id';
const NOTICE_KEY = 'sigma1-signout-notice';
let memoryId: string | null = null;

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch {
    if (!memoryId) memoryId = crypto.randomUUID();
    return memoryId;
  }
}

export interface DeviceClaim { ok: boolean; exempt?: boolean; released?: boolean; device?: string; since?: string; last_seen?: string; free_at?: string }

/** Ask the server whether this device holds the login. Returns null if the check itself failed (never blocks on errors). */
export async function claimDevice(isSignIn: boolean): Promise<DeviceClaim | null> {
  try {
    const { data, error } = await (supabase as any).rpc('device_claim', {
      p_device_id: getDeviceId(),
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null,
      p_is_sign_in: isSignIn,
    });
    if (error) return null;
    return data as DeviceClaim;
  } catch {
    return null;
  }
}

export async function releaseDevice(): Promise<void> {
  try { await (supabase as any).rpc('device_release', { p_device_id: getDeviceId() }); } catch { /* best effort */ }
}

export function blockedMessage(c: DeviceClaim): string {
  const freeAt = c.free_at ? new Date(c.free_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : null;
  return `This account is in use on ${c.device || 'another device'}. Sign out there first${freeAt ? `, or try again after ${freeAt} (a device that’s been inactive for an hour is signed out automatically)` : ''}, or ask your admin to release it.`;
}

/** Message shown on the sign-in page after this device was signed out by the one-device rule. */
export function setSignOutNotice(text: string) { try { sessionStorage.setItem(NOTICE_KEY, text); } catch { /* ignore */ } }
export function takeSignOutNotice(): string | null {
  try { const v = sessionStorage.getItem(NOTICE_KEY); if (v) sessionStorage.removeItem(NOTICE_KEY); return v; } catch { return null; }
}
