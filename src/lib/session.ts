import { UserRole, AuthSession } from '../types/attendance';
import { supabase, isSupabaseConfigured } from './supabase';

const ACTIVE_SESSION_ID_KEY = 'ira_presence_active_auth_session_id_v1';

function detectUserAgent(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown browser';
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export async function startNewSession(
  userId: string,
  userName: string,
  userRole: UserRole
): Promise<AuthSession | null> {
  if (!isSupabaseConfigured) return null;

  const now = new Date();
  const userAgent = detectUserAgent();
  const db = supabase as any;

  // Close any previous real session first. This does not touch attendance.
  // Persist its duration so the history page never shows a guessed value.
  const { data: activeSessions } = await db
    .from('auth_sessions')
    .select('id, login_at')
    .eq('user_id', userId)
    .eq('status', 'active');

  for (const active of activeSessions ?? []) {
    const durationSeconds = Math.max(0, Math.floor((now.getTime() - new Date(active.login_at).getTime()) / 1000));
    await db
      .from('auth_sessions')
      .update({
        logout_at: now.toISOString(),
        session_duration_seconds: durationSeconds,
        status: 'ended',
      })
      .eq('id', active.id);
  }

  const { data, error } = await db
    .from('auth_sessions')
    .insert({
      user_id: userId,
      login_at: now.toISOString(),
      user_agent: userAgent,
      status: 'active',
    })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[Session] Failed to persist login session:', error);
    return null;
  }

  sessionStorage.setItem(ACTIVE_SESSION_ID_KEY, data.id);
  return {
    id: data.id,
    userId,
    userName,
    userRole,
    loginTime: data.login_at,
    logoutTime: data.logout_at,
    sessionDuration: data.session_duration_seconds == null ? null : formatDuration(data.session_duration_seconds),
    userAgent: data.user_agent ?? userAgent,
    sessionStatus: data.status,
  };
}

export async function endActiveSession(userId: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  const now = new Date();
  const db = supabase as any;
  const activeSessionId = sessionStorage.getItem(ACTIVE_SESSION_ID_KEY);

  let query = db
    .from('auth_sessions')
    .select('id, login_at')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (activeSessionId) query = query.eq('id', activeSessionId);
  const { data: activeSessions } = await query;

  for (const active of activeSessions ?? []) {
    const durationSeconds = Math.max(0, Math.floor((now.getTime() - new Date(active.login_at).getTime()) / 1000));
    await db
      .from('auth_sessions')
      .update({
        logout_at: now.toISOString(),
        session_duration_seconds: durationSeconds,
        status: 'ended',
      })
      .eq('id', active.id);
  }
  sessionStorage.removeItem(ACTIVE_SESSION_ID_KEY);
}

export function mapAuthSession(row: any, userName: string, userRole: UserRole): AuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    userName,
    userRole,
    loginTime: row.login_at,
    logoutTime: row.logout_at,
    sessionDuration: row.session_duration_seconds == null ? null : formatDuration(row.session_duration_seconds),
    userAgent: row.user_agent ?? null,
    sessionStatus: row.status,
  };
}
