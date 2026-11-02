import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

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

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const APP_BASE_URL = (Deno.env.get('APP_BASE_URL')?.trim() || 'https://ira-eta-two.vercel.app').replace(/\/+$/, '');
const RESET_MINUTES = 60;          // self-service reset links are short-lived
const RESET_LIMIT_PER_HOUR = 3;    // per person, so the form can't be used to flood an inbox

// ── Email: Gmail (SMTP over SSL, port 465 — Supabase blocks 25/587) or Resend, whichever is configured ──
const GMAIL_PASSWORD = () => Deno.env.get('GMAIL_APP_PASSWORD')?.replace(/\s+/g, '') || '';
const GMAIL_USER = () => Deno.env.get('GMAIL_USER')?.trim() || 'info.irahospitality@gmail.com';
const MAIL_FROM_NAME = () => Deno.env.get('MAIL_FROM_NAME')?.trim() || 'IRA Hospitality';
function mailProvider(): 'gmail' | 'resend' | null {
  if (GMAIL_PASSWORD()) return 'gmail';
  if (Deno.env.get('RESEND_API_KEY')?.trim() && Deno.env.get('RESEND_FROM_EMAIL')?.trim()) return 'resend';
  return null;
}
async function sendMail(m: { to: string; subject: string; html: string; text: string }): Promise<{ sent: boolean; id?: string | null; error?: string }> {
  const provider = mailProvider();
  try {
    if (provider === 'gmail') {
      const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER(), pass: GMAIL_PASSWORD() } });
      const info = await transport.sendMail({ from: `"${MAIL_FROM_NAME()}" <${GMAIL_USER()}>`, replyTo: GMAIL_USER(), to: m.to, subject: m.subject, html: m.html, text: m.text });
      return { sent: true, id: info?.messageId ?? null };
    }
    if (provider === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')!.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: Deno.env.get('RESEND_FROM_EMAIL')!.trim(), to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      });
      if (!res.ok) return { sent: false, error: `Email provider error: HTTP ${res.status}` };
      const data = await res.json().catch(() => null);
      return { sent: true, id: data?.id ?? null };
    }
    return { sent: false, error: 'Email isn’t set up.' };
  } catch (e) {
    // never log the link or the password
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[mail] send failed:', msg.replace(/[0-9a-f]{64}/gi, '…'));
    return { sent: false, error: `Email could not be sent: ${msg}` };
  }
}

/** Is automated email set up at all? (Same answer for every address, so it reveals nothing about accounts.) */
function emailConfigured(): boolean {
  return mailProvider() !== null;
}

async function sendResetEmail(toEmail: string, name: string, companyName: string, url: string): Promise<boolean> {
  const support = Deno.env.get('SUPPORT_EMAIL')?.trim() || GMAIL_USER();
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Reset your password</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:20px;border:1px solid #e2e8f0;overflow:hidden;">
<tr><td style="background:#0f172a;padding:28px 36px;"><span style="font-size:18px;font-weight:800;letter-spacing:2px;color:#fff;">IRA HOSPITALITY</span><br><span style="font-size:11px;letter-spacing:1px;color:#94a3b8;text-transform:uppercase;">Client Portal</span></td></tr>
<tr><td style="padding:36px;">
<h1 style="font-size:20px;color:#0f172a;margin:0 0 14px;">Reset your password</h1>
<p style="font-size:15px;color:#334155;line-height:1.6;margin:0 0 8px;">Hello ${escapeHtml(name)},</p>
<p style="font-size:15px;color:#334155;line-height:1.6;margin:0 0 24px;">We received a request to reset the password for your <strong>${escapeHtml(companyName)}</strong> client portal account. Choose a new password with the button below.</p>
<p style="text-align:center;margin:28px 0;"><a href="${url}" style="display:inline-block;background:#5b35e8;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:12px;">Choose a new password</a></p>
<p style="font-size:12px;color:#475569;line-height:1.5;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;">This link works once and expires in ${RESET_MINUTES} minutes. If you didn’t ask for a reset, you can ignore this email — your password stays the same.</p>
<p style="font-size:12px;color:#64748b;margin:22px 0 0;">If the button doesn’t work, copy this link into your browser:</p>
<p style="font-size:11px;word-break:break-all;color:#5b35e8;margin:6px 0 0;font-family:Menlo,Consolas,monospace;">${url}</p>
</td></tr>
<tr><td style="background:#f8fafc;padding:20px 36px;text-align:center;font-size:12px;color:#64748b;">Need help? Email <a href="mailto:${escapeHtml(support)}" style="color:#5b35e8;text-decoration:none;">${escapeHtml(support)}</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = `Reset your IRA client portal password\n\nHello ${name},\n\nWe received a request to reset the password for your ${companyName} client portal account. Open this link to choose a new password:\n${url}\n\nThe link works once and expires in ${RESET_MINUTES} minutes. If you didn't ask for a reset, ignore this email.\n\nNeed help? ${support}`;
  const r = await sendMail({ to: toEmail, subject: 'Reset your IRA client portal password', html, text });
  return r.sent;
}

