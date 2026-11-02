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

interface InviteClientUserInput {
  action: 'invite_client_user';
  fullName: string;
  email: string;
  role: 'client_admin' | 'client_user';
  /** clients.id — required for IRA admins, ignored for client admins (they can only invite to their own organisation) */
  clientId?: string | null;
}

interface ResendClientUserInput {
  action: 'resend_client_user_invitation';
  clientUserId: string;
}

type Input = CreateClientInput | ResendInvitationInput | InviteClientUserInput | ResendClientUserInput;

/** Who is calling: an IRA administrator, or an active client admin of one organisation. */
type Caller = { kind: 'admin' } | { kind: 'client_admin'; clientId: string };

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

export interface EmailDeliveryResult {
  attempted: boolean;
  sent: boolean;
  reason?: string | null;
}

/**
 * SIGMA 1 doesn't email setup or reset links: the administrator copies the link from the screen and shares it
 * privately (WhatsApp, their own email). Kept as one function so the screens get the same answer everywhere.
 */
function sendInvitationEmail(_params: { toEmail: string; companyName: string; primaryContact: string; invitationUrl: string; kind?: 'invite' | 'reset' }): EmailDeliveryResult {
  return { attempted: false, sent: false, reason: 'Links are shared by the administrator.' };
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
    const emailDelivery = sendInvitationEmail({
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

  // Already set up → this is a password reset link (shorter life, different email).
  const kind: 'invite' | 'reset' = client.status === 'active' ? 'reset' : 'invite';

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
      ...(kind === 'reset' ? { expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() } : {}),
    });

  if (inviteError) throw new Error(`Failed to generate new invitation: ${inviteError.message}`);

  const invitationUrl = `${trustedBaseUrl}/client/setup?token=${rawToken}`;

  const emailDelivery = sendInvitationEmail({
    toEmail: client.email,
    companyName: client.company_name,
    primaryContact: client.primary_contact,
    invitationUrl,
    kind,
  });

  return {
    success: true,
    kind,
    clientId,
    email: client.email,
    companyName: client.company_name,
    invitationUrl,
    emailDelivery,
  };
}

async function issueClientUserInvitation(
  admin: ReturnType<typeof createClient>,
  params: { userId: string; email: string; fullName: string; companyName: string; actorId: string; kind?: 'invite' | 'reset' },
) {
  const trustedBaseUrl = getTrustedBaseUrl();
  // Invalidate earlier unused links for this person.
  await admin.from('client_invitations').update({ used_at: new Date().toISOString() }).eq('client_id', params.userId).is('used_at', null);
  const rawToken = generateSecureToken();
  const tokenHash = await sha256Hex(rawToken);
  const { error: inviteError } = await admin.from('client_invitations').insert({
    client_id: params.userId, // existing convention: the invited auth user id
    email: params.email,
    token_hash: tokenHash,
    created_by: params.actorId,
    ...(params.kind === 'reset' ? { expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() } : {}),
  });
  if (inviteError) throw new Error(`Failed to create the invitation: ${inviteError.message}`);
  const invitationUrl = `${trustedBaseUrl}/client/setup?token=${rawToken}`;
  const emailDelivery = sendInvitationEmail({
    toEmail: params.email,
    companyName: params.companyName,
    primaryContact: params.fullName,
    invitationUrl,
    kind: params.kind ?? 'invite',
  });
  return { invitationUrl, emailDelivery };
}

async function inviteClientUser(input: InviteClientUserInput, admin: ReturnType<typeof createClient>, actorId: string, caller: Caller) {
  const fullName = input.fullName?.trim();
  const email = input.email?.trim().toLowerCase();
  const role = input.role === 'client_admin' ? 'client_admin' : 'client_user';
  const clientId = caller.kind === 'client_admin' ? caller.clientId : input.clientId?.trim();

  if (!clientId) throw new Error('Choose the client organisation.');
  if (!fullName || fullName.length < 2) throw new Error('Enter their full name.');
  if (!email || !validateEmail(email)) throw new Error('Enter a valid email address.');

  const { data: client, error: clientError } = await admin
    .from('clients').select('id, company_name, status, deleted_at').eq('id', clientId).maybeSingle();
  if (clientError || !client || client.deleted_at) throw new Error('Client organisation not found.');
  if (client.status === 'inactive') throw new Error('This client organisation is inactive.');

  const { data: existingUser } = await admin.from('client_users').select('id').eq('email', email).maybeSingle();
  if (existingUser) throw new Error('Someone with this email already has portal access.');
  const { data: existingClient } = await admin.from('clients').select('id').eq('email', email).maybeSingle();
  if (existingClient) throw new Error('This email belongs to another client account.');

  const initialTempSecret = 'IRA_CLIENT_' + crypto.randomUUID().replace(/-/g, '') + '!Aa9';
  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password: initialTempSecret,
    email_confirm: false,
    user_metadata: { full_name: fullName, company_name: client.company_name, role: 'client' },
    app_metadata: { role: 'client' },
  });
  if (authError || !authUser.user) {
    throw new Error(/already/i.test(authError?.message ?? '') ? 'This email is already registered.' : authError?.message ?? 'Unable to create the login.');
  }
  const userId = authUser.user.id;
  let clientUserId: string | null = null;

  try {
    const { error: profileError } = await admin.from('profiles').upsert({ id: userId, role: 'client' });
    if (profileError) throw profileError;
    const { data: cu, error: cuError } = await admin.from('client_users').insert({
      client_id: client.id, profile_id: userId, role, status: 'invited', full_name: fullName, email, invited_by: actorId,
    }).select('id').single();
    if (cuError || !cu) throw cuError ?? new Error('Unable to add the user.');
    clientUserId = cu.id;

    const { invitationUrl, emailDelivery } = await issueClientUserInvitation(admin, {
      userId, email, fullName, companyName: client.company_name, actorId,
    });
    return {
      success: true,
      clientUserId,
      email,
      emailDelivery,
      // No emails: whoever adds the person shares the one-time setup link with them.
      invitationUrl,
    };
  } catch (error) {
    try {
      if (clientUserId) await admin.from('client_users').delete().eq('id', clientUserId);
      await admin.from('client_invitations').delete().eq('client_id', userId);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
    throw error;
  }
}

