import { createClient } from '@supabase/supabase-js';

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : ({} as Record<string, any>);
const supabaseUrl = env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey =
  (env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (env.VITE_SUPABASE_ANON_KEY as string | undefined);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

/**
 * Read before the client below consumes the URL: did this page open from a one-time password reset link?
 * 'ok' = link accepted (Supabase signs the person in and we ask for a new password); 'expired' = link used or too old.
 */
export const recoveryLinkState: 'ok' | 'expired' | null = (() => {
  if (typeof window === 'undefined') return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  if (hash.get('type') === 'recovery') return 'ok';
  if (query.get('set-password') === '1') return hash.get('error') || query.get('error') ? 'expired' : 'ok';
  return null;
})();


export const supabase = createClient(
  supabaseUrl || 'https://example.supabase.co',
  supabasePublishableKey || 'sb_publishable_invalid',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
