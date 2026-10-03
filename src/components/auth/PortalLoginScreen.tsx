import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { notify } from '../../lib/toast';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';

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
      const message=isEmployee ? 'Enter your Login ID and password.' : 'Enter your Admin ID and password.';
      setError(message); notify(message,'error'); return;
    }
    setLoading(true);
    const result = await signIn(identifier, password, activePortal);
    if (result.error) { setError(result.error); notify(result.error,'error'); }
    setLoading(false);
  }

  return (
    <main className="min-h-[100dvh] bg-slate-100 px-0 sm:px-5 lg:px-8 flex items-center justify-center">
      <div className="w-full max-w-6xl min-h-[100dvh] sm:min-h-[640px] bg-white sm:rounded-[28px] border border-slate-200 overflow-hidden shadow-[0_30px_100px_rgba(15,23,42,.14)] grid md:grid-cols-12">
        <aside className="md:col-span-5 bg-[#030817] text-white relative overflow-hidden px-7 py-8 sm:px-9 sm:py-10 min-h-[255px] md:min-h-[640px] flex flex-col justify-between">
          <div className="absolute inset-0 opacity-45 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:18px_18px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(96,165,250,.12),transparent_28%),radial-gradient(circle_at_85%_85%,rgba(148,163,184,.08),transparent_28%)]" />
          <div className="relative z-10">
            <img src="/ira-hospitality-logo.png" alt="IRA Hospitality" className="w-[175px] sm:w-[205px] md:w-[215px] h-auto object-contain" />
            <div className="mt-6 text-[11px] uppercase tracking-[0.32em] text-slate-300 font-semibold">Workforce portal</div>
          </div>
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-200">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              {isEmployee ? 'Employee portal' : 'Admin portal'}
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-400 max-w-sm">Attendance, leave, assignments and payroll in one place.</p>
          </div>
        </aside>

        <section className="md:col-span-7 px-6 py-8 sm:px-10 md:px-12 lg:px-16 flex items-center">
          <div className="w-full max-w-[520px] mx-auto">
            <div className="flex items-start justify-between gap-6 mb-8">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-600">{isEmployee ? 'Employee sign in' : 'Admin sign in'}</p>
                <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-slate-950">Welcome back</h1>
                <p className="mt-3 text-sm text-slate-500">{isEmployee ? 'Use the Login ID created by your administrator.' : 'Use your administrator credentials.'}</p>
              </div>
              <div className="shrink-0 flex items-center gap-1 p-1 rounded-2xl border border-slate-200 bg-slate-50">
                <button type="button" onClick={() => switchPortal('employee')} className={`w-10 h-10 rounded-xl flex items-center justify-center ${isEmployee ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-400'}`} aria-label="Employee portal"><UserRound className="w-5 h-5" /></button>
                <button type="button" onClick={() => switchPortal('admin')} className={`w-10 h-10 rounded-xl flex items-center justify-center ${!isEmployee ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-400'}`} aria-label="Admin portal"><ShieldCheck className="w-5 h-5" /></button>
              </div>
            </div>

            {error && <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div>}

            <form onSubmit={submit} className="space-y-5">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">{isEmployee ? 'Login ID' : 'Admin ID'}</span>
                <div className="relative mt-2">
                  <UserRound className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input value={identifier} onChange={e => setIdentifier(e.target.value)} autoComplete="username" placeholder={isEmployee ? 'Enter Login ID' : 'Enter Admin ID'} className="w-full rounded-2xl border border-slate-300 bg-white pl-12 pr-4 py-4 text-[15px] outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </div>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Password</span>
                <div className="relative mt-2">
                  <LockKeyhole className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input value={password} onChange={e => setPassword(e.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" className="w-full rounded-2xl border border-slate-300 bg-white pl-12 pr-12 py-4 text-[15px] outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </label>

              <button disabled={loading} className="btn-login w-full min-h-14 rounded-2xl text-white font-bold flex items-center justify-center gap-2 shadow-[0_12px_30px_rgba(15,23,42,.14)]">
                {loading ? 'Signing in…' : 'Sign in'} {!loading && <ArrowRight className="w-5 h-5" />}
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
};

export const EmployeeLoginScreen = () => <PortalLoginScreen portal="employee" />;
export const AdminLoginScreen = () => <PortalLoginScreen portal="admin" />;
