import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Eye, EyeOff, LockKeyhole, UserRound, AlertCircle, Mail, ArrowLeft, ArrowRight } from 'lucide-react';
import { AuthLayout, AuthField } from '../../ui/AuthLayout';
import { PillTabs } from '../../ui';

type Portal = 'employee' | 'admin' | 'client';

interface PortalMeta {
  roleName: string;
  headline: string;
  subtitle: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  emptyError: string;
}

const PORTAL_META: Record<Portal, PortalMeta> = {
  employee: {
    roleName: 'Employee',
    headline: 'Your day, your work and your time off — in one place.',
    subtitle: 'Sign in to your employee workspace.',
    identifierLabel: 'Login ID',
    identifierPlaceholder: 'Username / Login ID',
    emptyError: 'Please enter your Login ID and password.',
  },
  admin: {
    roleName: 'Admin',
    headline: 'People, clients and delivery under one roof.',
    subtitle: 'Sign in to administration.',
    identifierLabel: 'Admin ID',
    identifierPlaceholder: 'Admin ID',
    emptyError: 'Please enter your Admin ID and password.',
  },
  client: {
    roleName: 'Client',
    headline: 'Contracts, deliverables and billing for your account.',
    subtitle: 'Sign in to your client portal.',
    identifierLabel: 'Client Login ID',
    identifierPlaceholder: 'Login ID or email',
    emptyError: 'Please enter your Client Login ID and password.',
  },
};

