import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { ClientLoginView } from '../client/ClientLoginView';
import { ClientAuthLayout } from '../client/ClientAuthLayout';
import { ClientAlert } from '../client/ClientAlert';

export type Portal = 'employee' | 'admin' | 'client';

interface PortalLoginScreenProps {
  portal?: Portal;
  onSwitchPortal?: (next: Portal) => void;
}

export const PortalLoginScreen: React.FC<PortalLoginScreenProps> = ({
  portal = 'employee',
  onSwitchPortal,
}) => {
  const { signIn } = useAuth();
  const [activePortal, setActivePortal] = useState<Portal>(portal);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState(false);

  useEffect(() => {
    setActivePortal(portal);
    setIdentifier('');
    setPassword('');
    setError('');
    setValidationError(false);
    setShowPassword(false);
  }, [portal]);

  const switchPortal = (next: Portal) => {
    if (loading) return;
    setActivePortal(next);
    setIdentifier('');
    setPassword('');
    setError('');
    setValidationError(false);
    setShowPassword(false);
    const path = next === 'admin' ? '/admin/login' : next === 'client' ? '/client/login' : '/login';
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', path);
    }
    onSwitchPortal?.(next);
  };

  if (activePortal === 'client') {
    return <ClientLoginView onSwitchToStaff={() => switchPortal('employee')} />;
  }

  const isAdmin = activePortal === 'admin';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setValidationError(false);

    if (!identifier.trim() || !password) {
      setValidationError(true);
      return;
    }

    setLoading(true);
    try {
      const result = await signIn(identifier.trim(), password, activePortal);
      if (result.error) {
        setError(result.error);
      }
    } catch {
      setError('Unable to sign in right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ClientAuthLayout
      tag={isAdmin ? 'Administration portal' : 'Team sign-in'}
      line={isAdmin ? 'Operations, permissions and workforce control.' : 'Attendance, work and people operations for the whole team.'}
    >
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#172033]">
        {isAdmin ? 'Administration sign-in' : 'Welcome back'}
      </h1>
      <p className="text-[13px] text-[#697386] mt-1.5 mb-7">
        {isAdmin ? 'Sign in with your IRA administrator credentials.' : 'Sign in with your IRA work account.'}
      </p>

      {error && (
        <ClientAlert tone="err" title="Unable to sign in">
          {error}
        </ClientAlert>
      )}

      <form onSubmit={submit} className="space-y-4" noValidate>
        {/* Role toggle matching reference UI */}
        <div>
          <label className="block text-xs font-medium text-[#172033] mb-1.5">Sign in as</label>
          <div className="grid grid-cols-2 gap-1 p-0.5 bg-[#eceef3] rounded-md">
            <button
              type="button"
              onClick={() => switchPortal('employee')}
              className={`h-8 rounded text-[13px] font-medium transition-colors cursor-pointer ${
                activePortal === 'employee' ? 'bg-white text-[#172033] shadow-xs' : 'text-[#697386] hover:text-[#172033]'
              }`}
            >
              Employee
            </button>
            <button
              type="button"
              onClick={() => switchPortal('admin')}
              className={`h-8 rounded text-[13px] font-medium transition-colors cursor-pointer ${
                activePortal === 'admin' ? 'bg-white text-[#172033] shadow-xs' : 'text-[#697386] hover:text-[#172033]'
              }`}
            >
              Administrator
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="portal-identifier" className="block text-xs font-medium text-[#172033] mb-1.5">
            {isAdmin ? 'Admin ID' : 'Login ID or work email'} <span className="text-[#d64545]">*</span>
          </label>
          <input
            id="portal-identifier"
            type="text"
            value={identifier}
            onChange={e => {
              setIdentifier(e.target.value);
              if (error) setError('');
              if (validationError) setValidationError(false);
            }}
            autoComplete="username"
            placeholder={isAdmin ? 'IRA' : 'EMP0001 or name@company.com'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className={`w-full h-9 px-3 rounded-md border ${
              validationError && !identifier.trim() ? 'border-[#d64545]' : 'border-[#e5e8ef]'
            } bg-white text-[13px] text-[#172033] placeholder:text-[#8a93a5] transition-colors hover:border-[#c9cfdb] focus:outline-none focus:border-[#243b64] focus:ring-2 focus:ring-[#243b64]/15`}
          />
          {validationError && !identifier.trim() && (
            <span className="block text-xs text-[#d64545] mt-1.5">
              {isAdmin ? 'Enter your Admin ID' : 'Enter your Login ID'}
            </span>
          )}
        </div>

        <div>
          <label htmlFor="portal-password" className="block text-xs font-medium text-[#172033] mb-1.5">
            Password <span className="text-[#d64545]">*</span>
          </label>
          <div className="relative">
            <input
              id="portal-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                if (error) setError('');
                if (validationError) setValidationError(false);
              }}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              className={`w-full h-9 pl-3 pr-9 rounded-md border ${
                validationError && !password ? 'border-[#d64545]' : 'border-[#e5e8ef]'
              } bg-white text-[13px] text-[#172033] placeholder:text-[#8a93a5] transition-colors hover:border-[#c9cfdb] focus:outline-none focus:border-[#243b64] focus:ring-2 focus:ring-[#243b64]/15`}
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0 top-0 h-9 w-9 grid place-items-center text-[#8a93a5] hover:text-[#172033] transition-colors cursor-pointer"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {validationError && !password && (
            <span className="block text-xs text-[#d64545] mt-1.5">
              Enter your password
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[#172033] select-none">
            <input
              type="checkbox"
              checked={keepSignedIn}
              onChange={e => setKeepSignedIn(e.target.checked)}
              className="rounded border-[#b9c0cf] text-[#243b64] focus:ring-[#243b64]"
            />
            <span>Keep me signed in</span>
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-md font-medium text-[13px] bg-[#243b64] text-white hover:bg-[#1c2f50] border border-[#243b64] transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Signing in…</span>
            </>
          ) : (
            'Sign in'
          )}
        </button>
      </form>

      <div className="mt-6 flex flex-col gap-2 text-xs text-[#8a93a5]">
        <button
          type="button"
          onClick={() => switchPortal('client')}
          className="text-left hover:text-[#697386] transition-colors cursor-pointer"
        >
          Client? Go to client portal sign-in
        </button>
      </div>
    </ClientAuthLayout>
  );
};

export const EmployeeLoginScreen: React.FC<{ onSwitchToClient?: () => void }> = ({ onSwitchToClient }) => (
  <PortalLoginScreen
    portal="employee"
    onSwitchPortal={next => {
      if (next === 'client') onSwitchToClient?.();
    }}
  />
);

export const AdminLoginScreen: React.FC<{ onSwitchToClient?: () => void }> = ({ onSwitchToClient }) => (
  <PortalLoginScreen
    portal="admin"
    onSwitchPortal={next => {
      if (next === 'client') onSwitchToClient?.();
    }}
  />
);

export const ClientLoginScreen: React.FC<{ onSwitchToStaff?: () => void }> = ({ onSwitchToStaff }) => (
  <ClientLoginView onSwitchToStaff={onSwitchToStaff} />
);
