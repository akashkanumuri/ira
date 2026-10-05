import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Eye, EyeOff, LockKeyhole, UserRound, AlertCircle } from 'lucide-react';

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
    <main className="ira-login">
      <div className="ira-fluid-background" aria-hidden="true">
        <div className="ira-fluid-blob ira-fluid-blob-one" />
        <div className="ira-fluid-blob ira-fluid-blob-two" />
      </div>

      <div className="ira-login-frame">
        <section className="ira-login-panel">
          <div className="ira-login-heading">
            <img src="/ira-hospitality-logo.png" alt="IRA Hospitality" className="ira-login-brand-logo" />
            <h1>SIGN IN</h1>
          </div>

          {error && (
            <div className="ira-login-error" role="alert">
              <AlertCircle />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={submit} className="ira-login-form-stack" noValidate>
            <label className="ira-login-field">
              <span className="sr-only">{isEmployee ? 'Login ID' : 'Admin ID'}</span>
              <div className="ira-login-field-box">
                <UserRound aria-hidden="true" />
                <input
                  value={identifier}
                  onChange={e => { setIdentifier(e.target.value); if (error) setError(''); }}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  enterKeyHint="next"
                  placeholder={isEmployee ? 'Username' : 'Admin ID'}
                  aria-label={isEmployee ? 'Login ID' : 'Admin ID'}
                />
              </div>
            </label>

            <label className="ira-login-field">
              <span className="sr-only">Password</span>
              <div className="ira-login-field-box">
                <LockKeyhole aria-hidden="true" />
                <input
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
                />
                <button
                  type="button"
                  className="ira-login-eye"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </label>

            <button type="submit" disabled={loading} className="ira-login-submit">
              {loading ? 'SIGNING IN…' : 'SIGN IN'}
            </button>
          </form>

          <div className="ira-login-account-switch">
            <span>{isEmployee ? 'Have an admin account?' : 'Have an employee account?'}</span>
            <button type="button" onClick={() => switchPortal(isEmployee ? 'admin' : 'employee')}>
              {isEmployee ? 'ADMIN LOGIN' : 'EMPLOYEE LOGIN'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
};

export const EmployeeLoginScreen = () => <PortalLoginScreen portal="employee" />;
export const AdminLoginScreen = () => <PortalLoginScreen portal="admin" />;
