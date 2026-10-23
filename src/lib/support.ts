import { supabase } from './supabase';
import { isMissingSchema } from './tasks';
import type { Tone } from '../ui';

export type SupportStatus = 'open' | 'in_progress' | 'waiting_on_client' | 'resolved' | 'closed';
export type SupportCategory = 'question' | 'problem' | 'billing' | 'access' | 'feedback';

export interface SupportRequest {
  id: string; request_number: string; client_id: string; project_id: string | null; subject: string; category: SupportCategory;
  status: SupportStatus; priority: 'low' | 'normal' | 'high' | 'urgent'; assigned_to: string | null; last_message_at: string;
  resolved_at: string | null; created_at: string;
  clients?: { company_name: string } | null; projects?: { name: string } | null;
}
export interface SupportMessage { id: string; request_id: string; author_id: string | null; author_kind: 'client' | 'staff'; author_name: string | null; body: string; internal: boolean; created_at: string }

export const SUPPORT_STATUS: Record<SupportStatus, { label: string; clientLabel: string; tone: Tone }> = {
  open: { label: 'New', clientLabel: 'Sent', tone: 'amber' },
  in_progress: { label: 'In progress', clientLabel: 'Team is on it', tone: 'brand' },
  waiting_on_client: { label: 'Waiting on client', clientLabel: 'Needs your reply', tone: 'sky' },
  resolved: { label: 'Resolved', clientLabel: 'Resolved', tone: 'mint' },
  closed: { label: 'Closed', clientLabel: 'Closed', tone: 'ink' },
};
export const SUPPORT_CATEGORY: Record<SupportCategory, string> = {
  question: 'Question', problem: 'Something isn’t working', billing: 'Billing & invoices', access: 'Access & logins', feedback: 'Feedback',
};

const db = supabase as any;
const NOT_READY = 'Support requests switch on once the collaboration database update is applied.';
async function q<T>(p: Promise<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(isMissingSchema(error) ? NOT_READY : error.message);
  return data;
}

export const supportApi = {
  list: () => q<SupportRequest[]>(db.from('support_requests').select('*, clients:client_id (company_name), projects:project_id (name)').order('last_message_at', { ascending: false }).limit(300)),
  messages: (requestId: string) => q<SupportMessage[]>(db.from('support_messages').select('*').eq('request_id', requestId).order('created_at')),
  create: (subject: string, body: string, category: SupportCategory, projectId?: string | null) =>
    q<string>(db.rpc('support_create', { p_subject: subject, p_body: body, p_category: category, p_project_id: projectId ?? null })),
  reply: (requestId: string, body: string, internal = false) => q<string>(db.rpc('support_reply', { p_request_id: requestId, p_body: body, p_internal: internal })),
  setStatus: (requestId: string, status: SupportStatus, assignedTo?: string | null) =>
    q(db.rpc('support_set_status', { p_request_id: requestId, p_status: status, p_assigned_to: assignedTo ?? null })),
};
