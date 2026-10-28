// The signed-in employee's work pattern for today (public.my_attendance_context): what they can use, where they can
// check in from, hybrid office-day progress. One shared load per session; refreshed after check-in.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { FeatureKey } from './workRules';

export interface DayRules {
  date: string;
  employment_type: string;
  working_day: boolean;
  off_reason: 'before_join' | 'engagement_ended' | 'weekly_off' | 'saturday_off' | 'holiday' | null;
  attendance: boolean;
  location: 'office' | 'home' | 'either';
  location_mode: 'office' | 'hybrid' | 'remote';
  geofence: boolean;
  field_visit: boolean;
  schedule: string;
  earliest_checkin: string | null;
  full_day_minutes: number;
  features: Record<FeatureKey, boolean>;
}
export interface HybridStatus {
  period: 'week' | 'month'; from: string; to: string; required: number; configured: number; working_days: number;
  office_done: number; home_done: number; home_allowed: number; home_left: number; office_left: number;
}
export interface WorkContext {
  rules: DayRules;
  hybrid: HybridStatus | null;
  wfh: { allowed: boolean; reason: string | null; request: string | null; can_request: boolean };
  office: { name: string; radius_m: number; enabled: boolean } | null;
}

let cache: Promise<WorkContext | null> | null = null;
let cacheFor: string | null = null;
const listeners = new Set<(c: WorkContext | null) => void>();

async function load(): Promise<WorkContext | null> {
  try {
    const { data, error } = await (supabase as any).rpc('my_attendance_context');
    if (error || !data) return null; // not installed yet / not an employee → callers keep today's behaviour
    return data as WorkContext;
  } catch {
    return null;
  }
}

export function getWorkContext(userId: string): Promise<WorkContext | null> {
  if (!cache || cacheFor !== userId) { cacheFor = userId; cache = load(); }
  return cache;
}

export function refreshWorkContext() {
  cache = load();
  void cache.then((c) => listeners.forEach((l) => l(c)));
}

export function resetWorkContext() { cache = null; }

// one refresh per check-in / break / check-out, however many screens are listening
if (typeof window !== 'undefined') window.addEventListener('ira:attendance', () => { if (cache) refreshWorkContext(); });

/** undefined while loading, null when unavailable (old database / not an employee). */
export function useWorkContext(userId: string | null | undefined): WorkContext | null | undefined {
  const [ctx, setCtx] = useState<WorkContext | null | undefined>(undefined);
  useEffect(() => {
    if (!userId) { setCtx(null); return; }
    let alive = true;
    void getWorkContext(userId).then((c) => { if (alive) setCtx(c); });
    const l = (c: WorkContext | null) => { if (alive) setCtx(c); };
    listeners.add(l);
    return () => { alive = false; listeners.delete(l); };
  }, [userId]);
  return ctx;
}

/** A feature is on unless the pattern explicitly switches it off (so nothing disappears while loading). */
export const featureOn = (ctx: WorkContext | null | undefined, k: FeatureKey) => ctx?.rules?.features?.[k] !== false;

export const OFF_REASON_TEXT: Record<string, string> = {
  weekly_off: 'Today is your weekly off. Attendance isn’t recorded today.',
  saturday_off: 'This Saturday is your day off.',
  holiday: 'Today is a company holiday. Attendance isn’t recorded today.',
  engagement_ended: 'Your engagement has ended.',
  before_join: 'Your start date hasn’t arrived yet.',
};
