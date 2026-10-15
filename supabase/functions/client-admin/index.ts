import { createSupabaseContext } from 'npm:@supabase/server';
import { createClient } from 'npm:@supabase/supabase-js@2';

interface CreateClientInput {
  action: 'create_client';
  companyName: string;
  primaryContact: string;
  email: string;
  managerId?: string | null;
  projectName: string;
  projectDescription?: string | null;
}

interface ResendInvitationInput {
  action: 'resend_invitation';
  clientId: string;
}

type Input = CreateClientInput | ResendInvitationInput;

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_APP_BASE_URL = 'https://ira-eta-two.vercel.app';

export function getTrustedBaseUrl(): string {
  const envUrl = (
    typeof Deno !== 'undefined'
      ? Deno.env.get('APP_BASE_URL')
      : typeof process !== 'undefined'
      ? process.env.APP_BASE_URL
      : null
  )?.trim();

  const candidate = envUrl || DEFAULT_APP_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid APP_BASE_URL: "${candidate}" is not a valid URL.`);
  }

  // Enforce HTTPS in production. Allow HTTP ONLY on localhost or 127.0.0.1 for local testing.
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && (!isLocalhost || parsed.protocol !== 'http:')) {
    throw new Error(
      `Invalid APP_BASE_URL protocol: "${parsed.protocol}". Only HTTPS is allowed (HTTP allowed only for localhost).`
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error('Invalid APP_BASE_URL: Credentials are not permitted in base URL.');
  }

  // Disallow invalid characters/trailing slashes
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
}

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

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildInvitationEmailHtml(params: {
  companyName: string;
  primaryContact: string;
  invitationUrl: string;
  supportEmail: string;
}): string {
  const safeContact = escapeHtml(params.primaryContact);
  const safeCompany = escapeHtml(params.companyName);
  const safeSupport = escapeHtml(params.supportEmail);
  const safeUrl = params.invitationUrl;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Set up your IRA Hospitality Client Portal account</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #090d16 0%, #1e293b 100%); padding: 36px 40px; text-align: left;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 800; letter-spacing: 2px; color: #ffffff; display: block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                      IRA HOSPITALITY
                    </span>
                    <span style="font-size: 11px; font-weight: 600; letter-spacing: 1px; color: #94a3b8; text-transform: uppercase; margin-top: 4px; display: block;">
                      Client Portal
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 40px 32px 40px;">
              <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 16px 0; line-height: 1.3;">
                Welcome, ${safeContact}
              </h1>

              <p style="font-size: 15px; color: #334155; line-height: 1.6; margin: 0 0 16px 0;">
                An account has been created for <strong>${safeCompany}</strong> on the IRA Hospitality Client Portal.
              </p>

              <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 28px 0;">
                Through your dedicated portal, you can monitor architectural project milestones, view active deliverables, and stay synchronized with your project managers.
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 32px 0;">
                <tr>
                  <td align="center">
                    <a href="${safeUrl}" target="_blank" style="display: inline-block; background-color: #0044ff; color: #ffffff !important; font-size: 14px; font-weight: 700; text-decoration: none; padding: 15px 32px; border-radius: 12px; box-shadow: 0 4px 14px rgba(0, 68, 255, 0.35); text-align: center;">
                      Set Up Password & Access Portal
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Expiration & Security Notice Box -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin-top: 24px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <p style="font-size: 12px; color: #475569; margin: 0; line-height: 1.5;">
                      <strong style="color: #0f172a;">Security Notice:</strong> This invitation is single-use and will expire in <strong>72 hours</strong>. You will be prompted to create your own secure password upon opening the link.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Fallback Plain Link -->
              <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 28px 0 0 0;">
                If the button above does not work, copy and paste the following link into your web browser:
              </p>
              <p style="font-size: 11px; word-break: break-all; color: #0044ff; margin: 6px 0 0 0; font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
                ${safeUrl}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 24px 40px; text-align: center;">
              <p style="font-size: 12px; color: #64748b; margin: 0 0 8px 0; line-height: 1.5;">
                Need help or have questions? Contact your assigned project manager or email our team at
                <a href="mailto:${safeSupport}" style="color: #0044ff; text-decoration: none; font-weight: 500;">${safeSupport}</a>.
              </p>
              <p style="font-size: 11px; color: #94a3b8; margin: 8px 0 0 0;">
                © ${new Date().getFullYear()} IRA Hospitality & Architecture. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildInvitationEmailText(params: {
  companyName: string;
  primaryContact: string;
  invitationUrl: string;
  supportEmail: string;
}): string {
  return `IRA HOSPITALITY - CLIENT PORTAL INVITATION

Hello ${params.primaryContact},

An account has been created for ${params.companyName} on the IRA Hospitality Client Portal.

Through your dedicated portal, you can monitor architectural project milestones, view active deliverables, and stay synchronized with your project managers.

Please set up your account password by visiting the link below:
${params.invitationUrl}

SECURITY NOTICE:
This invitation link is single-use and expires in 72 hours. You will choose your own secure password upon clicking the link.

Need help or have questions?
Contact your assigned project manager or email: ${params.supportEmail}

(c) ${new Date().getFullYear()} IRA Hospitality & Architecture. All rights reserved.`;
}

export interface SendInvitationEmailParams {
  toEmail: string;
  companyName: string;
  primaryContact: string;
  invitationUrl: string;
  resendApiKey?: string | null;
  resendFromEmail?: string | null;
  supportEmail?: string | null;
  fetchFn?: typeof fetch;
}

export interface EmailDeliveryResult {
  attempted: boolean;
  sent: boolean;
  id?: string | null;
  error?: string | null;
  reason?: string | null;
}

export async function sendInvitationEmail(
  params: SendInvitationEmailParams
): Promise<EmailDeliveryResult> {
  const apiKey = params.resendApiKey ?? (
    typeof Deno !== 'undefined'
      ? Deno.env.get('RESEND_API_KEY')
      : typeof process !== 'undefined'
      ? process.env.RESEND_API_KEY
      : null
  )?.trim();

  const fromEmail = params.resendFromEmail ?? (
    typeof Deno !== 'undefined'
      ? Deno.env.get('RESEND_FROM_EMAIL')
      : typeof process !== 'undefined'
      ? process.env.RESEND_FROM_EMAIL
      : null
  )?.trim();

  const supportEmail = params.supportEmail ?? (
    (typeof Deno !== 'undefined'
      ? Deno.env.get('SUPPORT_EMAIL')
      : typeof process !== 'undefined'
      ? process.env.SUPPORT_EMAIL
      : null)?.trim() || 'support@iragroup.in'
  );

  // Rule 3: If sender configuration or API key is missing, fail safely and preserve manual link workflow.
  if (!apiKey) {
    return {
      attempted: false,
      sent: false,
      reason: 'Automated email delivery not configured: RESEND_API_KEY is not set.',
    };
  }

  if (!fromEmail) {
    return {
      attempted: false,
      sent: false,
      reason: 'Automated email delivery not configured: RESEND_FROM_EMAIL is not set.',
    };
  }

  const html = buildInvitationEmailHtml({
    companyName: params.companyName,
    primaryContact: params.primaryContact,
    invitationUrl: params.invitationUrl,
    supportEmail,
  });

  const text = buildInvitationEmailText({
    companyName: params.companyName,
    primaryContact: params.primaryContact,
    invitationUrl: params.invitationUrl,
    supportEmail,
  });

  const fetchImpl = params.fetchFn ?? fetch;

  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'IRA-Hospitality-Client-Admin/1.0',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [params.toEmail],
        subject: `Welcome to IRA Hospitality — Client Portal Setup for ${params.companyName}`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      let errorDetail = `HTTP ${res.status}`;
      try {
        const errorJson = await res.json();
        if (errorJson?.message) errorDetail = errorJson.message;
        else if (errorJson?.error) errorDetail = String(errorJson.error);
      } catch {
        if (res.statusText) errorDetail = `${res.status} ${res.statusText}`;
      }

      // Rule 5: Never log raw tokens or token-bearing URLs
      console.error(`[client-admin] Resend email delivery failed for recipient: ${errorDetail}`);
      return {
        attempted: true,
        sent: false,
        error: `Email provider error: ${errorDetail}`,
      };
    }

    const data = await res.json();
    // Rule 5: Never log raw tokens or token-bearing URLs
    console.log(`[client-admin] Resend invitation email dispatched successfully (id: ${data?.id})`);
    return {
      attempted: true,
      sent: true,
      id: data?.id ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[client-admin] Resend dispatch network error: ${message}`);
    return {
      attempted: true,
      sent: false,
      error: `Network error sending email: ${message}`,
    };
  }
}

