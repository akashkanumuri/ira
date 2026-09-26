import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { UserRole } from '../types/attendance';
import { startNewSession, endActiveSession } from '../lib/session';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  empId: string | null;
  employeeDbId: string | null;
  name: string;
  avatar: string | null;
  department: string | null;
  designation: string | null;
  phone?: string;
  shift?: string;
  manager?: string;
  status?: 'active' | 'inactive';
}

type LoginPortal = 'employee' | 'admin';
const ADMIN_LOGIN_IDS = new Set(['IRA', 'APEXADMIN']);
const ADMIN_AUTH_EMAIL = 'ira.admin@ira-presence.local';

interface AuthContextValue {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  signIn: (identifier: string, password: string, portal: LoginPortal) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  isConfigured: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUserProfile = useCallback(async (supabaseUser: User): Promise<AuthUser | null> => {
    if (!isSupabaseConfigured) return null;

    try {
      const db = supabase as any;

      // Use the security-definer RPC created in Supabase to load the
      // authenticated user's complete account context. This avoids
      // RLS/relationship-query failures during login.
      const { data, error } = await db
        .rpc('get_current_user_context')
        .maybeSingle();

      if (error) {
        console.error('[Auth] User context RPC failed:', error);
        return null;
      }

      if (!data?.role) {
        console.error('[Auth] No user context found for authenticated user:', supabaseUser.id);
        return null;
      }

      const role = data.role as UserRole;

      if (role === 'admin') {
        return {
          id: supabaseUser.id,
          email: supabaseUser.email ?? data.email ?? '',
          role,
          empId: null,
          employeeDbId: null,
          name: 'IRA',
          avatar: null,
          department: null,
          designation: null,
          phone: undefined,
          shift: data.shift_start ?? undefined,
          manager: undefined,
          status: 'active',
        };
      }

      if (!data.employee_id) {
        console.error('[Auth] Employee record is missing for authenticated user:', supabaseUser.id);
        return null;
      }

      return {
        id: supabaseUser.id,
        email: supabaseUser.email ?? data.email ?? '',
        role,
        empId: data.emp_id ?? data.profile_emp_id ?? null,
        employeeDbId: data.employee_id,
        name: data.name ?? supabaseUser.user_metadata?.name ?? 'User',
        avatar: data.avatar_url ?? null,
        department: null,
        designation: data.designation ?? null,
        phone: data.phone ?? undefined,
        shift: data.shift_start ?? undefined,
        manager: undefined,
        status: data.status ?? 'active',
      };
    } catch (error) {
      console.error('[Auth] loadUserProfile error:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadInitialSession = async () => {
      if (!isSupabaseConfigured) {
        if (mounted) setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (error) console.error('[Auth] Session load failed:', error);
      if (!mounted) return;

      setSession(data.session);
      if (data.session?.user) {
        const authUser = await loadUserProfile(data.session.user);
        if (mounted) setUser(authUser);
      }
      if (mounted) setLoading(false);
    };

    void loadInitialSession();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);

      if (nextSession?.user) {
        const authUser = await loadUserProfile(nextSession.user);
        if (mounted) setUser(authUser);
      } else {
        setUser(null);
      }

      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadUserProfile]);

  const signIn = async (
    identifier: string,
    password: string,
    portal: LoginPortal
  ): Promise<{ error: string | null }> => {
    const value = identifier.trim();
    if (!value || !password) return { error: 'Please enter all required fields.' };
    if (!isSupabaseConfigured) return { error: 'Unable to sign in right now. Please try again.' };

    try {
      let email: string;

      if (portal === 'employee') {
        const { data: resolvedEmail, error: resolveError } = await (supabase as any).rpc(
          'get_employee_login_email',
          { p_name: value }
        );
        if (resolveError || !resolvedEmail) {
          return { error: 'Employee name or password is incorrect.' };
        }
        email = resolvedEmail;
      } else {
        if (!ADMIN_LOGIN_IDS.has(value.toUpperCase())) {
          return { error: 'Admin ID or password is incorrect.' };
        }
        email = ADMIN_AUTH_EMAIL;
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        return { error: 'Invalid credentials. Please check your details and try again.' };
      }

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

      await startNewSession(authUser.id, authUser.name, authUser.role);
      setSession(data.session);
      setUser(authUser);
      return { error: null };
    } catch (error: any) {
      console.error('[Auth] signIn error:', error);
      return { error: error?.message ?? 'Unable to sign in. Please try again.' };
    }
  };

  const signOut = async () => {
    if (user?.id && isSupabaseConfigured) await endActiveSession(user.id);
    if (isSupabaseConfigured) await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signOut, isConfigured: isSupabaseConfigured }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
