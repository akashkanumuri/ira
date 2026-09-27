import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck, UserRound } from 'lucide-react';

type Portal = 'employee' | 'admin';

interface PortalLoginScreenProps {
  portal?: Portal;
}

export const PortalLoginScreen: React.FC<PortalLoginScreenProps> = ({ portal = 'employee' }) => {
  const { signIn } = useAuth();
  const [activePortal, setActivePortal] = useState<Portal>(portal);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmployee = activePortal === 'employee';

  useEffect(() => {
    setActivePortal(portal);
    setError(null);
    setIdentifier('');
    setPassword('');
  }, [portal]);

  const switchPortal = (next: Portal) => {
    if (next === activePortal) return;
    setActivePortal(next);
    setIdentifier('');
    setPassword('');
    setError(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', next === 'admin' ? '/admin/login' : '/login');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!identifier.trim() || !password) {
      setError(isEmployee ? 'Enter your employee name and password.' : 'Enter your admin ID and password.');
      return;
    }

    setLoading(true);
    const result = await signIn(identifier, password, activePortal);
    if (result.error) setError(result.error);
    setLoading(false);
  };

  return (
    <div className="min-h-[100dvh] bg-[#EEF2F6] flex items-center justify-center p-0 sm:p-4 lg:p-6">
      <div className="w-full max-w-[1180px] min-h-[100dvh] sm:min-h-0 md:min-h-[680px] lg:min-h-[700px] bg-white overflow-hidden rounded-none sm:rounded-[30px] border border-slate-200 shadow-[0_30px_90px_rgba(15,23,42,0.14)] grid grid-cols-1 md:grid-cols-12">
        <section className="md:col-span-5 relative overflow-hidden bg-[#030817] text-white px-6 py-7 sm:px-8 sm:py-8 md:px-9 md:py-9 lg:px-10 lg:py-10 min-h-[285px] sm:min-h-[315px] md:min-h-[680px] lg:min-h-[700px] flex flex-col justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(148,163,184,0.08),transparent_28%),radial-gradient(circle_at_85%_80%,rgba(59,130,246,0.09),transparent_30%)]" />
          <div className="absolute inset-0 opacity-45 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:18px_18px]" />

          <div className="relative z-10 flex flex-col items-center text-center md:items-start md:text-left">
            <img
              src="/ira-hospitality-logo.png"
              alt="IRA Hospitality"
              className="w-[155px] sm:w-[175px] md:w-[185px] lg:w-[215px] h-auto object-contain"
            />

            <div className="mt-7 sm:mt-8 md:mt-9 text-[11px] sm:text-xs uppercase tracking-[0.32em] font-semibold text-slate-300">
              Attendance
            </div>

            <div className="mt-4 h-px w-14 bg-slate-700/70 md:w-20" />
          </div>

          <div className="relative z-10 flex justify-center md:justify-start pt-8">
            <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-slate-900/80 border border-slate-800/90 text-slate-200 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.12em] shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.65)]" />
              {isEmployee ? 'Employee Portal' : 'Admin Portal'}
            </div>
          </div>
        </section>

        <section className="md:col-span-7 bg-white px-5 py-7 sm:px-8 sm:py-9 md:px-10 lg:px-14 xl:px-16 flex items-center">
          <div className="w-full max-w-[530px] mx-auto">
            <div className="flex items-start justify-between gap-4 mb-8 sm:mb-9">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-600">
                  {isEmployee ? 'Employee sign in' : 'Admin sign in'}
                </p>
                <h2 className="mt-2 text-[30px] sm:text-[34px] md:text-[38px] leading-tight font-bold tracking-[-0.025em] text-slate-950">
                  Welcome back
                </h2>
                <p className="mt-3 text-sm sm:text-base text-slate-500 leading-6 max-w-[430px]">
                  {isEmployee ? 'Enter your employee name and password.' : 'Enter the administrator credentials.'}
                </p>
              </div>

              <div className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 flex items-center gap-1 shadow-sm" aria-label="Switch login portal">
                <button
                  type="button"
                  onClick={() => switchPortal('employee')}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isEmployee ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-700'}`}
                  aria-label="Employee login"
                  title="Employee login"
                >
                  <UserRound className="w-[18px] h-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={() => switchPortal('admin')}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${!isEmployee ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-700'}`}
                  aria-label="Admin login"
                  title="Admin login"
                >
                  <ShieldCheck className="w-[18px] h-[18px]" />
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-800" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-2">
                  {isEmployee ? 'Employee Name' : 'Admin ID'}
                </label>
                <div className="relative">
                  <UserRound className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 z-10" />
                  <input
                    value={identifier}
                    onChange={(e) => { setIdentifier(e.target.value); if (error) setError(null); }}
                    type="text"
                    autoComplete="username"
                    placeholder={isEmployee ? 'Enter your full name' : 'Enter admin ID'}
                    className="w-full rounded-2xl border border-slate-300 bg-white pl-12 pr-4 py-4 text-[15px] text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 min-h-14"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="w-full rounded-2xl border border-slate-300 bg-white pl-12 pr-12 py-4 text-[15px] text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 min-h-14"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-slate-950 hover:bg-slate-800 active:bg-slate-900 disabled:bg-slate-300 text-white py-4 font-bold text-[15px] flex items-center justify-center gap-2 transition-all shadow-[0_10px_28px_rgba(15,23,42,0.14)] hover:shadow-[0_14px_32px_rgba(15,23,42,0.18)] min-h-14"
              >
                {loading ? 'Signing in…' : 'Sign in'}
                {!loading && <ArrowRight className="w-5 h-5" />}
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
};

export const EmployeeLoginScreen = () => <PortalLoginScreen portal="employee" />;
export const AdminLoginScreen = () => <PortalLoginScreen portal="admin" />;
