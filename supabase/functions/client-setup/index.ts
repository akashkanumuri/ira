import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin === 'https://ira-eta-two.vercel.app') return origin;
  if (/^https:\/\/ira-[a-z0-9-]+-satisfyinginventior-1459s-projects\.vercel\.app$/i.test(origin)) return origin;
  if (/^https:\/\/ira-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(origin)) return origin;
  return null;
}

function corsHeaders(origin: string | null) {
  const allowed = allowedOrigin(origin);
  return {
    ...BASE_CORS_HEADERS,
    ...(allowed ? { 'Access-Control-Allow-Origin': allowed, Vary: 'Origin' } : {}),
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validatePassword(password: string): boolean {
  return (
    password.length >= 12 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export async function isLeakedPassword(password: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: {
      'User-Agent': 'IRA-Hospitality-Client-Setup/1.0',
      'Add-Padding': 'true',
    },
  });

  if (!response.ok) return false; // If breach check is temporarily unreachable, do not block setup
  const body = await response.text();
  return body.split(/\r?\n/).some(line => line.split(':', 1)[0].trim().toUpperCase() === suffix);
}

export async function assertPasswordSafe(password: string) {
  if (!validatePassword(password)) {
    throw new Error('Password must be at least 12 characters and include uppercase, lowercase, number, and a symbol.');
  }
  if (await isLeakedPassword(password)) {
    throw new Error('Please choose a different password. This password has appeared in known security breaches.');
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server configuration error.' }, 500, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json();
    const action = body.action;
    const rawToken = typeof body.token === 'string' ? body.token.trim() : '';

    if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
      return json({ error: 'Invalid invitation token format.' }, 400, origin);
    }

    const tokenHash = await sha256Hex(rawToken);
    const nowIso = new Date().toISOString();

    if (action === 'verify_token') {
      const { data: invite, error: inviteError } = await admin
        .from('client_invitations')
        .select('id, client_id, email, expires_at, used_at')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      if (inviteError || !invite) {
        return json({ valid: false, error: 'Invitation link not found or invalid.' }, 400, origin);
      }

      if (invite.used_at) {
        return json({ valid: false, error: 'This invitation has already been redeemed.' }, 400, origin);
      }

      if (new Date(invite.expires_at).getTime() <= Date.now()) {
        return json({ valid: false, error: 'This invitation link has expired. Please contact the administrator.' }, 400, origin);
      }

      // Lookup company name and primary contact
      const { data: client } = await admin
        .from('clients')
        .select('company_name, primary_contact, email')
        .eq('profile_id', invite.client_id)
        .maybeSingle();

      return json({
        valid: true,
        email: client?.email ?? invite.email,
        companyName: client?.company_name ?? 'Client Account',
        primaryContact: client?.primary_contact ?? '',
      }, 200, origin);
    }

    if (action === 'complete_setup') {
      const password = typeof body.password === 'string' ? body.password : '';
      
      // 1. Validate password safety up front before any database operations
      await assertPasswordSafe(password);

      // 2. Concurrency-safe atomic reservation:
      // Exactly one concurrent call can successfully update used_at from null
      const { data: updated, error: updateError } = await admin
        .from('client_invitations')
        .update({ used_at: nowIso })
        .eq('token_hash', tokenHash)
        .is('used_at', null)
        .gt('expires_at', nowIso)
        .select('id, client_id, email')
        .maybeSingle();

      if (updateError || !updated) {
        // Check state to deliver an informative error message without leaking sensitive internal details
        const { data: existing } = await admin
          .from('client_invitations')
          .select('id, used_at, expires_at')
          .eq('token_hash', tokenHash)
          .maybeSingle();

        if (existing?.used_at) {
          return json(
            { error: 'This invitation has already been redeemed. Please sign in.' },
            400,
            origin,
          );
        }
        if (existing && new Date(existing.expires_at).getTime() <= Date.now()) {
          return json(
            { error: 'This invitation link has expired. Please contact the administrator.' },
            400,
            origin,
          );
        }

        return json(
          { error: 'This invitation is invalid, has expired, or has already been used.' },
          400,
          origin,
        );
      }

      // 3. Update Supabase Auth user password and confirm email
      const { error: authError } = await admin.auth.admin.updateUserById(updated.client_id, {
        password,
        email_confirm: true,
      });

      if (authError) {
        console.error('[client-setup] Auth password update failed:', authError.message);
        // Rollback token reservation to allow user retry
        const { error: rollbackError } = await admin
          .from('client_invitations')
          .update({ used_at: null })
          .eq('id', updated.id);

        if (rollbackError) {
          console.error('[client-setup] Failed to roll back token reservation:', rollbackError.message);
        }

        return json(
          { error: `Unable to set account credentials: ${authError.message}` },
          400,
          origin,
        );
      }

      // 4. Mark client record active with retry logic (up to 3 attempts)
      let clientActivated = false;
      let lastClientError: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const { error: clientUpdateError } = await admin
          .from('clients')
          .update({ status: 'active', updated_at: nowIso })
          .eq('profile_id', updated.client_id);

        if (!clientUpdateError) {
          clientActivated = true;
          break;
        }

        lastClientError = clientUpdateError;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
        }
      }

      if (!clientActivated) {
        console.error('[client-setup] Client status sync delayed after retries:', lastClientError?.message);
        // Do not falsely report failure: password was set and user can log in.
        return json({
          success: true,
          message: 'Password set successfully. You can now sign in with your email and password.',
          warning: 'Account status synchronization encountered a brief delay.',
        }, 200, origin);
      }

      return json({ success: true, message: 'Password set successfully.' }, 200, origin);
    }

    return json({ error: 'Unsupported action.' }, 400, origin);
  } catch (error) {
    console.error('[client-setup] Error:', error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : 'Request failed.' }, 400, origin);
  }
});