async function resendClientUserInvitation(input: ResendClientUserInput, admin: ReturnType<typeof createClient>, actorId: string, caller: Caller) {
  const id = input.clientUserId?.trim();
  if (!id) throw new Error('User not found.');
  const { data: cu, error } = await admin
    .from('client_users').select('id, client_id, profile_id, status, full_name, email, clients:client_id (company_name, profile_id)').eq('id', id).maybeSingle();
  if (error || !cu) throw new Error('User not found.');
  if (caller.kind === 'client_admin' && cu.client_id !== caller.clientId) throw new Error('User not found.');
  if (cu.status === 'inactive') throw new Error('This person’s access is switched off. Turn it back on first.');
  if (caller.kind === 'client_admin' && cu.status === 'active') throw new Error('For a password reset, ask your IRA account manager to send a new link.');
  if ((cu as any).clients?.profile_id === cu.profile_id) throw new Error('Use “Resend invitation” on the client account for the primary contact.');
  // Someone who already set a password gets a reset link instead of a welcome invitation.
  const kind: 'invite' | 'reset' = cu.status === 'active' ? 'reset' : 'invite';
  const { invitationUrl, emailDelivery } = await issueClientUserInvitation(admin, {
    userId: cu.profile_id, email: cu.email, fullName: cu.full_name ?? cu.email, companyName: (cu as any).clients?.company_name ?? 'your organisation', actorId, kind,
  });
  // Client admins only ever get first-time setup links (resets are blocked above).
  return { success: true, kind, email: cu.email, emailDelivery, invitationUrl };
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

    // Server-side authorization from the database, never from the request body.
    const { data: profile, error: profileError } = await ctx.supabase
      .from('profiles')
      .select('role')
      .eq('id', actorId)
      .maybeSingle();

    if (profileError) {
      console.error('[client-admin] profile lookup error:', profileError);
      return json({ error: 'Unable to verify authorization.' }, 500, origin);
    }

    const input = (await req.json()) as Input;
    const clientUserActions = input.action === 'invite_client_user' || input.action === 'resend_client_user_invitation';

    let caller: Caller;
    if (profile?.role === 'admin') {
      caller = { kind: 'admin' };
    } else if (profile?.role === 'client' && clientUserActions) {
      // Client admins (permission client.users.manage) may manage people in their own organisation only.
      const { data: me } = await admin
        .from('client_users')
        .select('client_id, role, status, clients:client_id (status, deleted_at)')
        .eq('profile_id', actorId)
        .maybeSingle();
      const org = (me as any)?.clients;
      if (!me || me.role !== 'client_admin' || me.status !== 'active' || !org || org.deleted_at || org.status === 'inactive') {
        return json({ error: 'Only your organisation’s administrator can add people.' }, 403, origin);
      }
      caller = { kind: 'client_admin', clientId: me.client_id };
    } else {
      return json({ error: 'Admin access required.' }, 403, origin);
    }

    if (caller.kind !== 'admin' && !clientUserActions) {
      return json({ error: 'Admin access required.' }, 403, origin);
    }

    switch (input.action) {
      case 'create_client':
        return json(await createClientAccount(input, admin, actorId), 201, origin);
      case 'resend_invitation':
        return json(await resendClientInvitation(input, admin, actorId), 200, origin);
      case 'invite_client_user':
        return json(await inviteClientUser(input, admin, actorId, caller), 201, origin);
      case 'resend_client_user_invitation':
        return json(await resendClientUserInvitation(input, admin, actorId, caller), 200, origin);
      default:
        return json({ error: 'Unsupported action' }, 400, origin);
    }
  } catch (error) {
    console.error('[client-admin] Execution error:', error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : 'Request failed' }, 400, origin);
  }
});
