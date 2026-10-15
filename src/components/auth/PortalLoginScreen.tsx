import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Eye, EyeOff, LockKeyhole, UserRound, AlertCircle } from 'lucide-react';

type Portal = 'employee' | 'admin' | 'client';

export const PortalLoginScreen: React.FC<{ portal?: Portal }> = ({ portal = 'employee' }) => {
  const { signIn } = useAuth();
  const [activePortal, setActivePortal] = useState<Portal>(portal);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isEmployee = activePortal === 'employee';
  const isClient = activePortal === 'client';

  useEffect(() => {
    setActivePortal(portal);
    setIdentifier('');
    setPassword('');
    setError('');
    setShowPassword(false);
  }, [portal]);

  const switchPortal = (next: Portal) => {
    if (next === activePortal || loading) return;
    setActivePortal(next);
    setIdentifier('');
    setPassword('');
    setError('');
    setShowPassword(false);
    const path = next === 'admin' ? '/admin/login' : next === 'client' ? '/client/login' : '/login';
    window.history.replaceState({}, '', path);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!identifier.trim() || !password) {
      setError(
        isEmployee
          ? 'Please enter your Login ID and password.'
          : isClient
          ? 'Please enter your email and password.'
          : 'Please enter your Admin ID and password.'
      );
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
                {isEmployee
                  ? 'Employee Attendance & Work Portal'
                  : isClient
                  ? 'Client Project & Operations Portal'
                  : 'Administration & HR Management'}
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
                <span className="sr-only">
                  {isEmployee ? 'Login ID' : isClient ? 'Client Email' : 'Admin ID'}
                </span>
                <div className="ira-input-wrapper">
                  <UserRound className="ira-input-icon" aria-hidden="true" />
                  <input
                    id="ira-login-identifier"
                    value={identifier}
                    onChange={e => {
                      setIdentifier(e.target.value);
                      if (error) setError('');
                    }}
                    autoComplete={isClient ? 'email' : 'username'}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode={isClient ? 'email' : 'text'}
                    type={isClient ? 'email' : 'text'}
                    enterKeyHint="next"
                    placeholder={
                      isEmployee
                        ? 'Username / Login ID'
                        : isClient
                        ? 'Company Email'
                        : 'Admin ID'
                    }
                    aria-label={isEmployee ? 'Login ID' : isClient ? 'Client Email' : 'Admin ID'}
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

              <button
                type="submit"
                disabled={loading}
                className="ira-submit-btn"
              >
                {loading ? 'SIGNING IN…' : 'SIGN IN'}
              </button>
            </form>

            {/* Portal Switcher */}
            <div className="ira-portal-switch">
              <span className="ira-switch-prompt">Need a different portal?</span>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                {activePortal !== 'employee' && (
                  <button
                    type="button"
                    className="ira-switch-btn"
                    onClick={() => switchPortal('employee')}
                  >
                    EMPLOYEE LOGIN
                  </button>
                )}
                {activePortal !== 'admin' && (
                  <button
                    type="button"
                    className="ira-switch-btn"
                    onClick={() => switchPortal('admin')}
                  >
                    ADMIN LOGIN
                  </button>
                )}
                {activePortal !== 'client' && (
                  <button
                    type="button"
                    className="ira-switch-btn"
                    onClick={() => switchPortal('client')}
                  >
                    CLIENT LOGIN
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export const EmployeeLoginScreen = () => <PortalLoginScreen portal="employee" />;
export const AdminLoginScreen = () => <PortalLoginScreen portal="admin" />;
export const ClientLoginScreen = () => <PortalLoginScreen portal="client" />;

