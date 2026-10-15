import React, { useState } from 'react';
import { ArrowLeft, Check, Eye, EyeOff, Loader2, Mail } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { ClientAuthLayout } from './ClientAuthLayout';
import { ClientAlert } from './ClientAlert';

interface ClientLoginViewProps {
  onSwitchToStaff?: () => void;
}

export const ClientLoginView: React.FC<ClientLoginViewProps> = ({ onSwitchToStaff }) => {
  const { signIn } = useAuth();
  const [screen, setScreen] = useState<'client-login' | 'forgot'>('client-login');

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
      const result = await signIn(identifier.trim(), password, 'client');
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
                setScreen('client-login');
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
              <ClientAlert tone="err" title="Password reset failed" className="mb-4">
                {resetError}
              </ClientAlert>
            )}

            <form onSubmit={handleResetPassword} className="space-y-4" noValidate>
              <div>
                <label htmlFor="client-reset-email" className="block text-xs font-medium text-[#172033] mb-1.5">
                  Login ID or email <span className="text-[#d64545]">*</span>
                </label>
                <input
                  id="client-reset-email"
                  type="email"
                  value={resetEmail}
                  onChange={e => {
                    setResetEmail(e.target.value);
                    if (resetError) setResetError('');
                  }}
                  autoComplete="username"
                  placeholder="client@company.com"
                  required
                  className="w-full h-9 px-3 rounded-md border border-[#e5e8ef] bg-white text-[13px] text-[#172033] placeholder:text-[#8a93a5] transition-colors hover:border-[#c9cfdb] focus:outline-none focus:border-[#243b64] focus:ring-2 focus:ring-[#243b64]/15"
                />
              </div>

              <button
                type="submit"
                disabled={resetLoading || !resetEmail.trim()}
                className="w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-md font-medium text-[13px] bg-[#243b64] text-white hover:bg-[#1c2f50] border border-[#243b64] transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                {resetLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Sending reset link…</span>
                  </>
                ) : (
                  'Send reset link'
                )}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setResetError('');
                setScreen('client-login');
              }}
              className="flex items-center gap-1.5 text-[13px] text-[#697386] hover:text-[#172033] mt-6 transition-colors cursor-pointer"
            >
              <ArrowLeft size={14} /> Back to sign in
            </button>
          </>
        )}
      </ClientAuthLayout>
    );
  }

  return (
    <ClientAuthLayout
      tag="Client portal"
      line="Your project, contract and payments in one clear place."
    >
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#172033]">
        Sign in to your project
      </h1>
      <p className="text-[13px] text-[#697386] mt-1.5 mb-7">
        Use the login ID shared in your welcome email.
      </p>

      {error && (
        <ClientAlert tone="err" title="Unable to sign in">
          {error}
        </ClientAlert>
      )}

      <form onSubmit={handleLogin} className="space-y-4" noValidate>
        <div>
          <label htmlFor="client-id" className="block text-xs font-medium text-[#172033] mb-1.5">
            Login ID or email <span className="text-[#d64545]">*</span>
          </label>
          <input
            id="client-id"
            type="email"
            value={identifier}
            onChange={e => {
              setIdentifier(e.target.value);
              if (error) setError('');
              if (validationError) setValidationError(false);
            }}
            autoComplete="username"
            placeholder="client@company.com"
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
              Enter your login ID
            </span>
          )}
        </div>

        <div>
          <label htmlFor="client-password" className="block text-xs font-medium text-[#172033] mb-1.5">
            Password <span className="text-[#d64545]">*</span>
          </label>
          <div className="relative">
            <input
              id="client-password"
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
          <label className="flex items-start gap-2.5 cursor-pointer text-[13px] text-[#172033] leading-5 select-none">
            <input
              type="checkbox"
              checked={keepSignedIn}
              onChange={e => setKeepSignedIn(e.target.checked)}
              className="peer sr-only"
            />
            <span className="mt-0.5 w-4 h-4 shrink-0 rounded-[4px] border border-[#b9c0cf] bg-white grid place-items-center peer-checked:bg-[#243b64] peer-checked:border-[#243b64] peer-focus-visible:outline-2 peer-focus-visible:outline-[#3478d4] peer-focus-visible:outline-offset-2 text-transparent peer-checked:text-white transition-colors">
              <Check size={11} strokeWidth={3.5} />
            </span>
            <span>Keep me signed in</span>
          </label>
          <button
            type="button"
            onClick={() => {
              setScreen('forgot');
              setError('');
            }}
            className="text-[13px] text-[#3478d4] hover:underline cursor-pointer"
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
        <button
          type="button"
          onClick={onSwitchToStaff}
          className="text-left hover:text-[#697386] transition-colors cursor-pointer"
        >
          Team member? Use team sign-in
        </button>
      </div>
    </ClientAuthLayout>
  );
};
