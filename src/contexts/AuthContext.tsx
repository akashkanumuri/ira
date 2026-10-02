import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { UserRole } from '../types/attendance';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  empId: string | null;
  employeeDbId: string | null;
  loginId: string | null;
  name: string;
  avatar: string | null;
  department: string | null;
  designation: string | null;
  designationId: string | null;
  departmentId: string | null;
  phone?: string;
  shift?: string;
  shiftEnd?: string;
  manager?: string | null;
  managerId?: string | null;
  status?: 'active' | 'inactive';
  workMode?: 'office' | 'remote';
  wfhBalance?: number;
  leaveBalance?: number;
  currentSalary?: number;
  joinDate?: string;
}

type LoginPortal = 'employee' | 'admin';

const ADMIN_LOGIN_IDS = new Set(['IRA', 'APEXADMIN']);
export const ADMIN_AUTH_EMAIL = 'ira.admin@ira-presence.local';
const EMPLOYEE_AUTH_DOMAIN = 'employee.ira.local';

export function normalizeLoginId(value: string): string {
  return value.trim().toLowerCase();
}

export function loginIdToAuthEmail(loginId: string): string {
  return `${normalizeLoginId(loginId)}@${EMPLOYEE_AUTH_DOMAIN}`;
}

interface AuthContextValue {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  signIn: (identifier: string, password: string, portal: LoginPortal) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string, currentPassword?: string) => Promise<{ error: string | null }>;
  isConfigured: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ACTIVE_SESSION_ID_KEY = 'ira_presence_active_auth_session_id_v2';

function formatSessionDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 3600)}h ${Math.floor((safe % 3600) / 60)}m`;
}

async function startApplicationSession(user: AuthUser): Promise<void> {
  if (!isSupabaseConfigured) return;
  const now = new Date();
  const { data: activeRows } = await (supabase as any)
    .from('auth_sessions')
    .select('id, login_at')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('login_at', { ascending: false });

  for (const row of activeRows ?? []) {
    const duration = Math.max(0, Math.floor((now.getTime() - new Date(row.login_at).getTime()) / 1000));
    await (supabase as any)
      .from('auth_sessions')
      .update({ logout_at: now.toISOString(), session_duration_seconds: duration, status: 'ended' })
      .eq('id', row.id);
  }

  const { data, error } = await (supabase as any)
    .from('auth_sessions')
    .insert({
      user_id: user.id,
      login_at: now.toISOString(),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      status: 'active',
    })
    .select('id')
    .single();

  if (!error && data?.id) {
    sessionStorage.setItem(ACTIVE_SESSION_ID_KEY, data.id);
  }
}

async function endApplicationSession(userId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const sessionId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(ACTIVE_SESSION_ID_KEY) : null;
  const now = new Date();

  let query = (supabase as any)
    .from('auth_sessions')
    .select('id, login_at')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (sessionId) query = query.eq('id', sessionId);

  const { data } = await query;
  for (const row of data ?? []) {
    const duration = Math.max(0, Math.floor((now.getTime() - new Date(row.login_at).getTime()) / 1000));
    await (supabase as any)
      .from('auth_sessions')
      .update({ logout_at: now.toISOString(), session_duration_seconds: duration, status: 'ended' })
      .eq('id', row.id);
  }
  if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(ACTIVE_SESSION_ID_KEY);
}

export interface CurrentEmployeeRow {
  id: string;
  profile_id: string | null;
  emp_id: string;
  login_id: string;
  name: string;
  work_email: string | null;
  phone: string | null;
  status: 'active' | 'inactive';
  work_mode: 'office' | 'remote';
  shift_start: string;
  shift_end: string;
  join_date: string;
  department_id: string | null;
  designation_id: string;
  manager_id: string | null;
  avatar_url: string | null;
}

const loadUserProfile = async (supabaseUser: User): Promise<AuthUser | null> => {
  if (!isSupabaseConfigured) return null;

  const db = supabase as any;
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('id, role, emp_id')
    .eq('id', supabaseUser.id)
    .maybeSingle();

  if (profileError || !profile) {
    console.error('[Auth] Profile lookup failed:', profileError);
    return null;
  }

  if (profile.role === 'admin') {
    return {
      id: supabaseUser.id,
      email: supabaseUser.email ?? ADMIN_AUTH_EMAIL,
      role: 'admin',
      empId: null,
      employeeDbId: null,
      loginId: 'IRA',
      name: 'IRA',
      avatar: null,
      department: null,
      designation: null,
      designationId: null,
      departmentId: null,
      status: 'active',
    };
  }

  const { data: employee, error: employeeError } = await db
    .from('employees')
    .select('id, profile_id, emp_id, login_id, name, work_email, phone, status, work_mode, shift_start, shift_end, join_date, department_id, designation_id, manager_id, avatar_url')
    .eq('profile_id', supabaseUser.id)
    .maybeSingle();

  if (employeeError || !employee) {
    console.error('[Auth] Employee lookup failed:', employeeError);
    return null;
  }

  const [{ data: department }, { data: designation }, { data: manager }, { data: salary }] = await Promise.all([
    employee.department_id
      ? db.from('departments').select('name').eq('id', employee.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
    employee.designation_id
      ? db.from('designations').select('name').eq('id', employee.designation_id).maybeSingle()
      : Promise.resolve({ data: null }),
    employee.manager_id
      ? db.from('employees').select('name').eq('id', employee.manager_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('salary_history').select('monthly_salary').eq('employee_id', employee.id).lte('effective_from', new Date().toISOString().slice(0, 10)).order('effective_from', { ascending: false }).limit(1).maybeSingle(),
  ]);

  return {
    id: supabaseUser.id,
    email: employee.work_email ?? supabaseUser.email ?? loginIdToAuthEmail(employee.login_id),
    role: 'employee',
    empId: employee.emp_id,
    employeeDbId: employee.id,
    loginId: employee.login_id,
    name: employee.name,
    avatar: employee.avatar_url ?? null,
    department: department?.name ?? null,
    designation: designation?.name ?? null,
    designationId: employee.designation_id,
    departmentId: employee.department_id,
    phone: employee.phone ?? undefined,
    shift: employee.shift_start ?? undefined,
    shiftEnd: employee.shift_end ?? undefined,
    manager: manager?.name ?? null,
    managerId: employee.manager_id ?? null,
    status: employee.status,
    workMode: employee.work_mode,
    wfhBalance: 0,
    leaveBalance: 0,
    currentSalary: salary?.monthly_salary == null ? undefined : Number(salary.monthly_salary),
    joinDate: employee.join_date,
  };
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!isSupabaseConfigured) {
        setLoading(false);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) {
        const profile = await loadUserProfile(data.session.user);
        if (mounted) setUser(profile);
      }
      if (mounted) setLoading(false);
    };
    void load();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      if (!nextSession?.user) {
        setUser(null);
        setLoading(false);
        return;
      }
      const profile = await loadUserProfile(nextSession.user);
      if (mounted) {
        setUser(profile);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user || user.role !== 'employee' || !user.employeeDbId) return;
    const employeeId = user.employeeDbId;
    let active = true;
    const channel = (supabase as any).channel(`ira-employee-status-${user.id}`);
    const handleInactive = async () => {
      await supabase.auth.signOut();
      if (!active) return;
      setUser(null);
      setSession(null);
    };
    channel.on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'employees',
      filter: `id=eq.${employeeId}`,
    }, (payload: any) => {
      if (payload.new?.status === 'inactive') void handleInactive();
    });
    channel.subscribe();

    const timer = window.setInterval(async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      if (!data.user) {
        setUser(null);
        setSession(null);
        return;
      }
      const current = await loadUserProfile(data.user);
      if (!current || current.status === 'inactive') {
        await supabase.auth.signOut();
        if (active) {
          setUser(null);
          setSession(null);
        }
        return;
      }
      setUser(current);
    }, 60000);

    return () => {
      active = false;
      window.clearInterval(timer);
      (supabase as any).removeChannel(channel);
    };
  }, [user?.id, user?.role, user?.employeeDbId]);

  const signIn = useCallback(async (identifier: string, password: string, portal: LoginPortal) => {
    const value = identifier.trim();
    if (!value || !password) return { error: 'Please enter all required fields.' };
    if (!isSupabaseConfigured) return { error: 'Unable to sign in right now. Please try again.' };

    try {
      const email = portal === 'admin'
        ? (ADMIN_LOGIN_IDS.has(value.toUpperCase()) ? ADMIN_AUTH_EMAIL : '')
        : (/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(value) ? loginIdToAuthEmail(value) : '');

      if (!email) {
        return { error: portal === 'admin' ? 'Admin ID or password is incorrect.' : 'Login ID or password is incorrect.' };
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) return { error: 'Invalid credentials. Please check your details and try again.' };

      const authUser = await loadUserProfile(data.user);
      if (!authUser) {
        await supabase.auth.signOut();
        return { error: 'Your account is not fully configured. Please contact the administrator.' };
      }

      if (authUser.status === 'inactive') {
        await supabase.auth.signOut();
        return { error: 'This account is inactive. Please contact the administrator.' };
      }

      if (authUser.role !== portal) {
        await supabase.auth.signOut();
        return { error: `This account is not enabled for the ${portal} portal.` };
      }

      await startApplicationSession(authUser);
      setSession(data.session);
      setUser(authUser);
      return { error: null };
    } catch (error) {
      console.error('[Auth] Sign-in failed:', error);
      return { error: 'Unable to sign in right now. Please try again.' };
    }
  }, []);

  const signOut = useCallback(async () => {
    if (user?.id) await endApplicationSession(user.id);
    if (isSupabaseConfigured) await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, [user?.id]);

  const changePassword = useCallback(async (newPassword: string, currentPassword = '') => {
    if (!isSupabaseConfigured) return { error: 'Unable to change password right now.' };
    if (newPassword.length < 12 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      return { error: 'Password must be at least 12 characters and include uppercase, lowercase, number and symbol.' };
    }
    if (!currentPassword) return { error: 'Current password is required.' };
    const reauthEmail = user?.role === 'admin' ? ADMIN_AUTH_EMAIL : (user?.loginId ? loginIdToAuthEmail(user.loginId) : '');
    if (!reauthEmail) return { error: 'Unable to determine the account email.' };
    const { error: reauthError } = await supabase.auth.signInWithPassword({ email: reauthEmail, password: currentPassword });
    if (reauthError) return { error: 'Current password is incorrect.' };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  }, [user?.role, user?.loginId]);

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signOut, changePassword, isConfigured: isSupabaseConfigured }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export { formatSessionDuration };
