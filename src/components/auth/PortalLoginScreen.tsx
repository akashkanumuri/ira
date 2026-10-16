import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, Eye, EyeOff, Loader2, Mail, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { ClientAuthLayout } from '../client/ClientAuthLayout';

type Portal = 'employee' | 'admin' | 'client';

interface PortalConfig {
  tag: string;
  line: string;
  notice: string;
  formTitle: string;
  formSubtitle: string;
  label: string;
  placeholder: string;
  emptyError: string;
}

const PORTAL_CONFIGS: Record<Portal, PortalConfig> = {
  client: {
    tag: 'CLIENT PORTAL',
    line: 'Your project, contract and payments in one clear place.',
    notice: 'Accounts are created by your administrator. There is no public registration.',
    formTitle: 'Sign in to your project',
    formSubtitle: 'Use the login ID shared in your welcome email.',
    label: 'Login ID or email',
    placeholder: 'dev@northwind.example',
    emptyError: 'Enter your login ID',
  },
  employee: {
    tag: 'EMPLOYEE PORTAL',
    line: 'Attendance, work and operations for the whole team.',
    notice: 'Accounts are created by your administrator. There is no public registration.',
    formTitle: 'Sign in to your workplace',
    formSubtitle: 'Use your Employee ID or registered work email.',
    label: 'Login ID or work email',
    placeholder: 'EMP0001 or name@company.com',
    emptyError: 'Enter your Login ID or work email',
  },
  admin: {
    tag: 'ADMIN PORTAL',
    line: 'Administration, workforce and system operations in one place.',
    notice: 'Restricted administrative access. Authorized personnel only.',
    formTitle: 'Sign in to administration',
    formSubtitle: 'Enter your IRA Administrator ID.',
    label: 'Admin ID',
    placeholder: 'IRA or APEXADMIN',
    emptyError: 'Enter your Admin ID',
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
  const [validationError, setValidationError] = useState(false);

  // Forgot password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState('');

  const cfg = PORTAL_CONFIGS[activePortal] || PORTAL_CONFIGS.employee;

  useEffect(() => {
    setActivePortal(portal);
    setIdentifier('');
    setPassword('');
    setError('');
    setValidationError(false);
    setShowPassword(false);
    setScreen('login');
  }, [portal]);

  const switchPortal = (next: Portal) => {
    if (loading) return;
    setActivePortal(next);
    setIdentifier('');
    setPassword('');
    setError('');
    setValidationError(false);
    setShowPassword(false);
    setScreen('login');
    const path = next === 'admin' ? '/admin/login' : next === 'client' ? '/client/login' : '/login';
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
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
  };

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

  if (screen === 'forgot') {
    return (
      <ClientAuthLayout
        tag="Password reset"
        line="We’ll email a secure link to reset your password."
      >
        {resetSent ? (
          <>
            <div className="w-10 h-10 rounded-md bg-[#e9f1fb] text-[#3478d4] grid place-items-center mb-4">
              <Mail size={18} />
            </div>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#172033]">
              Check your email
            </h1>
            <p className="text-[13px] text-[#697386] mt-1.5 mb-6 leading-relaxed">
              If an account matches <span className="font-medium text-[#172033]">{resetEmail}</span>,
              we’ve sent a reset link to choose a new password.
            </p>
            <button
              type="button"
              onClick={() => {
                setResetSent(false);
                setResetEmail('');
                setScreen('login');
              }}
              className="inline-flex items-center gap-1.5 text-[13px] text-[#697386] hover:text-[#172033] transition-colors cursor-pointer"
            >
              <ArrowLeft size={14} /> Back to sign in
            </button>
          </>
        ) : (
          <>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#172033]">
              Forgot password?
            </h1>
            <p className="text-[13px] text-[#697386] mt-1.5 mb-6">
              Enter your login ID or email address.
            </p>
            {resetError && (
              <div className="mb-4 p-3 rounded-md bg-[#fceeee] border border-[#f5c2c2] text-[#d64545] text-xs">
                {resetError}
              </div>
            )}
            <form onSubmit={handleResetPassword} className="space-y-4" noValidate>
              <div>
                <label htmlFor="portal-reset-email" className="block text-xs font-medium text-[#172033] mb-1.5">
                  Login ID or email <span className="text-[#d64545] ml-0.5">*</span>
                </label>
                <input
                  id="portal-reset-email"
                  type="email"
                  value={resetEmail}
                  onChange={e => {
                    setResetEmail(e.target.value);
                    if (resetError) setResetError('');
                  }}
                  autoComplete="username"
                  placeholder={cfg.placeholder}
                  required
                  className="w-full h-9 px-3 rounded-md border border-[#e5e8ef] bg-white text-[13px] text-[#172033] placeholder:text-[#8a93a5] transition-colors hover:border-[#c9cfdb] focus:outline-none focus:border-[#243b64] focus:ring-2 focus:ring-[#243b64]/15"
                />
              </div>

              <button
                type="submit"
                disabled={resetLoading}
                className="w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-md font-medium text-[13px] bg-[#243b64] text-white hover:bg-[#1c2f50] border border-[#243b64] transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                {resetLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Sending link…</span>
                  </>
                ) : (
                  'Send reset link'
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setResetError('');
                  setScreen('login');
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 text-[13px] text-[#697386] hover:text-[#172033] transition-colors cursor-pointer py-1"
              >
                <ArrowLeft size={14} /> Back to sign in
              </button>
            </form>
          </>
        )}
      </ClientAuthLayout>
    );
  }

  const inputId = activePortal === 'client' ? 'client-id' : 'portal-identifier';
  const passId = activePortal === 'client' ? 'client-password' : 'portal-password';

  return (
    <ClientAuthLayout tag={cfg.tag} line={cfg.line} notice={cfg.notice}>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#172033]">
        {cfg.formTitle}
      </h1>
      <p className="text-[13px] text-[#697386] mt-1.5 mb-6">
        {cfg.formSubtitle}
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-[#fceeee] border border-[#f5c2c2] text-[#d64545] text-xs flex items-center gap-2">
          <AlertCircle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4" noValidate>
        <div>
          <label htmlFor={inputId} className="block text-xs font-medium text-[#172033] mb-1.5">
            {cfg.label} <span className="text-[#d64545] ml-0.5">*</span>
          </label>
          <input
            id={inputId}
            type="text"
            value={identifier}
            onChange={e => {
              setIdentifier(e.target.value);
              if (error) setError('');
              if (validationError) setValidationError(false);
            }}
            autoComplete="username"
            placeholder={cfg.placeholder}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className={`w-full h-9 px-3 rounded-md border ${
              validationError && !identifier.trim() ? 'border-[#d64545]' : 'border-[#e5e8ef]'
            } bg-white text-[13px] text-[#172033] placeholder:text-[#8a93a5] transition-colors hover:border-[#c9cfdb] focus:outline-none focus:border-[#243b64] focus:ring-2 focus:ring-[#243b64]/15`}
          />
          {validationError && !identifier.trim() && (
            <span className="flex items-center gap-1 text-xs text-[#d64545] mt-1.5">
              <XCircle size={12} /> {cfg.emptyError}
            </span>
          )}
        </div>

        <div>
          <label htmlFor={passId} className="block text-xs font-medium text-[#172033] mb-1.5">
            Password <span className="text-[#d64545] ml-0.5">*</span>
          </label>
          <div className="relative">
            <input
              id={passId}
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
            <span className="flex items-center gap-1 text-xs text-[#d64545] mt-1.5">
              <XCircle size={12} /> Enter your password
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 text-xs sm:text-[13px]">
          <label className="flex items-center gap-2 cursor-pointer text-[#172033] leading-5 select-none shrink-0">
            <input
              type="checkbox"
              checked={keepSignedIn}
              onChange={e => setKeepSignedIn(e.target.checked)}
              className="peer sr-only"
            />
            <span className="w-4 h-4 shrink-0 rounded-[4px] border border-[#b9c0cf] bg-white grid place-items-center peer-checked:bg-[#243b64] peer-checked:border-[#243b64] peer-focus-visible:outline-2 peer-focus-visible:outline-[#3478d4] peer-focus-visible:outline-offset-2 text-transparent peer-checked:text-white transition-colors">
              <Check size={11} strokeWidth={3.5} />
            </span>
            <span>Keep me signed in</span>
          </label>
          <button
            type="button"
            onClick={() => {
              setScreen('forgot');
              setError('');
              setResetError('');
            }}
            className="text-[#3478d4] hover:underline cursor-pointer shrink-0"
          >
            Forgot password?
          </button>
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
        {activePortal === 'client' && (
          <button
            type="button"
            onClick={() => switchPortal('employee')}
            className="text-left hover:text-[#697386] transition-colors cursor-pointer"
          >
            Team member? Use employee sign-in
          </button>
        )}
        {activePortal === 'employee' && (
          <>
            <button
              type="button"
              onClick={() => switchPortal('client')}
              className="text-left hover:text-[#697386] transition-colors cursor-pointer"
            >
              Client? Go to client portal sign-in
            </button>
            <button
              type="button"
              onClick={() => switchPortal('admin')}
              className="text-left hover:text-[#697386] transition-colors cursor-pointer"
            >
              Administrator? Use admin sign-in
            </button>
          </>
        )}
        {activePortal === 'admin' && (
          <>
            <button
              type="button"
              onClick={() => switchPortal('employee')}
              className="text-left hover:text-[#697386] transition-colors cursor-pointer"
            >
              Team member? Use employee sign-in
            </button>
            <button
              type="button"
              onClick={() => switchPortal('client')}
              className="text-left hover:text-[#697386] transition-colors cursor-pointer"
            >
              Client? Go to client portal sign-in
            </button>
          </>
        )}
      </div>
    </ClientAuthLayout>
  );
};

export const EmployeeLoginScreen = () => <PortalLoginScreen portal="employee" />;
export const AdminLoginScreen = () => <PortalLoginScreen portal="admin" />;
export const ClientLoginScreen = () => <PortalLoginScreen portal="client" />;