async function createClientAccount(
  input: CreateClientInput,
  admin: ReturnType<typeof createClient>,
  actorId: string,
) {
  const companyName = input.companyName?.trim();
  const primaryContact = input.primaryContact?.trim();
  const email = input.email?.trim().toLowerCase();
  const projectName = input.projectName?.trim();
  const projectDescription = input.projectDescription?.trim() || null;
  const managerId = input.managerId?.trim() || null;

  if (!companyName) throw new Error('Company name is required.');
  if (!primaryContact) throw new Error('Primary contact name is required.');
  if (!email || !validateEmail(email)) throw new Error('A valid client email address is required.');
  if (!projectName) throw new Error('Initial project name is required.');

  // Validate configured base URL up front before allocating resources
  const trustedBaseUrl = getTrustedBaseUrl();

  // Verify email is not already registered in clients table
  const { data: existingClient, error: clientCheckError } = await admin
    .from('clients')
    .select('id, status')
    .eq('email', email)
    .maybeSingle();

  if (clientCheckError) throw new Error(`Database check failed: ${clientCheckError.message}`);
  if (existingClient) {
    if (existingClient.status === 'invited') {
      throw new Error('A client account with this email address already exists (pending setup). Please use "Resend Invitation" instead of creating a duplicate account.');
    }
    throw new Error('A client account with this email address already exists.');
  }

  // If a manager is assigned, verify active employee
  if (managerId) {
    const { data: manager, error: managerError } = await admin
      .from('employees')
      .select('id, name, status')
      .eq('id', managerId)
      .maybeSingle();

    if (managerError || !manager) throw new Error('Assigned manager not found.');
    if (manager.status !== 'active') throw new Error('Assigned manager account is inactive.');
  }

  // Generate high-entropy initial disabled password for auth user
  const initialTempSecret = 'IRA_CLIENT_' + crypto.randomUUID().replace(/-/g, '') + '!Aa9';

  // Create Auth User
  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password: initialTempSecret,
    email_confirm: false,
    user_metadata: {
      company_name: companyName,
      primary_contact: primaryContact,
      role: 'client',
    },
    app_metadata: {
      role: 'client',
    },
  });

  if (authError || !authUser.user) {
    throw new Error(authError?.message ?? 'Unable to create client authentication record.');
  }

  const userId = authUser.user.id;
  let createdClientId: string | null = null;
  let createdProjectId: string | null = null;

  try {
    // 1. Ensure profiles role is 'client' (upsert handles both immediate insert or post-trigger state)
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: userId, role: 'client' });

    if (profileError) throw profileError;

    // 2. Insert into clients
    const { data: clientRow, error: clientInsertError } = await admin
      .from('clients')
      .insert({
        profile_id: userId,
        company_name: companyName,
        primary_contact: primaryContact,
        email,
        status: 'invited',
      })
      .select('id')
      .single();

    if (clientInsertError || !clientRow) throw clientInsertError ?? new Error('Failed to create client record.');
    createdClientId = clientRow.id;

    // 3. Insert initial Project
    const { data: projectRow, error: projectInsertError } = await admin
      .from('projects')
      .insert({
        name: projectName,
        description: projectDescription,
        status: 'active',
        created_by: actorId,
      })
      .select('id')
      .single();

    if (projectInsertError || !projectRow) throw projectInsertError ?? new Error('Failed to create project record.');
    createdProjectId = projectRow.id;

    // 4. Link Project to Client
    const { error: projectClientError } = await admin
      .from('project_clients')
      .insert({
        project_id: createdProjectId,
        client_id: userId,
      });

    if (projectClientError) throw projectClientError;

    // 5. Link Project to Manager (if selected)
    if (managerId) {
      const { error: projectManagerError } = await admin
        .from('project_managers')
        .insert({
          project_id: createdProjectId,
          manager_id: managerId,
        });

      if (projectManagerError) throw projectManagerError;
    }

    // 6. Generate secure cryptographic invitation token (32 random bytes -> 64 hex chars)
    const rawToken = generateSecureToken();
    const tokenHash = await sha256Hex(rawToken);

    // 7. Store invitation token hash (72h expiry, single-use)
    const { error: inviteError } = await admin
      .from('client_invitations')
      .insert({
        client_id: userId,
        email,
        token_hash: tokenHash,
        created_by: actorId,
      });

    if (inviteError) throw inviteError;

    // Always use validated trusted base URL — NEVER use arbitrary request origin
    const invitationUrl = `${trustedBaseUrl}/client/setup?token=${rawToken}`;

    // 8. Attempt email delivery via Resend (fails safely if unconfigured, preserving setup link)
    const emailDelivery = await sendInvitationEmail({
      toEmail: email,
      companyName,
      primaryContact,
      invitationUrl,
    });

    return {
      success: true,
      clientId: createdClientId,
      projectId: createdProjectId,
      email,
      invitationUrl,
      emailDelivery,
    };
  } catch (error) {
    // Rollback created entities on failure
    try {
      if (createdProjectId) await admin.from('projects').delete().eq('id', createdProjectId);
      if (createdClientId) await admin.from('clients').delete().eq('id', createdClientId);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
    throw error;
  }
}

