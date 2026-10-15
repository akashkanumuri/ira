import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, LockKeyhole, AlertCircle, CheckCircle2, ShieldCheck, ArrowRight } from 'lucide-react';
import { invokeClientSetup } from '../../lib/v2';

export const ClientPasswordSetupScreen: React.FC = () => {
  const [token, setToken] = useState<string>('');
  const [verifying, setVerifying] = useState(true);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [clientInfo, setClientInfo] = useState<{ companyName: string; primaryContact: string; email: string } | null>(null);

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
          setVerifyError(res?.error || 'Invitation is invalid or has expired.');
        }
      } catch (err) {
        setVerifyError(err instanceof Error ? err.message : 'Unable to verify invitation link.');
      } finally {
        setVerifying(false);
      }
    })();
  }, []);

  // Password rules validation
  const hasMinLength = password.length >= 12;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const isFormValid = hasMinLength && hasUpper && hasLower && hasNumber && hasSymbol && passwordsMatch;

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

  return (
    <main className="ira-login-page">
      <div className="ira-fluid-background" aria-hidden="true">
        <div className="ira-fluid-blob ira-fluid-blob-one" />
        <div className="ira-fluid-blob ira-fluid-blob-two" />
      </div>

      <div className="ira-login-container">
        {/* Left Panel: Brand overview */}
        <section className="ira-login-brand-panel hidden lg:flex" aria-label="Client Portal">
          <div className="ira-welcome-container">
            <div className="ira-welcome-glow" aria-hidden="true" />
            <h2 className="ira-welcome-title">Client Portal</h2>
            <p className="text-slate-400 text-sm mt-3 max-w-sm leading-relaxed">
              Activate your client account to collaborate on projects, track deliverables, and manage operational milestones with IRA.
            </p>
          </div>
        </section>

        {/* Right Panel: Setup Form */}
        <section className="ira-login-form-panel">
          <div className="ira-login-form-box">
            <div className="ira-form-header">
              <img
                src="/ira-hospitality-logo.png"
                alt="IRA Hospitality"
                className="ira-form-logo"
              />
              <h1 className="ira-form-title">ACCOUNT SETUP</h1>
              <p className="ira-form-subtitle">Choose a secure password to activate your account</p>
            </div>

            {verifying ? (
              <div className="py-12 text-center text-slate-300 text-sm flex flex-col items-center gap-3">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span>Verifying your invitation link…</span>
              </div>
            ) : verifyError ? (
              <div className="space-y-4">
                <div className="ira-login-error" role="alert">
                  <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
                  <span>{verifyError}</span>
                </div>
                <div className="text-center pt-2">
                  <a
                    href="/client/login"
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors inline-flex items-center gap-1 font-semibold"
                  >
                    Go to Client Login <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ) : setupSuccess ? (
              <div className="space-y-5 text-center py-4">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/30">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Password Configured!</h3>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                    Your password has been set securely. You can now log in to access your projects.
                  </p>
                </div>
                <a
                  href="/client/login"
                  className="ira-submit-btn inline-flex items-center justify-center text-center no-underline"
                >
                  SIGN IN TO CLIENT PORTAL
                </a>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="ira-login-form space-y-4" noValidate>
                {/* Client Company Info */}
                {clientInfo && (
                  <div className="rounded-xl bg-white/5 border border-white/10 p-3.5 text-xs space-y-1">
                    <div className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Account Assigned</div>
                    <div className="font-bold text-white text-sm">{clientInfo.companyName}</div>
                    <div className="text-slate-300">Contact: {clientInfo.primaryContact} ({clientInfo.email})</div>
                  </div>
                )}

                {submitError && (
                  <div className="ira-login-error" role="alert">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{submitError}</span>
                  </div>
                )}

                {/* Password Input */}
                <label className="ira-form-field">
                  <span className="sr-only">New Password</span>
                  <div className="ira-input-wrapper">
                    <LockKeyhole className="ira-input-icon" aria-hidden="true" />
                    <input
                      id="ira-client-password"
                      value={password}
                      onChange={e => {
                        setPassword(e.target.value);
                        if (submitError) setSubmitError(null);
                      }}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="Create Password"
                      aria-label="New Password"
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

                {/* Confirm Password Input */}
                <label className="ira-form-field">
                  <span className="sr-only">Confirm Password</span>
                  <div className="ira-input-wrapper">
                    <LockKeyhole className="ira-input-icon" aria-hidden="true" />
                    <input
                      id="ira-client-confirm-password"
                      value={confirmPassword}
                      onChange={e => {
                        setConfirmPassword(e.target.value);
                        if (submitError) setSubmitError(null);
                      }}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="Confirm Password"
                      aria-label="Confirm Password"
                      className="ira-input"
                    />
                  </div>
                </label>

                {/* Security Requirements Checklist */}
                <div className="rounded-xl bg-slate-900/60 border border-white/5 p-3 text-[11px] space-y-1.5 text-slate-400">
                  <div className="flex items-center gap-1.5 font-bold text-slate-300 text-[10px] uppercase tracking-wider mb-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-400" /> Password Requirements
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-400' : ''}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" /> Minimum 12 characters
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasUpper && hasLower ? 'text-emerald-400' : ''}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" /> Uppercase and lowercase letters
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasNumber && hasSymbol ? 'text-emerald-400' : ''}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" /> At least one number and special character
                  </div>
                  <div className={`flex items-center gap-1.5 ${passwordsMatch ? 'text-emerald-400' : ''}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" /> Passwords match
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !isFormValid}
                  className="ira-submit-btn"
                >
                  {submitting ? 'SETTING PASSWORD…' : 'ACTIVATE ACCOUNT'}
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};
