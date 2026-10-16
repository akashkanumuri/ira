import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Eye, EyeOff, LockKeyhole, UserRound, AlertCircle, Mail } from 'lucide-react';

type Portal = 'employee' | 'admin' | 'client';

interface PortalMeta {
  roleName: string;
  subtitle: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  emptyError: string;
}

const PORTAL_META: Record<Portal, PortalMeta> = {
  employee: {
    roleName: 'Employee',
    subtitle: 'Employee Attendance & Work Portal',
    identifierLabel: 'Login ID',
    identifierPlaceholder: 'Username / Login ID',
    emptyError: 'Please enter your Login ID and password.',
  },
  admin: {
    roleName: 'Admin',
    subtitle: 'Administration & HR Management',
    identifierLabel: 'Admin ID',
    identifierPlaceholder: 'Admin ID',
    emptyError: 'Please enter your Admin ID and password.',
  },
  client: {
    roleName: 'Client',
    subtitle: 'Client Project & Contract Portal',
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
  const [keepSignedIn, setKeepSignedIn] = useState(true);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!identifier.trim() || !password) {
      setError(meta.emptyError);
      return;
    }

    setLoading(true);
    try {
      const result = await signIn(identifier.trim(), password, activePortal);
      if (result.error) setError(result.error);
    } catch {
      setError('Unable to sign in right now. Please try again.');
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

  return (
    <main className="ira-login-page">
      {/* Ambient background glow (from fluid login reference, adapted to IRA palette) */}
      <div className="ira-fluid-background" aria-hidden="true">
        <div className="ira-fluid-blob ira-fluid-blob-one" />
        <div className="ira-fluid-blob ira-fluid-blob-two" />
      </div>

      {/* Two-column container on desktop; single form on mobile */}
      <div className="ira-login-container">
        {/* LEFT COLUMN: Clean, middle-aligned animated Welcome Back (Desktop only) */}
        <section className="ira-login-brand-panel" aria-label="Welcome Back">
          <div className="ira-welcome-container">
            <div className="ira-welcome-glow" aria-hidden="true" />
            <h2 className="ira-welcome-title">
              Welcome Back
            </h2>
          </div>
        </section>

        {/* RIGHT COLUMN: The Auth Form (Desktop and Mobile) */}
        <section className="ira-login-form-panel" aria-label="Sign In">
          {screen === 'forgot' ? (
            <div className="ira-login-form-box">
              <div className="ira-form-header">
                <img
                  src="/ira-hospitality-logo.png"
                  alt="IRA Hospitality"
                  className="ira-form-logo"
                />
                <h1 className="ira-form-title">PASSWORD RESET</h1>
                <p className="ira-form-subtitle">
                  {resetSent
                    ? 'Check your email for the recovery link.'
                    : 'Enter your registered email to reset your password.'}
                </p>
              </div>

              {resetError && (
                <div className="ira-login-error" role="alert">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{resetError}</span>
                </div>
              )}

              {resetSent ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-300 leading-relaxed">
                    If an account matches <span className="text-white font-medium">{resetEmail}</span>, we have sent a secure link to reset your password.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setResetSent(false);
                      setResetEmail('');
                      setScreen('login');
                    }}
                    className="ira-submit-btn"
                  >
                    BACK TO SIGN IN
                  </button>
                </div>
              ) : (
                <form onSubmit={handleResetPassword} className="ira-login-form" noValidate>
                  <label className="ira-form-field">
                    <span className="sr-only">Registered Email</span>
                    <div className="ira-input-wrapper">
                      <Mail className="ira-input-icon" aria-hidden="true" />
                      <input
                        id="ira-reset-email"
                        type="email"
                        value={resetEmail}
                        onChange={e => {
                          setResetEmail(e.target.value);
                          if (resetError) setResetError('');
                        }}
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="Registered email address"
                        aria-label="Registered email address"
                        className="ira-input"
                        required
                      />
                    </div>
                  </label>

                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="ira-submit-btn"
                  >
                    {resetLoading ? 'SENDING LINK…' : 'SEND RESET LINK'}
                  </button>

                  <div className="ira-portal-switch">
                    <button
                      type="button"
                      className="ira-switch-btn"
                      onClick={() => {
                        setResetError('');
                        setScreen('login');
                      }}
                    >
                      BACK TO SIGN IN
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <div className="ira-login-form-box">
              {/* Header: Logo & Title */}
              <div className="ira-form-header">
                <img
                  src="/ira-hospitality-logo.png"
                  alt="IRA Hospitality"
                  className="ira-form-logo"
                />
                <h1 className="ira-form-title">SIGN IN</h1>
                <p className="ira-form-subtitle">
                  {meta.subtitle}
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="ira-login-error" role="alert">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{error}</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={submit} className="ira-login-form" noValidate>
                <label className="ira-form-field">
                  <span className="sr-only">{meta.identifierLabel}</span>
                  <div className="ira-input-wrapper">
                    <UserRound className="ira-input-icon" aria-hidden="true" />
                    <input
                      id="ira-login-identifier"
                      value={identifier}
                      onChange={e => {
                        setIdentifier(e.target.value);
                        if (error) setError('');
                      }}
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      inputMode="text"
                      enterKeyHint="next"
                      placeholder={meta.identifierPlaceholder}
                      aria-label={meta.identifierLabel}
                      className="ira-input"
                    />
                  </div>
                </label>

                <label className="ira-form-field">
                  <span className="sr-only">Password</span>
                  <div className="ira-input-wrapper">
                    <LockKeyhole className="ira-input-icon" aria-hidden="true" />
                    <input
                      id="ira-login-password"
                      value={password}
                      onChange={e => {
                        setPassword(e.target.value);
                        if (error) setError('');
                      }}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="done"
                      placeholder="Password"
                      aria-label="Password"
                      className="ira-input pr-12"
                    />
                    <button
                      type="button"
                      className="ira-password-toggle"
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </label>

                <div className="flex items-center justify-between text-xs text-slate-400 px-1 -mt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 select-none">
                    <input
                      type="checkbox"
                      checked={keepSignedIn}
                      onChange={e => setKeepSignedIn(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900"
                    />
                    <span>Keep me signed in</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setScreen('forgot');
                      setError('');
                    }}
                    className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="ira-submit-btn"
                >
                  {loading ? 'SIGNING IN…' : 'SIGN IN'}
                </button>
              </form>

              {/* Portal Switchers */}
              <div className="ira-portal-switch">
                {activePortal === 'employee' && (
                  <>
                    <div className="flex items-center gap-1.5 w-full justify-center">
                      <span className="ira-switch-prompt">Have an admin account?</span>
                      <button
                        type="button"
                        className="ira-switch-btn"
                        onClick={() => switchPortal('admin')}
                      >
                        ADMIN LOGIN
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 w-full justify-center mt-1">
                      <span className="ira-switch-prompt">Have a client account?</span>
                      <button
                        type="button"
                        className="ira-switch-btn"
                        onClick={() => switchPortal('client')}
                      >
                        CLIENT LOGIN
                      </button>
                    </div>
                  </>
                )}

                {activePortal === 'admin' && (
                  <>
                    <div className="flex items-center gap-1.5 w-full justify-center">
                      <span className="ira-switch-prompt">Have an employee account?</span>
                      <button
                        type="button"
                        className="ira-switch-btn"
                        onClick={() => switchPortal('employee')}
                      >
                        EMPLOYEE LOGIN
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 w-full justify-center mt-1">
                      <span className="ira-switch-prompt">Have a client account?</span>
                      <button
                        type="button"
                        className="ira-switch-btn"
                        onClick={() => switchPortal('client')}
                      >
                        CLIENT LOGIN
                      </button>
                    </div>
                  </>
                )}

                {activePortal === 'client' && (
                  <>
                    <div className="flex items-center gap-1.5 w-full justify-center">
                      <span className="ira-switch-prompt">Have an employee account?</span>
                      <button
                        type="button"
                        className="ira-switch-btn"
                        onClick={() => switchPortal('employee')}
                      >
                        EMPLOYEE LOGIN
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 w-full justify-center mt-1">
                      <span className="ira-switch-prompt">Have an admin account?</span>
                      <button
                        type="button"
                        className="ira-switch-btn"
                        onClick={() => switchPortal('admin')}
                      >
                        ADMIN LOGIN
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
};

export const EmployeeLoginScreen = () => <PortalLoginScreen portal="employee" />;
export const AdminLoginScreen = () => <PortalLoginScreen portal="admin" />;
export const ClientLoginScreen = () => <PortalLoginScreen portal="client" />;