async function resendClientInvitation(
  input: ResendInvitationInput,
  admin: ReturnType<typeof createClient>,
  actorId: string,
) {
  const clientId = input.clientId?.trim();
  if (!clientId) throw new Error('Client ID is required.');

  // Find client record by profile_id
  const { data: client, error: clientError } = await admin
    .from('clients')
    .select('id, profile_id, company_name, primary_contact, email, status')
    .eq('profile_id', clientId)
    .maybeSingle();

  if (clientError || !client) throw new Error('Client account not found.');
  if (client.status === 'inactive') throw new Error('Cannot send invitation to an inactive client account.');

  const trustedBaseUrl = getTrustedBaseUrl();

  // Invalidate any existing unused invitation tokens for this client
  await admin
    .from('client_invitations')
    .update({ used_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .is('used_at', null);

  // Generate fresh secure invitation token
  const rawToken = generateSecureToken();
  const tokenHash = await sha256Hex(rawToken);

  const { error: inviteError } = await admin
    .from('client_invitations')
    .insert({
      client_id: clientId,
      email: client.email,
      token_hash: tokenHash,
      created_by: actorId,
    });

  if (inviteError) throw new Error(`Failed to generate new invitation: ${inviteError.message}`);

  const invitationUrl = `${trustedBaseUrl}/client/setup?token=${rawToken}`;

  const emailDelivery = await sendInvitationEmail({
    toEmail: client.email,
    companyName: client.company_name,
    primaryContact: client.primary_contact,
    invitationUrl,
  });

  return {
    success: true,
    clientId,
    email: client.email,
    companyName: client.company_name,
    invitationUrl,
    emailDelivery,
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const { data: ctx, error: authError } = await createSupabaseContext(req, { auth: 'user' });
  if (authError || !ctx?.userClaims?.id) {
    return json({ error: 'Authentication required' }, authError?.status ?? 401, origin);
  }

  try {
    const admin = ctx.supabaseAdmin;
    const actorId = ctx.userClaims.id;

    // Server-side admin verification: caller must have role = 'admin' in public.profiles
    const { data: profile, error: profileError } = await ctx.supabase
      .from('profiles')
      .select('role')
      .eq('id', actorId)
      .maybeSingle();

    if (profileError) {
      console.error('[client-admin] profile lookup error:', profileError);
      return json({ error: 'Unable to verify administrator authorization.' }, 500, origin);
    }

    if (profile?.role !== 'admin') {
      return json({ error: 'Admin access required.' }, 403, origin);
    }

    const input = (await req.json()) as Input;

    switch (input.action) {
      case 'create_client':
        return json(await createClientAccount(input, admin, actorId), 201, origin);
      case 'resend_invitation':
        return json(await resendClientInvitation(input, admin, actorId), 200, origin);
      default:
        return json({ error: 'Unsupported action' }, 400, origin);
    }
  } catch (error) {
    console.error('[client-admin] Execution error:', error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : 'Request failed' }, 400, origin);
  }
});
