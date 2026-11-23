import { supabase } from './supabase';
import type { Tone } from '../ui';

/**
 * Services module: catalogue, client requests, versioned quotations.
 * Every change goes through permission-checked database functions; the tables are read-only to the browser.
 */

const db = () => supabase as any;

export const errText = (e: unknown, fallback: string) => {
  const m = (e as any)?.message ?? (e instanceof Error ? e.message : '');
  return m ? String(m).replace(/^.*?P0001:\s*/, '') : fallback;
};

export interface ServiceCategory { id: string; name: string; description: string | null; icon: string | null; sort_order: number; visible: boolean }
export interface ServiceSubcategory { id: string; category_id: string; name: string; sort_order: number; visible: boolean }
export interface Service {
  id: string; subcategory_id: string; name: string; description: string | null; image_url: string | null;
  pricing_type: 'quote' | 'fixed'; price_from: number | null; price_to: number | null; fixed_price: number | null;
  gst_rate: number; sac: string | null; unit: string | null; featured: boolean; visible: boolean; requestable: boolean;
  sort_order: number; archived_at: string | null;
}
export interface Catalogue { categories: ServiceCategory[]; subcategories: ServiceSubcategory[]; services: Service[] }

export type RequestStatus = 'new' | 'under_review' | 'quote_draft' | 'quote_sent' | 'revision_requested' | 'approved' | 'rejected'
  | 'payment_pending' | 'paid' | 'in_progress' | 'completed' | 'cancelled';

export interface ServiceRequest {
  id: string; request_no: string; client_id: string; requested_by: string | null; brief: string; timeline: string | null;
  preferred_date: string | null; notes: string | null; status: RequestStatus; assigned_to: string | null; project_id: string | null;
  contract_id: string | null; accepted_quote_id: string | null; payment_exception: boolean; exception_reason: string | null;
  close_reason: string | null; created_at: string; updated_at: string;
  service_request_items?: { id: string; service_id: string | null; service_name: string; category_name: string | null; subcategory_name: string | null }[];
}
export interface QuoteItem {
  id: string; quote_id: string; line_no: number; service_id: string | null; description: string; details: string | null; sac: string;
  qty: number; unit_price: number; discount: number; taxable: number; gst_rate: number; tax: number; total: number; due_in_days: number | null;
}
export interface PaymentTerm { name: string; percentage: number }
export interface Quote {
  id: string; request_id: string; version_no: number; status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'revision_requested' | 'superseded';
  scope: string | null; timeline: string | null; terms: string | null; valid_until: string | null; payment_terms: PaymentTerm[];
  first_term_due_days: number; subtotal: number; discount_total: number; taxable_total: number; tax_total: number;
  cgst_total: number; sgst_total: number; igst_total: number; grand_total: number; supply_type: 'intra' | 'inter' | null;
  seller: Record<string, string | null> | null; buyer: Record<string, string | null> | null; client_note: string | null;
  sent_at: string | null; responded_at: string | null; created_at: string;
  service_quote_items?: QuoteItem[];
}
export interface Activity { id: string; request_id: string; kind: string; from_status: string | null; to_status: string | null; note: string | null; internal: boolean; actor: string | null; created_at: string }
export interface ServiceFile { id: string; name: string; storage_bucket: string; storage_path: string; visibility: string; uploaded_by: string; created_at: string; size_bytes: number | null; file_group_id: string }

/** Labels for staff and for clients (clients never see internal steps like "quote draft"). */
export const REQUEST_STATUS: Record<RequestStatus, { label: string; client: string; tone: Tone }> = {
  new: { label: 'New', client: 'Received', tone: 'sky' },
  under_review: { label: 'Under review', client: 'Being reviewed', tone: 'sky' },
  quote_draft: { label: 'Quote in draft', client: 'Preparing your quotation', tone: 'amber' },
  quote_sent: { label: 'Quote sent', client: 'Quotation ready', tone: 'brand' },
  revision_requested: { label: 'Changes asked', client: 'Revising quotation', tone: 'amber' },
  approved: { label: 'Accepted — start work', client: 'Accepted', tone: 'mint' },
  rejected: { label: 'Declined', client: 'Declined', tone: 'rose' },
  payment_pending: { label: 'Waiting for payment', client: 'Awaiting first payment', tone: 'amber' },
  paid: { label: 'Paid', client: 'Paid', tone: 'mint' },
  in_progress: { label: 'In progress', client: 'In progress', tone: 'brand' },
  completed: { label: 'Completed', client: 'Completed', tone: 'mint' },
  cancelled: { label: 'Cancelled', client: 'Cancelled', tone: 'ink' },
};
export const OPEN_STATUSES: RequestStatus[] = ['new', 'under_review', 'quote_draft', 'quote_sent', 'revision_requested', 'approved', 'payment_pending', 'in_progress'];
export const CLIENT_CANCELLABLE: RequestStatus[] = ['new', 'under_review', 'quote_draft', 'quote_sent', 'revision_requested', 'approved'];
export const FILE_STAGE: RequestStatus[] = ['new', 'under_review', 'quote_draft', 'quote_sent', 'revision_requested'];

