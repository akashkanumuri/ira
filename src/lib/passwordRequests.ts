import { supabase } from './supabase';

const db = supabase as any;

export interface PasswordRequest {
  id: string;
  email: string;
  client_id: string;
  client_user_id: string | null;
  company_name: string;
  person: string;
  requested_at: string;
}

/** Client login page (signed out): asks the admins for a new password link. Always the same answer. */
export async function requestPasswordLink(email: string): Promise<string> {
  const { data, error } = await db.rpc('client_request_password_reset', { p_email: email });
  if (error) throw new Error(error.message);
  return (data as string) || 'Your account manager has been told. They will send you a new link.';
}

/** Admins: open requests from clients who forgot their password. */
export async function listPasswordRequests(): Promise<PasswordRequest[]> {
  const { data, error } = await db.rpc('staff_password_requests');
  if (error || !Array.isArray(data)) return [];
  return data as PasswordRequest[];
}

/** Admins: after creating a link for someone, close their open requests (and the alerts). */
export async function closePasswordRequests(email: string): Promise<void> {
  await db.rpc('staff_close_password_requests', { p_email: email });
}