export const PortalLoginScreen: React.FC<{ portal?: Portal }> = ({ portal = 'employee' }) => {
  const { signIn } = useAuth();
  const [activePortal, setActivePortal] = useState<Portal>(portal);
  const [screen, setScreen] = useState<'login' | 'forgot'>('login');

  // Login form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Password reset state
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState('');

  const meta = PORTAL_META[activePortal] || PORTAL_META.employee;

  useEffect(() => {
    setActivePortal(portal);
    setIdentifier('');
    setPassword('');
    setError('');
    setShowPassword(false);
    setScreen('login');
  }, [portal]);

  const switchPortal = (next: Portal) => {
    if (next === activePortal || loading) return;
    setActivePortal(next);
    setIdentifier('');
    setPassword('');
    setError('');
    setShowPassword(false);
    setScreen('login');
    const path = next === 'admin' ? '/admin/login' : next === 'client' ? '/client/login' : '/login';
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  // Lets the animated sign-in scene react (robot shakes its head, portal flashes, etc.).
  const announce = (detail: 'error' | 'success') => window.dispatchEvent(new CustomEvent('ira-login', { detail }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!identifier.trim() || !password) {
      setError(meta.emptyError);
      announce('error');
      return;
    }

    setLoading(true);
    try {
      const result = await signIn(identifier.trim(), password, activePortal);
      if (result.error) setError(result.error);
      announce(result.error ? 'error' : 'success');
    } catch {
      setError('Unable to sign in right now. Please try again.');
      announce('error');
    } finally {
      setLoading(false);
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');

    const targetEmail = resetEmail.trim();
    if (!targetEmail) return;

    setResetLoading(true);
    try {
      const redirectTo = `${window.location.origin}/client/setup`;
      const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
        redirectTo,
      });
      if (error) {
        setResetError(error.message);
      } else {
        setResetSent(true);
      }
    } catch {
      setResetError('Unable to send password reset link right now. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  // Staff sign-in (SIGMA 1) only switches between Employee and Admin; clients use their own IRA page at /client/login.
  const isClient = activePortal === 'client';
  const portalTabs: Array<{ id: Portal; label: string }> = [
    { id: 'employee', label: 'Employee' },
    { id: 'admin', label: 'Admin' },
  ];

  const errorBox = (text: string) => (
    <div className="rise flex items-start gap-2.5 rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700" role="alert">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );

  return (
    <AuthLayout brand={isClient ? 'ira' : 'sigma'} eyebrow={isClient ? 'IRA Hospitality · Client portal' : 'SIGMA 1'} headline={meta.headline}>
      {screen === 'forgot' ? (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-[32px] font-bold leading-tight text-ink-950">Reset password</h2>
            <p className="mt-2 text-sm text-ink-500">
              {activePortal === 'client'
                ? resetSent ? 'Check your email for the recovery link.' : 'Enter the email address your account was created with.'
                : 'For security, staff passwords are reset by your administrator.'}
            </p>
          </div>

          {activePortal !== 'client' ? (
            <div className="space-y-5">
              <div className="inset-tile p-4 text-[13px] text-ink-600 leading-relaxed">
                {activePortal === 'employee'
                  ? 'Ask your HR or system administrator to reset your password. They will give you a temporary password, which you can change from your Profile after signing in.'
                  : 'Ask the system owner to reset the administrator password.'}
              </div>
              <button type="button" onClick={() => setScreen('login')} className="btn-secondary w-full !min-h-[52px]">
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </button>
            </div>
          ) : resetSent ? (
            <div className="space-y-5">
              <p className="text-sm text-ink-600 leading-relaxed">
                If an account matches <span className="font-semibold text-ink-900">{resetEmail}</span>, we have sent a secure link to reset your password.
              </p>
              <button
                type="button"
                onClick={() => { setResetSent(false); setResetEmail(''); setScreen('login'); }}
                className="btn-primary w-full !min-h-[52px]"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4" noValidate>
              {resetError && errorBox(resetError)}
              <AuthField
                icon={<Mail className="w-[18px] h-[18px]" />}
                id="ira-reset-email"
                type="email"
                value={resetEmail}
                onChange={e => { setResetEmail(e.target.value); if (resetError) setResetError(''); }}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Email address"
                aria-label="Email address"
                required
              />
              <button type="submit" disabled={resetLoading} className="btn-primary w-full !min-h-[52px]">
                {resetLoading ? 'Sending link…' : 'Send reset link'}
              </button>
              <button type="button" onClick={() => { setResetError(''); setScreen('login'); }} className="btn-ghost w-full">
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="space-y-7">
          <div>
            <h2 className="font-display text-[32px] font-bold leading-tight text-ink-950">Sign in</h2>
            <p className="mt-2 text-sm text-ink-500">{meta.subtitle}</p>
          </div>

          {!isClient && <PillTabs items={portalTabs} value={activePortal} onChange={switchPortal} className="w-full [&>button]:flex-1 [&>button]:justify-center" />}

          <form onSubmit={submit} className="space-y-4" noValidate>
            {error && errorBox(error)}
            <AuthField
              icon={<UserRound className="w-[18px] h-[18px]" />}
              id="ira-login-identifier"
              value={identifier}
              onChange={e => { setIdentifier(e.target.value); if (error) setError(''); }}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              enterKeyHint="next"
              placeholder={meta.identifierPlaceholder}
              aria-label={meta.identifierLabel}
            />
            <AuthField
              icon={<LockKeyhole className="w-[18px] h-[18px]" />}
              id="ira-login-password"
              value={password}
              onChange={e => { setPassword(e.target.value); if (error) setError(''); }}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              placeholder="Password"
              aria-label="Password"
              trailing={
                <button type="button" className="icon-btn" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                </button>
              }
            />
            <div className="flex justify-end">
              <button type="button" onClick={() => { setScreen('forgot'); setError(''); }} className="text-[13px] font-semibold text-brand-700 hover:text-brand-800">
                Forgot password?
              </button>
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full !min-h-[52px] !text-sm">
              {loading ? 'Signing in…' : <>Sign in <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
        </div>
      )}
    </AuthLayout>
  );
};

export const EmployeeLoginScreen = () => <PortalLoginScreen portal="employee" />;
export const AdminLoginScreen = () => <PortalLoginScreen portal="admin" />;
export const ClientLoginScreen = () => <PortalLoginScreen portal="client" />;
