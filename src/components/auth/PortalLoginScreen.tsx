import React, { useEffect, useRef, useState } from 'react';
import { takeSignOutNotice } from '../../lib/deviceLock';
import { useAuth } from '../../contexts/AuthContext';
import { Eye, EyeOff, LockKeyhole, UserRound, AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react';
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
    identifierLabel: 'Email address',
    identifierPlaceholder: 'Email address',
    emptyError: 'Please enter your email address and password.',
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
  // A notice left by the one-device rule (e.g. "signed in on another device") shows as the first message.
  const [error, setError] = useState(() => takeSignOutNotice() ?? '');
  // With a notice to show, the staff page opens with the form visible instead of hidden behind the robot.
  const [startWithNotice] = useState(() => Boolean(error));
  const firstPortalRun = useRef(true);

  const meta = PORTAL_META[activePortal] || PORTAL_META.employee;

  useEffect(() => {
    // keep a sign-out notice on first load; clear everything when switching portals afterwards
    if (firstPortalRun.current) { firstPortalRun.current = false; setActivePortal(portal); return; }
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

  // When the hidden staff sign-in closes itself after 30 s idle, don't leave a typed password behind.
  useEffect(() => {
    const onHidden = () => { setPassword(''); setShowPassword(false); setError(''); setScreen('login'); };
    window.addEventListener('sigma1-login-hidden', onHidden);
    return () => window.removeEventListener('sigma1-login-hidden', onHidden);
  }, []);

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
    <AuthLayout brand={isClient ? 'ira' : 'sigma'} secret={!isClient && !startWithNotice} eyebrow={isClient ? 'IRA Hospitality · Client portal' : 'SIGMA 1'} headline={meta.headline}>
      {screen === 'forgot' ? (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-[32px] font-bold leading-tight text-ink-950">Reset password</h2>
            <p className="mt-2 text-sm text-ink-500">
              {activePortal === 'client' ? 'Your IRA account manager can send you a new link.' : 'For security, staff passwords are reset by your administrator.'}
            </p>
          </div>
          <div className="space-y-5">
            <div className="inset-tile p-4 text-[13px] text-ink-600 leading-relaxed">
              {activePortal === 'client'
                ? 'Contact your IRA account manager and ask for a password reset link. Open the link they send you, choose a new password, and sign in with your email address. The link works once and expires in 24 hours.'
                : activePortal === 'employee'
                  ? 'Ask your HR or system administrator to reset your password. They will give you a temporary password, which you can change from your Profile after signing in.'
                  : 'Ask the system owner to reset the administrator password.'}
            </div>
            <button type="button" onClick={() => setScreen('login')} className="btn-secondary w-full !min-h-[52px]">
              <ArrowLeft className="w-4 h-4" /> Back to sign in
            </button>
          </div>
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
