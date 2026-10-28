// Office geofence: the admin saves the office coordinates + radius; office check-in sends this laptop's location
// and the database decides (public.attendance_check_in, see 20261028150000_office_geofence.sql).
import { supabase } from './supabase';

export interface OfficeLocation {
  name: string;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  enabled: boolean;
  updated_at?: string;
}

export interface Fix { lat: number; lng: number; accuracy: number }

export type GeoFailReason = 'location_required' | 'imprecise' | 'outside';
export interface GeoFail { reason: GeoFailReason; distance?: number; accuracy?: number; radius?: number; office?: string }

const db = supabase as any;

/** Office settings, or null when the feature isn't installed yet / can't be read. */
export async function fetchOffice(): Promise<OfficeLocation | null> {
  try {
    const { data, error } = await db.from('office_location').select('name,latitude,longitude,radius_m,enabled,updated_at').maybeSingle();
    if (error || !data) return null;
    return data as OfficeLocation;
  } catch {
    return null;
  }
}

export async function saveOffice(patch: Pick<OfficeLocation, 'name' | 'latitude' | 'longitude' | 'radius_m' | 'enabled'>): Promise<OfficeLocation> {
  const { data, error } = await db.from('office_location').update(patch).eq('id', true).select('name,latitude,longitude,radius_m,enabled,updated_at');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('Only an admin can change the office location.');
  return data[0] as OfficeLocation;
}

/**
 * Reads "17.44012, 78.34891" (what Google Maps copies when you right-click a spot), also with spaces only,
 * a degree sign, or a Google Maps link containing @lat,lng or ?q=lat,lng.
 */
export function parseCoords(text: string): { lat: number; lng: number } | null {
  const t = text.trim();
  if (!t) return null;
  const fromUrl = t.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) || t.match(/[?&](?:q|query|ll)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  const plain = t.replace(/°/g, '').match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  const m = fromUrl || plain;
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

export const fmtCoords = (lat: number, lng: number) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

export function fmtDistance(m?: number | null): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export class GeoError extends Error {
  constructor(public kind: 'denied' | 'unavailable' | 'timeout' | 'unsupported', message: string) { super(message); }
}

export function platform(): 'mac' | 'windows' | 'other' {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}

/**
 * A fresh, precise reading. Laptops get their position from nearby Wi-Fi networks, so Wi-Fi must be ON (it can stay
 * connected to a phone hotspot — it only needs to see the networks around it).
 */
export function getFix(timeoutMs = 20000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeoError('unsupported', 'This browser can’t share your location. Use Chrome, Edge or Safari.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => {
        if (e.code === e.PERMISSION_DENIED) reject(new GeoError('denied', 'Location is blocked for SIGMA 1.'));
        else if (e.code === e.TIMEOUT) reject(new GeoError('timeout', 'Finding your location took too long.'));
        else reject(new GeoError('unavailable', 'Your computer couldn’t work out its location.'));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
  });
}

/** Step-by-step help for the problem, tailored to Mac / Windows. */
export function locationHelp(kind: GeoError['kind'] | 'imprecise'): string[] {
  const os = platform();
  const systemSteps = os === 'mac'
    ? ['Open System Settings → Privacy & Security → Location Services.', 'Turn Location Services on, and switch it on for your browser (Chrome / Safari / Edge).']
    : os === 'windows'
      ? ['Open Settings → Privacy & security → Location.', 'Turn on Location services and “Let desktop apps access your location”.']
      : ['Turn on location / Location Services in your computer’s settings for this browser.'];
  if (kind === 'denied') {
    return ['Click the icon at the left of the address bar → Site settings / Permissions → Location → Allow.', ...systemSteps, 'Reload this page and check in again.'];
  }
  if (kind === 'imprecise' || kind === 'unavailable' || kind === 'timeout') {
    return ['Make sure Wi-Fi is turned ON (it can stay on your hotspot — it only needs to see nearby networks).', ...systemSteps, 'Then try again.'];
  }
  return ['Use an up-to-date Chrome, Edge or Safari.'];
}

/** Same great-circle distance the database uses (metres). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
