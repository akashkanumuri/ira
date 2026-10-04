import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound, AlertCircle, CheckCircle2 } from 'lucide-react';

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
  }, [portal]);

  const switchPortal = (next: Portal) => {
    if (next === activePortal) return;
    setActivePortal(next);
    setIdentifier('');
    setPassword('');
    setError('');
    window.history.replaceState({}, '', next === 'admin' ? '/admin/login' : '/login');
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!identifier.trim() || !password) {
      setError(isEmployee ? 'Enter your Login ID and password.' : 'Enter your Admin ID and password.');
      return;
    }
    setLoading(true);
    const result = await signIn(identifier.trim(), password, activePortal);
    if (result.error) setError(result.error);
    setLoading(false);
  }

  return (
    <main className="ira-login min-h-[100dvh] flex items-center justify-center px-4 py-5 sm:px-6 lg:px-8">
      <div className="ira-login-shell w-full max-w-[1120px] overflow-hidden rounded-[28px] lg:rounded-[34px]">
        <aside className="ira-login-brand relative overflow-hidden px-7 py-8 sm:px-10 sm:py-10 lg:px-12 lg:py-12">
          <div className="ira-login-grid" />
          <div className="ira-login-glow ira-login-glow-a" />
          <div className="ira-login-glow ira-login-glow-b" />
          <div className="relative z-10 flex h-full flex-col justify-between min-h-[330px] sm:min-h-[380px] lg:min-h-[610px]">
            <div>
              <img src="/ira-hospitality-logo.png" alt="IRA Hospitality" className="h-auto w-[150px] sm:w-[175px] lg:w-[190px] object-contain object-left" />
              <div className="mt-8 h-px w-12 bg-[#cdb98e]/70" />
            </div>
            <div className="max-w-[360px]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-slate-400">Workforce portal</p>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-[34px] lg:leading-[1.1]">One secure place for your workday.</h2>
              <p className="mt-4 max-w-[310px] text-sm leading-6 text-slate-400">Attendance, assignments, requests and payroll — designed to stay simple.</p>
            </div>
            <div className="pt-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.08)]" />
                {isEmployee ? 'Employee access' : 'Admin access'}
              </div>
            </div>
          </div>
        </aside>

        <section className="ira-login-form flex items-center px-6 py-9 sm:px-10 sm:py-12 lg:px-16 lg:py-14">
          <div className="mx-auto w-full max-w-[440px]">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-blue-600">{isEmployee ? 'Employee sign in' : 'Admin sign in'}</p>
                <h1 className="mt-2.5 text-[30px] font-semibold leading-tight tracking-[-0.03em] text-slate-950 sm:text-[34px]">Welcome back</h1>
                <p className="mt-2.5 text-sm leading-6 text-slate-500">{isEmployee ? 'Sign in with the Login ID created for you.' : 'Sign in with your administrator credentials.'}</p>
              </div>
              <div className="ira-portal-switch shrink-0" role="tablist" aria-label="Portal type">
                <button type="button" role="tab" aria-selected={isEmployee} onClick={() => switchPortal('employee')} className={isEmployee ? 'active' : ''} aria-label="Employee portal"><UserRound className="h-4.5 w-4.5" /></button>
                <button type="button" role="tab" aria-selected={!isEmployee} onClick={() => switchPortal('admin')} className={!isEmployee ? 'active' : ''} aria-label="Admin portal"><ShieldCheck className="h-4.5 w-4.5" /></button>
              </div>
            </div>

            {error && (
              <div className="ira-login-error mt-7" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={submit} className="mt-7 space-y-5" noValidate>
              <label className="block">
                <span className="ira-login-label">{isEmployee ? 'Login ID' : 'Admin ID'}</span>
                <div className="ira-login-input-wrap">
                  <UserRound className="ira-login-input-icon" />
                  <input value={identifier} onChange={e => { setIdentifier(e.target.value); if (error) setError(''); }} autoComplete="username" placeholder={isEmployee ? 'Enter your Login ID' : 'Enter your Admin ID'} className="ira-login-input" />
                </div>
              </label>

              <label className="block">
                <span className="ira-login-label">Password</span>
                <div className="ira-login-input-wrap">
                  <LockKeyhole className="ira-login-input-icon" />
                  <input value={password} onChange={e => { setPassword(e.target.value); if (error) setError(''); }} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" className="ira-login-input pr-12" />
                  <button type="button" onClick={() => setShowPassword(v => !v)} className="ira-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button>
                </div>
              </label>

              <button disabled={loading} className="ira-login-submit" type="submit">
                <span>{loading ? 'Signing in…' : 'Sign in'}</span>
                {!loading ? <ArrowRight className="h-4.5 w-4.5" /> : <span className="ira-login-spinner" aria-hidden="true" />}
              </button>
            </form>

            <div className="mt-6 flex items-center gap-2 text-[11px] text-slate-400">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span>Secure access to the IRA workforce portal</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export const EmployeeLoginScreen = () => <PortalLoginScreen portal="employee" />;
export const AdminLoginScreen = () => <PortalLoginScreen portal="admin" />;