export const GST_RATES = [0, 5, 12, 18, 28, 40];

export const inr = (v: number | null | undefined) =>
  `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: Number(v ?? 0) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const addDaysIST = (n: number) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const fmtDate = (d?: string | null) =>
  d ? new Date(d.length <= 10 ? `${d}T00:00:00+05:30` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
export const fmtWhen = (d: string) =>
  new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

/** Price line shown on a catalogue card. */
export function priceLabel(s: Service): string {
  if (s.pricing_type === 'fixed' && s.fixed_price != null) return `${inr(s.fixed_price)}${s.unit ? ` / ${s.unit}` : ''} + GST`;
  if (s.price_from != null && s.price_to != null) return `${inr(s.price_from)} – ${inr(s.price_to)}`;
  if (s.price_from != null) return `From ${inr(s.price_from)}`;
  return 'Custom quote';
}

async function must<T>(q: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export const servicesApi = {
  async catalogue(): Promise<Catalogue> {
    const [categories, subcategories, services] = await Promise.all([
      must(db().from('service_categories').select('*').order('sort_order').order('name')),
      must(db().from('service_subcategories').select('*').order('sort_order').order('name')),
      must(db().from('services').select('*').order('sort_order').order('name').limit(5000)),
    ]);
    return { categories: categories as ServiceCategory[], subcategories: subcategories as ServiceSubcategory[], services: services as Service[] };
  },
  async requests(): Promise<ServiceRequest[]> {
    return must(db().from('service_requests').select('*, service_request_items(*)').order('created_at', { ascending: false }).limit(1000));
  },
  async detail(requestId: string): Promise<{ quotes: Quote[]; activity: Activity[]; files: ServiceFile[] }> {
    const [quotes, activity, files] = await Promise.all([
      must(db().from('service_quotes').select('*, service_quote_items(*)').eq('request_id', requestId).order('version_no', { ascending: false })),
      must(db().from('service_activity').select('*').eq('request_id', requestId).order('created_at', { ascending: true }).limit(500)),
      must(db().from('files').select('id, name, storage_bucket, storage_path, visibility, uploaded_by, created_at, size_bytes, file_group_id')
        .eq('parent_type', 'service_request').eq('parent_id', requestId).is('deleted_at', null).order('created_at')),
    ]);
    for (const q of quotes as Quote[]) q.service_quote_items?.sort((a, b) => a.line_no - b.line_no);
    return { quotes: quotes as Quote[], activity: activity as Activity[], files: files as ServiceFile[] };
  },
  create: (serviceIds: string[], brief: string, timeline: string, preferredDate: string, notes: string) =>
    must<string>(db().rpc('client_service_request_create', {
      p_service_ids: serviceIds, p_brief: brief, p_timeline: timeline || null, p_preferred_date: preferredDate || null, p_notes: notes || null,
    })),
  cancel: (id: string, reason: string) => must(db().rpc('client_service_request_cancel', { p_request: id, p_reason: reason || null })),
  respond: (quoteId: string, action: 'accept' | 'revise' | 'reject', note: string) =>
    must<string>(db().rpc('client_service_quote_respond', { p_quote: quoteId, p_action: action, p_note: note || null })),
  staffUpdate: (id: string, action: 'review' | 'assign' | 'note' | 'reject' | 'complete', value: string | null, note: string | null) =>
    must(db().rpc('staff_service_request_update', { p_request: id, p_action: action, p_value: value, p_note: note })),
  saveQuote: (requestId: string, payload: Record<string, unknown>) => must<string>(db().rpc('staff_service_quote_save', { p_request: requestId, p: payload })),
  sendQuote: (quoteId: string) => must(db().rpc('staff_service_quote_send', { p_quote: quoteId })),
  discardQuote: (quoteId: string) => must(db().rpc('staff_service_quote_discard', { p_quote: quoteId })),
  start: (requestId: string, projectId: string | null, newProjectName: string | null, exception: boolean, reason: string | null) =>
    must<{ project_id: string; contract_id: string; deliverables: number }>(db().rpc('staff_service_start', {
      p_request: requestId, p_project_id: projectId, p_new_project_name: newProjectName, p_payment_exception: exception, p_exception_reason: reason,
    })),
  saveCatalogue: (kind: 'category' | 'subcategory' | 'service', id: string | null, payload: Record<string, unknown>) =>
    must<string>(db().rpc('service_catalogue_save', { p_kind: kind, p_id: id, p: payload })),
};