/**
 * "Forgot password" for client portal users. Always answers the same way whether or not the address has an account
 * (no account discovery). Creates a single-use link (60 min) and emails it.
 */
async function requestReset(admin: ReturnType<typeof createClient>, rawEmail: unknown) {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const configured = emailConfigured();
  const answer = { success: true, emailConfigured: configured };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !configured) return answer;

  const { data: member } = await admin
    .from('client_users')
    .select('profile_id, status, full_name, email, clients:client_id (company_name, status, deleted_at)')
    .eq('email', email)
    .maybeSingle();
  const org = (member as any)?.clients;
  if (!member || member.status === 'inactive' || !org || org.deleted_at || org.status === 'inactive') return answer;

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin
    .from('client_invitations')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', member.profile_id)
    .is('created_by', null)
    .gte('created_at', since);
  if ((count ?? 0) >= RESET_LIMIT_PER_HOUR) return answer;

  const rawToken = generateSecureToken();
  const { error } = await admin.from('client_invitations').insert({
    client_id: member.profile_id,
    email: member.email,
    token_hash: await sha256Hex(rawToken),
    expires_at: new Date(Date.now() + RESET_MINUTES * 60_000).toISOString(),
    created_by: null, // self-service
  });
  if (error) { console.error('[client-setup] reset token insert failed:', error.message); return answer; }
  await sendResetEmail(member.email, member.full_name || member.email, org.company_name || 'your organisation', `${APP_BASE_URL}/client/setup?token=${rawToken}`);
  return answer;
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
    if (action === 'request_reset') return json(await requestReset(admin, body.email), 200, origin);
    const rawToken = typeof body.token === 'string' ? body.token.trim() : '';

    if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
      return json({ error: 'This link isn’t valid. Use the latest link you received, or ask for a new one.' }, 400, origin);
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
        return json({ valid: false, error: 'This link isn’t valid. Use the latest link you received, or ask for a new one.' }, 400, origin);
      }

      if (invite.used_at) {
        return json({ valid: false, error: 'This link has already been used. Sign in, or ask for a new link.' }, 400, origin);
      }

      if (new Date(invite.expires_at).getTime() <= Date.now()) {
        return json({ valid: false, error: 'This link has expired. Ask for a new one from the sign-in page, or contact your IRA account manager.' }, 400, origin);
      }

      // Lookup company name and contact: the primary client account, or a colleague added later.
      const { data: client } = await admin
        .from('clients')
        .select('company_name, primary_contact, email')
        .eq('profile_id', invite.client_id)
        .maybeSingle();
      let colleague: { full_name: string | null; email: string; clients: { company_name: string } | null } | null = null;
      if (!client) {
        const { data } = await admin
          .from('client_users')
          .select('full_name, email, clients:client_id (company_name)')
          .eq('profile_id', invite.client_id)
          .maybeSingle();
        colleague = data as any;
      }

      // An account that already has a password → this link resets it; otherwise it is the first-time setup.
      const { data: member } = await admin.from('client_users').select('status').eq('profile_id', invite.client_id).maybeSingle();
      const mode = member?.status === 'active' ? 'reset' : 'setup';

      return json({
        valid: true,
        mode,
        email: client?.email ?? colleague?.email ?? invite.email,
        companyName: client?.company_name ?? colleague?.clients?.company_name ?? 'Client Account',
        primaryContact: client?.primary_contact ?? colleague?.full_name ?? '',
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

      // 3. Update Supabase Auth user password, confirm email, and set app_metadata role
      const { error: authError } = await admin.auth.admin.updateUserById(updated.client_id, {
        password,
        email_confirm: true,
        app_metadata: {
          role: 'client',
        },
      });

      // Ensure profile role is client in public.profiles
      await admin
        .from('profiles')
        .upsert({ id: updated.client_id, role: 'client' });

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

      // Any other open link for this person (older invite / reset) stops working now.
      await admin.from('client_invitations').update({ used_at: nowIso }).eq('client_id', updated.client_id).is('used_at', null);

      // 4a. A colleague added by their organisation: activate their portal membership.
      const { error: memberError } = await admin
        .from('client_users')
        .update({ status: 'active', updated_at: nowIso })
        .eq('profile_id', updated.client_id)
        .eq('status', 'invited');
      if (memberError) console.error('[client-setup] Client user activation delayed:', memberError.message);

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
