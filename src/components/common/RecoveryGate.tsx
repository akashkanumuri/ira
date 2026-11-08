import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { supabase, recoveryLinkState } from '../../lib/supabase';
import { Button, Notice } from '../../ui';
import { PasswordField } from '../../ui/PasswordField';
import { notify } from '../../lib/toast';
import { PASSWORD_RULES as RULES, isLeakedPassword as isLeaked } from '../../lib/passwordSafety';

function clearUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('set-password');
    url.hash = '';
    window.history.replaceState(null, '', url.pathname + url.search);
  } catch { /* nothing to clean */ }
}

/**
 * Opened from a one-time reset link: the person must choose a new password before using SIGMA.
 * No password is ever sent or shown to anyone; Supabase stores only its hash.
 */
export function RecoveryGate() {
  const [state, setState] = useState<'ok' | 'expired' | null>(recoveryLinkState);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') setState('ok'); });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!state) return null;

  const valid = RULES.every(([, ok]) => ok(password)) && password === confirm;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true); setError('');
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { setState('expired'); return; }
      if (await isLeaked(password)) { setError('This password has appeared in a data breach. Choose a different one.'); return; }
      const { error: e } = await supabase.auth.updateUser({ password });
      if (e) { setError(e.message); return; }
      clearUrl();
      setState(null);
      notify('Password updated. You’re signed in.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-ink-950/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl p-6 sm:p-7">
        <span className="grid place-items-center w-11 h-11 rounded-2xl bg-primary/10 text-primary"><KeyRound size={20} /></span>
        {state === 'expired' ? (
          <>
            <h1 id="recovery-title" className="mt-4 font-display text-[22px] font-bold text-ink-950">This link has expired</h1>
            <p className="mt-2 text-[14px] text-ink-600">Reset links work once and only for a short time. Ask your admin for a new one.</p>
            <div className="mt-6 flex justify-end"><Button onClick={() => { clearUrl(); setState(null); }}>Back to sign in</Button></div>
          </>
        ) : (
          <>
            <h1 id="recovery-title" className="mt-4 font-display text-[22px] font-bold text-ink-950">Choose a new password</h1>
            <p className="mt-1 text-[13.5px] text-ink-600">You’ll use it to sign in to SIGMA 1 from now on.</p>
            <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <label className="block"><span className="label">New password</span>
                <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus /></label>
              <label className="block"><span className="label">Confirm password</span>
                <PasswordField value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></label>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                {RULES.map(([t, ok]) => <li key={t} className={ok(password) ? 'text-mint-700' : 'text-ink-400'}>{ok(password) ? '✓' : '○'} {t}</li>)}
                {confirm && <li className={confirm === password ? 'text-mint-700' : 'text-rose-600'}>{confirm === password ? '✓ match' : '✗ don’t match'}</li>}
              </ul>
              {error && <Notice tone="rose">{error}</Notice>}
              <p className="flex items-center gap-1.5 text-[12px] text-ink-500"><ShieldCheck className="w-3.5 h-3.5" />Passwords found in known data breaches are refused.</p>
              <div className="pt-2 flex justify-end"><Button type="submit" disabled={!valid || busy} loading={busy}>Save password</Button></div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
