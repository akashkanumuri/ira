import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Eye, EyeOff, LockKeyhole, UserRound, AlertCircle, ShieldCheck, Clock3, BriefcaseBusiness } from 'lucide-react';

type Portal = 'employee' | 'admin';

export const PortalLoginScreen: React.FC<{ portal?: Portal }> = ({ portal = 'employee' }) => {
  const { signIn } = useAuth();
  const [activePortal, setActivePortal] = useState<Portal>(portal);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isEmployee = activePortal === 'employee';

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
    window.history.replaceState({}, '', next === 'admin' ? '/admin/login' : '/login');
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!identifier.trim() || !password) {
      setError(isEmployee ? 'Please enter your Login ID and password.' : 'Please enter your Admin ID and password.');
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
        {/* LEFT COLUMN: calm, centered welcome statement */}
        <section className="ira-login-welcome-panel" aria-label="Welcome to IRA Hospitality">
          <div className="ira-welcome-ambient" aria-hidden="true">
            <span className="ira-welcome-orb ira-welcome-orb-one" />
            <span className="ira-welcome-orb ira-welcome-orb-two" />
          </div>
          <div className="ira-welcome-copy">
            <p className="ira-welcome-eyebrow">IRA HOSPITALITY · INTERNAL PLATFORM</p>
            <h2 className="ira-welcome-title" aria-label="Welcome back">
              <span>WELCOME</span>
              <span>BACK</span>
            </h2>
            <p className="ira-welcome-subtitle">
              Your workspace is ready.
            </p>
            <span className="ira-welcome-rule" aria-hidden="true" />
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
                {isEmployee ? 'Employee Attendance & Work Portal' : 'Administration & HR Management'}
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
                <span className="sr-only">{isEmployee ? 'Login ID' : 'Admin ID'}</span>
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
                    placeholder={isEmployee ? 'Username / Login ID' : 'Admin ID'}
                    aria-label={isEmployee ? 'Login ID' : 'Admin ID'}
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
              <span className="ira-switch-prompt">
                {isEmployee ? 'Have an admin account?' : 'Have an employee account?'}
              </span>
              <button
                type="button"
                className="ira-switch-btn"
                onClick={() => switchPortal(isEmployee ? 'admin' : 'employee')}
              >
                {isEmployee ? 'ADMIN LOGIN' : 'EMPLOYEE LOGIN'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export const EmployeeLoginScreen = () => <PortalLoginScreen portal="employee" />;
export const AdminLoginScreen = () => <PortalLoginScreen portal="admin" />;
