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
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-5xl bg-white rounded-[26px] sm:rounded-[28px] border border-slate-200 shadow-[0_28px_80px_rgba(15,23,42,0.16)] overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-0 lg:min-h-[620px]">
        <div className="lg:col-span-5 bg-slate-950 text-white p-5 sm:p-7 lg:p-10 flex flex-row lg:flex-col items-center lg:items-start justify-between relative overflow-hidden min-h-[128px] sm:min-h-[150px] lg:min-h-[620px] gap-5">
          <div className="absolute inset-0 opacity-50 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:18px_18px]" />

          <div className="relative z-10 flex flex-col items-start gap-2 min-w-0">
            <img
              src="/ira-hospitality-logo.png"
              alt="IRA Hospitality"
              className="w-[118px] sm:w-[155px] lg:w-[230px] h-auto object-contain object-left shrink-0"
            />
            <div className="text-[10px] sm:text-[11px] lg:text-xs uppercase tracking-[0.22em] font-semibold text-slate-300 pl-0.5">
              Attendance
            </div>
          </div>

          <div className="relative z-10 shrink-0">
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-slate-900 border border-slate-800 text-slate-300 text-[11px] font-semibold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {isEmployee ? 'Employee Portal' : 'Admin Portal'}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 p-5 sm:p-8 lg:p-10 flex items-center">
          <div className="w-full max-w-md mx-auto">
            <div className="flex items-start justify-between gap-4 mb-7 sm:mb-8">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">
                  {isEmployee ? 'Employee sign in' : 'Admin sign in'}
                </p>
                <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Welcome back</h2>
                <p className="mt-2 text-sm sm:text-base text-slate-500 max-w-sm">
                  {isEmployee ? 'Enter your employee name and password.' : 'Enter the administrator credentials.'}
                </p>
              </div>

              <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-1 flex items-center gap-1" aria-label="Switch login portal">
                <button
                  type="button"
                  onClick={() => switchPortal('employee')}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${isEmployee ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-700'}`}
                  aria-label="Employee login"
                  title="Employee login"
                >
                  <UserRound className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => switchPortal('admin')}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${!isEmployee ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-700'}`}
                  aria-label="Admin login"
                  title="Admin login"
                >
                  <ShieldCheck className="w-4 h-4" />
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {isEmployee ? 'Employee Name' : 'Admin ID'}
                </label>
                <div className="relative">
                  <UserRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" />
                  <input
                    value={identifier}
                    onChange={(e) => { setIdentifier(e.target.value); if (error) setError(null); }}
                    type="text"
                    autoComplete="username"
                    placeholder={isEmployee ? 'Enter your full name' : 'Enter admin ID'}
                    className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 py-3.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 min-h-12"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-11 py-3.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 min-h-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-slate-950 hover:bg-slate-800 disabled:bg-slate-300 text-white py-3.5 font-bold text-sm flex items-center justify-center gap-2 transition-colors min-h-12"
              >
                {loading ? 'Signing in…' : 'Sign in'}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export const EmployeeLoginScreen = () => <PortalLoginScreen portal="employee" />;
export const AdminLoginScreen = () => <PortalLoginScreen portal="admin" />;
