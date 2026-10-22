/**
 * SIGMA 1 — client lifecycle data layer.
 *
 * All state-changing client/staff actions go through validated database RPCs
 * (see supabase/migrations/202610221*_sigma_*.sql). Errors are surfaced, never
 * swallowed: callers receive a thrown `SigmaError` with a user-safe message.
 */
import { supabase } from './supabase';

const db = supabase as any;

/* ------------------------------------------------------------------ types */

export const DELIVERABLE_STATUSES = [
  'Draft',
  'Pending',
  'In Progress',
  'Awaiting Client Dependency',
  'Under Internal Review',
  'Awaiting Client Review',
  'Modification Requested',
  'Revision In Progress',
  'Completed',
  'Ready for Download',
  'Cancelled',
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

/** Mirrors private.deliverable_transition_allowed (database is authoritative). */
export const DELIVERABLE_TRANSITIONS: Record<DeliverableStatus, DeliverableStatus[]> = {
  Draft: ['Pending', 'Cancelled'],
  Pending: ['In Progress', 'Awaiting Client Dependency', 'Draft', 'Cancelled'],
  'In Progress': ['Awaiting Client Dependency', 'Under Internal Review', 'Pending', 'Cancelled'],
  'Awaiting Client Dependency': ['In Progress', 'Pending', 'Cancelled'],
  'Under Internal Review': ['In Progress', 'Awaiting Client Review', 'Completed', 'Cancelled'],
  'Awaiting Client Review': ['Modification Requested', 'Completed', 'Revision In Progress'],
  'Modification Requested': ['Revision In Progress', 'Awaiting Client Review', 'Cancelled'],
  'Revision In Progress': ['Under Internal Review', 'Awaiting Client Review'],
  Completed: ['Ready for Download', 'Revision In Progress'],
  'Ready for Download': ['Completed', 'Revision In Progress'],
  Cancelled: ['Pending'],
};

/** Transitions an assigned (non-manager) employee may perform. */
export const EMPLOYEE_TRANSITIONS: Partial<Record<DeliverableStatus, DeliverableStatus[]>> = {
  Pending: ['In Progress'],
  'In Progress': ['Under Internal Review'],
  'Revision In Progress': ['Under Internal Review'],
  'Awaiting Client Dependency': ['In Progress'],
};

export type ContractStatus =
  | 'Draft'
  | 'Sent'
  | 'Viewed'
  | 'Awaiting Acceptance'
  | 'Accepted'
  | 'Declined'
  | 'Expired'
  | 'Terminated';

export const AWAITING_CLIENT_CONTRACT: ContractStatus[] = ['Sent', 'Viewed', 'Awaiting Acceptance'];

export type LockState = 'unlocked' | 'locked_payment' | 'locked_manual' | 'override_unlocked';
export const isLocked = (s: LockState | string | null | undefined) => s === 'locked_payment' || s === 'locked_manual';

export type ModificationType = 'quantity' | 'scope' | 'timeline' | 'revision' | 'other';
export type ModificationStatus =
  | 'Pending Review'
  | 'Approved'
  | 'Rejected'
  | 'Counter Proposed'
  | 'Counter Accepted'
  | 'Counter Declined'
  | 'Withdrawn';
export const OPEN_MODIFICATION: ModificationStatus[] = ['Pending Review', 'Counter Proposed'];

export type InstallmentStatus =
  | 'Upcoming'
  | 'Due'
  | 'Partially Paid'
  | 'Paid'
  | 'Overdue'
  | 'Disputed'
  | 'Cancelled'
  | 'Waived';

export interface ContractRow {
  id: string;
  project_id: string;
  client_id: string | null;
  title: string;
  ref: string;
  version: string;
  url: string;
  status: ContractStatus;
  current_version_no: number;
  contract_value: number | null;
  currency: string;
  tax_note: string | null;
  start_date: string | null;
  end_date: string | null;
  renewal_date: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractVersionRow {
  id: string;
  contract_id: string;
  version_no: number;
  title: string;
  document_url: string | null;
  document_file_id: string | null;
  terms_summary: string | null;
  contract_value: number | null;
  start_date: string | null;
  end_date: string | null;
  change_note: string | null;
  created_at: string;
}

export interface AcceptanceRow {
  id: string;
  contract_id: string;
  version: string;
  version_no: number | null;
  url: string;
  who: string;
  event: 'Accepted' | 'Declined' | string;
  note: string | null;
  ip_address: string | null;
  acknowledgement: string | null;
  created_at: string;
}

export interface DeliverableRow {
  id: string;
  project_id: string;
  contract_id: string | null;
  deliverable_number: string;
  name: string;
  description: string | null;
  category: string | null;
  quantity: number;
  unit: string | null;
  timeline: string | null;
  start_date: string | null;
  due_date: string | null;
  dependencies: string | null;
  reference_url: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  assigned_team: string | null;
  status: DeliverableStatus;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  weightage: number | null;
  version_no: number;
  client_action: string | null;
  lock_state: LockState;
  lock_reason: string | null;
  completed_at: string | null;
  ready_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliverableVersionRow {
  id: string;
  deliverable_id: string;
  version_no: number;
  snapshot: Record<string, unknown>;
  change_source: string;
  reason: string | null;
  created_at: string;
}

export interface ModificationRow {
  id: string;
  project_id: string;
  deliverable_id: string;
  request_number: string;
  field: string;
  modification_type: ModificationType;
  previous_value: string | null;
  requested_value: string;
  original_quantity: number | null;
  requested_quantity: number | null;
  quantity_delta: number | null;
  original_due_date: string | null;
  requested_due_date: string | null;
  counter_quantity: number | null;
  counter_due_date: string | null;
  counter_value: string | null;
  billing_note: string | null;
  reason: string | null;
  requested_by_name: string | null;
  status: ModificationStatus;
  reviewer_name: string | null;
  reviewer_comment: string | null;
  reviewed_at: string | null;
  client_response_note: string | null;
  applied_version_no: number | null;
  created_at: string;
}

export interface DependencyRow {
  id: string;
  deliverable_id: string;
  project_id: string;
  name: string;
  description: string | null;
  required_by: string | null;
  status: 'Requested' | 'Pending' | 'Uploaded' | 'Accepted' | 'Rejected' | 'Resubmission Required';
  client_note: string | null;
  review_comment: string | null;
  uploaded_at: string | null;
  created_at: string;
}

export interface FileRow {
  id: string;
  file_group_id: string;
  version_no: number;
  parent_type: string;
  parent_id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_bucket: string;
  storage_path: string;
  visibility: 'internal' | 'client';
  is_final: boolean;
  uploaded_by: string | null;
  created_at: string;
}

export interface InstallmentRow {
  id: string;
  project_id: string;
  contract_id: string | null;
  installment_number: number;
  name: string;
  basis: string | null;
  basis_type: 'percentage' | 'fixed' | 'recurring';
  percentage: number | null;
  amount: number;
  tax_amount: number;
  amount_paid: number;
  due_date: string | null;
  status: InstallmentStatus;
  status_override: string | null;
  status_reason: string | null;
  payment_reference: string | null;
  paid_on: string | null;
  invoice_number: string | null;
  invoice_issued_at: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  installment_id: string;
  project_id: string;
  amount: number;
  reference: string;
  paid_on: string;
  method: string | null;
  proof_file_id: string | null;
  status: 'Submitted' | 'Verified' | 'Rejected';
  source: 'client' | 'finance';
  notes: string | null;
  submitted_at: string;
  verified_at: string | null;
  rejection_reason: string | null;
}

/* ------------------------------------------------------------- formatting */

export const inr = (n: number | null | undefined) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export function fmtDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00') : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

export const fmtQty = (q: number | null | undefined, unit?: string | null) =>
  `${Number(q ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit ? ' ' + unit : ''}`;

export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export const installmentTotal = (i: Pick<InstallmentRow, 'amount' | 'tax_amount'>) =>
  Number(i.amount || 0) + Number(i.tax_amount || 0);

export const fmtBytes = (n: number | null | undefined) => {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
};

/** Deliverable count progress and (when every deliverable has a weight) weighted progress. */
export function computeProgress(rows: Pick<DeliverableRow, 'status' | 'weightage'>[]) {
  const active = rows.filter(r => r.status !== 'Cancelled' && r.status !== 'Draft');
  const done = active.filter(r => r.status === 'Completed' || r.status === 'Ready for Download');
  const countPct = active.length ? Math.round((done.length / active.length) * 100) : 0;
  const weighted = active.length > 0 && active.every(r => r.weightage != null && Number(r.weightage) > 0);
  const totalW = weighted ? active.reduce((s, r) => s + Number(r.weightage), 0) : 0;
  const weightedPct = weighted && totalW > 0
    ? Math.round((done.reduce((s, r) => s + Number(r.weightage), 0) / totalW) * 100)
    : null;
  return { total: active.length, done: done.length, countPct, weightedPct };
}

/* ----------------------------------------------------------------- errors */

export class SigmaError extends Error {}

function friendly(error: any): string {
  const msg = String(error?.message || error?.error_description || error || 'Request failed');
  if (/JWT|not authenticated|Authentication required/i.test(msg)) return 'Your session has expired. Please sign in again.';
  if (/permission denied|row-level security/i.test(msg)) return 'You do not have permission to perform this action.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Network problem — please check your connection and try again.';
  if (/duplicate key/i.test(msg)) return 'This record already exists.';
  return msg.replace(/^ERROR:\s*/i, '');
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new SigmaError(friendly(error));
  return data as T;
}

export async function must<T>(q: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new SigmaError(friendly(error));
  return data;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : friendly(e));

/** Stable key so a double-clicked submit is processed once server-side. */
export const idempotencyKey = (scope: string) =>
  `${scope}:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now() + Math.random()}`;

/* ------------------------------------------------------------------ files */

export const FILE_BUCKET = 'sigma-files';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const ACCEPTED_FILE_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/zip', 'application/x-zip-compressed',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'video/mp4', 'video/quicktime', 'audio/mpeg',
  'image/vnd.adobe.photoshop', 'application/postscript', 'application/illustrator',
];
export const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.mp4,.mov,.mp3,.psd,.ai,.eps';

export function validateFile(file: File): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 50 MB.`;
  if (file.type && !ACCEPTED_FILE_TYPES.includes(file.type)) return `${file.name}: this file type is not supported.`;
  return null;
}

export interface AttachOptions {
  visibility?: 'internal' | 'client';
  isFinal?: boolean;
  replacesFileId?: string | null;
}

/** Uploads into the caller's private folder, then registers the file against its parent record. */
export async function uploadAndAttach(
  file: File,
  parentType: 'deliverable' | 'dependency' | 'payment' | 'invoice' | 'contract' | 'task',
  parentId: string,
  opts: AttachOptions = {},
): Promise<string> {
  const invalid = validateFile(file);
  if (invalid) throw new SigmaError(invalid);
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new SigmaError('Your session has expired. Please sign in again.');
  const safe = file.name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
  const path = `${uid}/${crypto.randomUUID()}-${safe}`;
  const { error: upErr } = await supabase.storage.from(FILE_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (upErr) throw new SigmaError(friendly(upErr));
  return rpc<string>('attach_file', {
    p_storage_path: path,
    p_parent_type: parentType,
    p_parent_id: parentId,
    p_name: file.name,
    p_mime_type: file.type || null,
    p_size_bytes: file.size,
    p_visibility: opts.visibility ?? 'internal',
    p_is_final: opts.isFinal ?? false,
    p_replaces_file_id: opts.replacesFileId ?? null,
  });
}

/** Short-lived signed URL; storage RLS re-checks tenant, visibility and payment lock. */
export async function openFile(file: Pick<FileRow, 'storage_bucket' | 'storage_path' | 'name'>, download = true) {
  const { data, error } = await supabase.storage
    .from(file.storage_bucket || FILE_BUCKET)
    .createSignedUrl(file.storage_path, 60, download ? { download: file.name } : undefined);
  if (error || !data?.signedUrl) {
    throw new SigmaError(
      /not found|Object not found/i.test(error?.message || '')
        ? 'This file is not available to you right now.'
        : friendly(error),
    );
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

/** Latest version per file group. */
export function latestFiles(files: FileRow[]): FileRow[] {
  const byGroup = new Map<string, FileRow>();
  for (const f of files) {
    const cur = byGroup.get(f.file_group_id);
    if (!cur || f.version_no > cur.version_no) byGroup.set(f.file_group_id, f);
  }
  return [...byGroup.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/* ------------------------------------------------------------- loaders */

export interface ProjectWorkspace {
  contracts: ContractRow[];
  contractVersions: ContractVersionRow[];
  acceptances: AcceptanceRow[];
  deliverables: DeliverableRow[];
  versions: DeliverableVersionRow[];
  modifications: ModificationRow[];
  dependencies: DependencyRow[];
  files: FileRow[];
  installments: InstallmentRow[];
  payments: PaymentRow[];
  milestones: { id: string; name: string; target_date: string; state: string; sort_order: number }[];
  updates: { id: string; title: string; meta: string; tone: string | null; created_at: string }[];
}

export async function loadProjectWorkspace(projectId: string): Promise<ProjectWorkspace> {
  const [contracts, acceptances, deliverables, modifications, dependencies, installments, payments, milestones, updates] =
    await Promise.all([
      must<ContractRow[]>(db.from('contracts').select('*').eq('project_id', projectId).is('deleted_at', null).order('created_at', { ascending: false })),
      must<AcceptanceRow[]>(db.from('contract_acceptances').select('*').eq('project_id', projectId).order('created_at', { ascending: false })),
      must<DeliverableRow[]>(db.from('deliverables').select('*').eq('project_id', projectId).is('deleted_at', null).order('sort_order').order('deliverable_number')),
      must<ModificationRow[]>(db.from('change_requests').select('*').eq('project_id', projectId).order('created_at', { ascending: false })),
      must<DependencyRow[]>(db.from('deliverable_dependencies').select('*').eq('project_id', projectId).order('created_at', { ascending: false })),
      must<InstallmentRow[]>(db.from('payment_installments').select('*').eq('project_id', projectId).is('deleted_at', null).order('installment_number')),
      must<PaymentRow[]>(db.from('payments').select('*').eq('project_id', projectId).order('submitted_at', { ascending: false })),
      must<any[]>(db.from('milestones').select('*').eq('project_id', projectId).order('sort_order')),
      must<any[]>(db.from('project_updates').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(20)),
    ]);
  const contractIds = contracts.map(c => c.id);
  const deliverableIds = deliverables.map(d => d.id);
  const [contractVersions, versions, files] = await Promise.all([
    contractIds.length
      ? must<ContractVersionRow[]>(db.from('contract_versions').select('*').in('contract_id', contractIds).order('version_no', { ascending: false }))
      : Promise.resolve([] as ContractVersionRow[]),
    deliverableIds.length
      ? must<DeliverableVersionRow[]>(db.from('deliverable_versions').select('*').in('deliverable_id', deliverableIds).order('version_no', { ascending: false }))
      : Promise.resolve([] as DeliverableVersionRow[]),
    must<FileRow[]>(db.from('files').select('*').eq('project_id', projectId).is('deleted_at', null).order('created_at', { ascending: false })),
  ]);
  return {
    contracts, contractVersions, acceptances, deliverables, versions, modifications, dependencies, files,
    installments, payments, milestones, updates,
  };
}
