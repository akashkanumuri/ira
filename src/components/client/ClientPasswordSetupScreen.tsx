import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck, TimerOff } from 'lucide-react';
import { invokeClientSetup } from '../../lib/v2';
import { ClientAuthLayout } from './ClientAuthLayout';
import { ClientAlert } from './ClientAlert';

export const ClientPasswordSetupScreen: React.FC = () => {
  const [token, setToken] = useState<string>('');
  const [verifying, setVerifying] = useState(true);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [clientInfo, setClientInfo] = useState<{
    companyName: string;
    primaryContact: string;
    email: string;
  } | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [setupSuccess, setSetupSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token')?.trim();

    if (!urlToken || !/^[0-9a-f]{64}$/i.test(urlToken)) {
      setVerifyError('Invalid or missing invitation token. Please check the link from your invitation email.');
      setVerifying(false);
      return;
    }

    setToken(urlToken);

    void (async () => {
      try {
        const res = await invokeClientSetup({ action: 'verify_token', token: urlToken });
        if (res?.valid) {
          setClientInfo({
            companyName: res.companyName,
            primaryContact: res.primaryContact,
            email: res.email,
          });
        } else {
          setVerifyError(res?.error || 'This invitation link is invalid or has expired.');
        }
      } catch (err) {
        setVerifyError(err instanceof Error ? err.message : 'Unable to verify invitation link.');
      } finally {
        setVerifying(false);
      }
    })();
  }, []);

  // Password rules validation
  const rules = [
    ['At least 12 characters', password.length >= 12],
    ['Contains a number', /\d/.test(password)],
    ['Contains uppercase & lowercase', /[A-Z]/.test(password) && /[a-z]/.test(password)],
    ['Contains a special character', /[^A-Za-z0-9]/.test(password)],
    ['Passwords match', !!password && password === confirmPassword],
  ] as const;

  const isFormValid = rules.every(([, ok]) => ok);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!isFormValid) {
      setSubmitError('Please ensure all password requirements are satisfied.');
      return;
    }

    setSubmitting(true);
    try {
      await invokeClientSetup({
        action: 'complete_setup',
        token,
        password,
      });
      setSetupSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to set password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // 1. Verifying Token State
  if (verifying) {
    return (
      <ClientAuthLayout
        tag="Account setup"
        line="Choose a password you’ll use to sign in from now on."
      >
        <div className="py-12 text-center text-[#697386] text-[13px] flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-[#243b64]" />
          <span>Verifying your invitation link…</span>
        </div>
      </ClientAuthLayout>
    );
  }

  // 2. Invalid or Expired Token State
  if (verifyError) {
    return (
      <ClientAuthLayout
        tag="Invitation"
        line="Secure links expire to keep your account safe."
      >
        <div className="w-10 h-10 rounded-md bg-[#fbf3e2] text-[#b7791f] grid place-items-center mb-4">
          <TimerOff size={18} />
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#172033]">
          This invitation link has expired
        </h1>
        <p className="text-[13px] text-[#697386] mt-1.5 mb-6 leading-relaxed">
          {verifyError}
        </p>
        <a
          href="/client/login"
          className="inline-flex items-center gap-1.5 text-[13px] text-[#697386] hover:text-[#172033] transition-colors"
        >
          <ArrowLeft size={14} /> Back to sign in
        </a>
      </ClientAuthLayout>
    );
  }

  // 3. Success State
  if (setupSuccess) {
    return (
      <ClientAuthLayout
        tag="Account setup"
        line="Choose a password you’ll use to sign in from now on."
      >
        <div className="w-10 h-10 rounded-md bg-[#e7f4ee] text-[#16845b] grid place-items-center mb-4">
          <CheckCircle2 size={18} />
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#172033]">
          Password set
        </h1>
        <p className="text-[13px] text-[#697386] mt-1.5 mb-6 leading-relaxed">
          Your account is ready. Sign in with{' '}
          <span className="font-medium text-[#172033]">{clientInfo?.email}</span> and your new password.
        </p>
        <a
          href="/client/login"
          className="w-full h-10 inline-flex items-center justify-center rounded-md font-medium text-[13px] bg-[#243b64] text-white hover:bg-[#1c2f50] border border-[#243b64] transition-colors no-underline"
        >
          Continue to sign in
        </a>
      </ClientAuthLayout>
    );
  }

  // 4. Setup Form State
  return (
    <ClientAuthLayout
      tag="Account setup"
      line="Choose a password you’ll use to sign in from now on."
    >
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#172033]">
        Set your password
      </h1>
      <p className="text-[13px] text-[#697386] mt-1.5 mb-6">
        For {clientInfo?.email || 'your account'}
        {clientInfo?.companyName ? ` · ${clientInfo.companyName}` : ''}
      </p>

      {submitError && (
        <ClientAlert tone="err" title="Unable to set password" className="mb-4">
          {submitError}
        </ClientAlert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="setup-new-password" className="block text-xs font-medium text-[#172033] mb-1.5">
            New password <span className="text-[#d64545]">*</span>
          </label>
          <div className="relative">
            <input
              id="setup-new-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                if (submitError) setSubmitError(null);
              }}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              className="w-full h-9 pl-3 pr-9 rounded-md border border-[#e5e8ef] bg-white text-[13px] text-[#172033] placeholder:text-[#8a93a5] transition-colors hover:border-[#c9cfdb] focus:outline-none focus:border-[#243b64] focus:ring-2 focus:ring-[#243b64]/15"
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-0 top-0 h-9 w-9 grid place-items-center text-[#8a93a5] hover:text-[#172033] transition-colors cursor-pointer"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="setup-confirm-password" className="block text-xs font-medium text-[#172033] mb-1.5">
            Confirm password <span className="text-[#d64545]">*</span>
          </label>
          <input
            id="setup-confirm-password"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={e => {
              setConfirmPassword(e.target.value);
              if (submitError) setSubmitError(null);
            }}
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className="w-full h-9 px-3 rounded-md border border-[#e5e8ef] bg-white text-[13px] text-[#172033] placeholder:text-[#8a93a5] transition-colors hover:border-[#c9cfdb] focus:outline-none focus:border-[#243b64] focus:ring-2 focus:ring-[#243b64]/15"
          />
        </div>

        {/* Security checklist matching reference */}
        <ul className="space-y-1.5 pt-1">
          {rules.map(([text, ok]) => (
            <li
              key={text}
              className={`flex items-center gap-2 text-xs transition-colors ${
                ok ? 'text-[#16845b]' : 'text-[#8a93a5]'
              }`}
            >
              <CheckCircle2 size={13} strokeWidth={ok ? 2.5 : 2} className="shrink-0" />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <button
          type="submit"
          disabled={submitting || !isFormValid}
          className="w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-md font-medium text-[13px] bg-[#243b64] text-white hover:bg-[#1c2f50] border border-[#243b64] transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
        >
          {submitting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Saving password…</span>
            </>
          ) : (
            'Save password'
          )}
        </button>
      </form>

      <p className="text-xs text-[#8a93a5] mt-5 flex gap-1.5 leading-relaxed">
        <ShieldCheck size={13} className="shrink-0 mt-0.5 text-[#243b64]" />
        <span>Passwords are stored securely and can’t be viewed by anyone, including administrators.</span>
      </p>
    </ClientAuthLayout>
  );
};
