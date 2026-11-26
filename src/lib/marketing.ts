import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Performance marketing: social posts, ad campaigns with daily results, reports and the ad-money ledger.
 * Reads go through RLS (team members see their clients; a client sees their own when access is on).
 * Every change is a permission-checked database function.
 */
const db = () => supabase as any;

export const errText = (e: unknown, fallback: string) => {
  const m = (e as any)?.message ?? (e instanceof Error ? e.message : '');
  return m ? String(m).replace(/^.*?P0001:\s*/, '') : fallback;
};

export interface MkClient { client_id: string; enabled: boolean; client_access: boolean; post_approval: boolean; low_balance: number; updated_at: string }
export interface MkPost {
  id: string; client_id: string; platforms: string[]; post_type: string; scheduled_for: string; title: string | null; caption: string | null;
  status: 'draft' | 'awaiting_approval' | 'changes_requested' | 'approved' | 'posted' | 'cancelled';
  client_note: string | null; live_url: string | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null;
  posted_at: string | null; created_at: string;
}
export interface MkCampaign {
  id: string; client_id: string; name: string; platform: Platform; objective: string; start_date: string; end_date: string | null;
  budget: number | null; status: 'planned' | 'running' | 'paused' | 'completed'; notes: string | null; created_at: string; owner_id: string | null;
}
export interface MkResult {
  id: string; campaign_id: string; client_id: string; day: string; spend: number; impressions: number; reach: number; clicks: number;
  leads: number; messages: number; sales: number; sales_value: number;
}
export interface MkReport { id: string; client_id: string; title: string; period_start: string | null; period_end: string | null; visible_to_client: boolean; archived_at: string | null; created_at: string }
export interface MkMoney {
  id: string; client_id: string; kind: 'request' | 'receipt' | 'refund' | 'adjustment'; amount: number; entry_date: string; due_date: string | null;
  request_id: string | null; method: string | null; reference: string | null; note: string | null; voided_at: string | null; void_reason: string | null; created_at: string;
}
export interface MkBudget {
  id: string; client_id: string; employee_id: string; kind: 'given' | 'returned' | 'request'; amount: number; entry_date: string;
  request_id: string | null; status: 'open' | 'approved' | 'declined' | null; note: string | null; voided_at: string | null; void_reason: string | null; created_at: string;
}
export interface MkClaim {
  id: string; client_id: string; request_id: string | null; amount: number; paid_on: string; method: string; reference: string | null; note: string | null;
  status: 'pending' | 'confirmed' | 'rejected'; reject_reason: string | null; created_at: string; decided_at: string | null;
}
export interface MkData { settings: MkClient | null; posts: MkPost[]; campaigns: MkCampaign[]; results: MkResult[]; reports: MkReport[]; money: MkMoney[]; budget: MkBudget[]; claims: MkClaim[] }

/** Per marketer: budget given (minus returned), spent on the campaigns they run, and what is left with them. */
export function budgetByPerson(budget: MkBudget[], campaigns: MkCampaign[], results: MkResult[]) {
  const live = budget.filter((b) => !b.voided_at);
  const ids = new Set([...live.filter((b) => b.kind !== 'request').map((b) => b.employee_id), ...campaigns.map((c) => c.owner_id).filter(Boolean) as string[]]);
  return [...ids].map((id) => {
    const given = live.filter((b) => b.employee_id === id).reduce((a, b) => a + (b.kind === 'given' ? +b.amount : b.kind === 'returned' ? -b.amount : 0), 0);
    const mine = new Set(campaigns.filter((c) => c.owner_id === id).map((c) => c.id));
    const spent = results.filter((r) => mine.has(r.campaign_id)).reduce((a, r) => a + Number(r.spend), 0);
    return { employeeId: id, given, spent, left: given - spent, open: live.filter((b) => b.employee_id === id && b.kind === 'request' && b.status === 'open') };
  });
}

export type Platform = 'meta' | 'google' | 'linkedin' | 'youtube' | 'other';
/** Fixed colour per platform (categorical slots, never reassigned by rank). */
export const PLATFORMS: { id: Platform; label: string; color: string }[] = [
  { id: 'meta', label: 'Meta (FB + IG)', color: '#257de0' },
  { id: 'google', label: 'Google', color: '#f47230' },
  { id: 'linkedin', label: 'LinkedIn', color: '#00b894' },
  { id: 'youtube', label: 'YouTube', color: '#ec4647' },
  { id: 'other', label: 'Other', color: '#8a8a99' },
];
export const platformOf = (p: string) => PLATFORMS.find((x) => x.id === p) ?? PLATFORMS[4];
export const SOCIAL = [
  { id: 'instagram', label: 'Instagram' }, { id: 'facebook', label: 'Facebook' }, { id: 'linkedin', label: 'LinkedIn' },
  { id: 'youtube', label: 'YouTube' }, { id: 'x', label: 'X' }, { id: 'google', label: 'Google profile' }, { id: 'whatsapp', label: 'WhatsApp' }, { id: 'other', label: 'Other' },
];
export const POST_TYPES = ['post', 'reel', 'story', 'carousel', 'video', 'other'];
export const OBJECTIVES = [
  { id: 'leads', label: 'Leads' }, { id: 'messages', label: 'Messages' }, { id: 'sales', label: 'Sales' }, { id: 'calls', label: 'Calls' },
  { id: 'traffic', label: 'Website visits' }, { id: 'awareness', label: 'Awareness' }, { id: 'engagement', label: 'Engagement' },
];
export const POST_STATUS: Record<MkPost['status'], { label: string; tone: 'ink' | 'amber' | 'rose' | 'mint' | 'brand' | 'sky' }> = {
  draft: { label: 'Draft', tone: 'ink' }, awaiting_approval: { label: 'Waiting for approval', tone: 'amber' },
  changes_requested: { label: 'Changes asked', tone: 'rose' }, approved: { label: 'Ready to post', tone: 'sky' },
  posted: { label: 'Posted', tone: 'mint' }, cancelled: { label: 'Cancelled', tone: 'ink' },
};
export const CAMPAIGN_STATUS: Record<MkCampaign['status'], { label: string; tone: 'ink' | 'amber' | 'mint' | 'brand' }> = {
  planned: { label: 'Planned', tone: 'ink' }, running: { label: 'Running', tone: 'mint' }, paused: { label: 'Paused', tone: 'amber' }, completed: { label: 'Completed', tone: 'brand' },
};

export const inr = (v: number | null | undefined, opts: { compact?: boolean } = {}) => {
  const n = Number(v ?? 0);
  if (opts.compact && Math.abs(n) >= 100000) return `₹${(n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}L`;
  if (opts.compact && Math.abs(n) >= 1000) return `₹${(n / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}k`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: n % 1 ? 2 : 0 })}`;
};
export const num = (v: number | null | undefined, compact = false) => {
  const n = Number(v ?? 0);
  if (compact && n >= 10000000) return `${(n / 10000000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}Cr`;
  if (compact && n >= 100000) return `${(n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}L`;
  if (compact && n >= 1000) return `${(n / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString('en-IN');
};
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const shiftDay = (iso: string, d: number) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
export const fmtDay = (iso: string | null | undefined, withYear = false) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'Asia/Kolkata' }) : '—';
export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

/** Money position for one client: received, spent, balance and what is still due from the client. */
export function moneySummary(money: MkMoney[], results: MkResult[]) {
  const live = money.filter((m) => !m.voided_at);
  const received = live.reduce((a, m) => a + (m.kind === 'receipt' ? +m.amount : m.kind === 'refund' ? -m.amount : m.kind === 'adjustment' ? +m.amount : 0), 0);
  const spent = results.reduce((a, r) => a + Number(r.spend), 0);
  const requests = live.filter((m) => m.kind === 'request').map((r) => {
    const paid = live.filter((m) => m.kind === 'receipt' && m.request_id === r.id).reduce((a, m) => a + Number(m.amount), 0);
    return { ...r, paid, open: Math.max(0, Number(r.amount) - paid) };
  });
  const pending = requests.reduce((a, r) => a + r.open, 0);
  return { received, spent, balance: received - spent, pending, requests };
}

export interface Totals { spend: number; impressions: number; reach: number; clicks: number; leads: number; messages: number; sales: number; sales_value: number }
export const emptyTotals = (): Totals => ({ spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, messages: 0, sales: 0, sales_value: 0 });
export function sumResults(rows: MkResult[]): Totals {
  const t = emptyTotals();
  for (const r of rows) for (const k of Object.keys(t) as (keyof Totals)[]) t[k] += Number(r[k] ?? 0);
  return t;
}
/** Results = leads + messages + sales — what the client usually means by "results". */
export const resultsOf = (t: Totals) => t.leads + t.messages + t.sales;

export async function loadMarketing(clientId: string): Promise<MkData> {
  const must = async (q: PromiseLike<{ data: any; error: any }>) => { const { data, error } = await q; if (error) throw error; return data; };
  const [settings, posts, campaigns, results, reports, money, budget, claims] = await Promise.all([
    must(db().from('mk_clients').select('*').eq('client_id', clientId).maybeSingle()),
    must(db().from('mk_posts').select('*').eq('client_id', clientId).order('scheduled_for', { ascending: false }).limit(1000)),
    must(db().from('mk_campaigns').select('*').eq('client_id', clientId).order('start_date', { ascending: false }).limit(500)),
    must(db().from('mk_results').select('*').eq('client_id', clientId).order('day').limit(20000)),
    must(db().from('mk_reports').select('*').eq('client_id', clientId).is('archived_at', null).order('created_at', { ascending: false }).limit(500)),
    must(db().from('mk_money').select('*').eq('client_id', clientId).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000)),
    must(db().from('mk_budget').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(2000)),
    must(db().from('mk_payment_claims').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(500)),
  ]);
  return { settings, posts, campaigns, results, reports, money, budget, claims };
}

export const mkApi = {
  saveClient: (clientId: string, p: Record<string, unknown>) => db().rpc('mk_client_save', { p_client: clientId, p }).then(ok),
  setTeam: (clientId: string, employeeIds: string[]) => db().rpc('mk_team_set', { p_client: clientId, p_employees: employeeIds }).then(ok),
  savePost: (id: string | null, clientId: string | null, p: Record<string, unknown>) => db().rpc('mk_post_save', { p_id: id, p_client: clientId, p }).then(ok) as Promise<string>,
  postAction: (id: string, action: string, p: Record<string, unknown> = {}) => db().rpc('mk_post_action', { p_id: id, p_action: action, p }).then(ok),
  saveCampaign: (id: string | null, clientId: string | null, p: Record<string, unknown>) => db().rpc('mk_campaign_save', { p_id: id, p_client: clientId, p }).then(ok) as Promise<string>,
  saveResults: (campaignId: string, rows: Record<string, unknown>[]) => db().rpc('mk_results_save', { p_campaign: campaignId, p_rows: rows }).then(ok) as Promise<number>,
  removeResult: (campaignId: string, day: string) => db().rpc('mk_results_remove', { p_campaign: campaignId, p_day: day }).then(ok),
  saveReport: (id: string | null, clientId: string | null, p: Record<string, unknown>) => db().rpc('mk_report_save', { p_id: id, p_client: clientId, p }).then(ok) as Promise<string>,
  publishReport: (id: string) => db().rpc('mk_report_publish', { p_id: id }).then(ok),
  addMoney: (clientId: string, p: Record<string, unknown>) => db().rpc('mk_money_add', { p_client: clientId, p }).then(ok),
  voidMoney: (id: string, reason: string) => db().rpc('mk_money_void', { p_id: id, p_reason: reason }).then(ok),
  giveBudget: (clientId: string, employeeId: string, amount: number, note: string, requestId: string | null) =>
    db().rpc('mk_budget_give', { p_client: clientId, p_employee: employeeId, p_amount: amount, p_note: note || null, p_request: requestId }).then(ok),
  returnBudget: (clientId: string, employeeId: string, amount: number, note: string) =>
    db().rpc('mk_budget_return', { p_client: clientId, p_employee: employeeId, p_amount: amount, p_note: note || null }).then(ok),
  requestBudget: (clientId: string, amount: number, note: string) => db().rpc('mk_budget_request', { p_client: clientId, p_amount: amount, p_note: note || null }).then(ok),
  submitClaim: (requestId: string | null, amount: number, paidOn: string, method: string, reference: string, note: string) =>
    db().rpc('mk_claim_submit', { p_request: requestId, p_amount: amount, p_paid_on: paidOn, p_method: method, p_reference: reference || null, p_note: note || null }).then(ok),
  decideClaim: (id: string, action: 'confirm' | 'reject', reason: string) => db().rpc('mk_claim_decide', { p_id: id, p_action: action, p_reason: reason || null }).then(ok),
  decideBudget: (id: string, action: 'decline' | 'void', reason: string) => db().rpc('mk_budget_decide', { p_id: id, p_action: action, p_reason: reason || null }).then(ok),
};
function ok({ data, error }: { data: any; error: any }) { if (error) throw error; return data; }

/** Employee: does this person work on any marketing client? (drives the nav item) */
export function useMarketingAccess(enabled: boolean) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void db().rpc('my_marketing_access').then(({ data }: any) => { if (alive) setOn(data === true); });
    return () => { alive = false; };
  }, [enabled]);
  return on;
}

/** Client portal: is marketing switched on for this client? */
export function useClientMarketing(clientId: string | null | undefined) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!clientId) return;
    let alive = true;
    void db().from('mk_clients').select('client_id').eq('client_id', clientId).maybeSingle().then(({ data }: any) => { if (alive) setOn(!!data); });
    return () => { alive = false; };
  }, [clientId]);
  return on;
}

/* ------------------------------------------------------------------ CSV import from Ads Manager exports */

const HEADERS: Record<string, string[]> = {
  day: ['day', 'date', 'reporting starts', 'reporting start', 'reporting_starts'],
  spend: ['amount spent (inr)', 'amount spent', 'spend', 'cost', 'amount_spent'],
  impressions: ['impressions', 'impr.', 'impr'],
  reach: ['reach'],
  clicks: ['link clicks', 'clicks', 'clicks (all)'],
  leads: ['leads', 'results', 'conversions', 'on-facebook leads', 'website leads'],
  messages: ['messaging conversations started', 'messages', 'new messaging connections'],
  sales: ['purchases', 'sales'],
  sales_value: ['purchases conversion value', 'conv. value', 'conversion value', 'sales value'],
};

function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
function toIsoDay(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(t); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA');
}
/** Reads a daily-breakdown CSV (Meta Ads Manager or Google Ads export). Rows with the same day are added together. */
export function parseResultsCsv(text: string): { rows: Record<string, number | string>[]; matched: string[]; error?: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], matched: [], error: 'The file has no data rows.' };
  let hi = lines.findIndex((l) => /date|day|reporting/i.test(l));
  if (hi < 0) hi = 0;
  const head = splitCsv(lines[hi]).map((h) => h.toLowerCase().replace(/\s+/g, ' '));
  const col: Partial<Record<keyof typeof HEADERS, number>> = {};
  for (const k of Object.keys(HEADERS) as (keyof typeof HEADERS)[]) {
    const i = head.findIndex((h) => HEADERS[k].includes(h));
    if (i >= 0) col[k] = i;
  }
  if (col.day == null) return { rows: [], matched: [], error: 'No date column found. Export with a daily breakdown (Breakdown → By time → Day).' };
  if (col.spend == null) return { rows: [], matched: [], error: 'No spend / amount spent column found.' };
  const byDay = new Map<string, Record<string, number | string>>();
  for (const l of lines.slice(hi + 1)) {
    const cells = splitCsv(l);
    const day = toIsoDay(cells[col.day!] ?? '');
    if (!day) continue;
    const row = byDay.get(day) ?? { day, spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, messages: 0, sales: 0, sales_value: 0 };
    for (const k of Object.keys(col) as (keyof typeof HEADERS)[]) {
      if (k === 'day') continue;
      const v = Number(String(cells[col[k]!] ?? '').replace(/[₹,\s]/g, '').replace(/^--$/, '0'));
      if (Number.isFinite(v)) row[k] = Math.max(0, Number(row[k] ?? 0) + v);
    }
    byDay.set(day, row);
  }
  return { rows: [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day))), matched: Object.keys(col).filter((k) => k !== 'day') };
}

/** Employees whose designation is Performance Marketing (they can hold budgets and run campaigns). */
export function useMarketers(enabled: boolean) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void db().from('designations').select('id').eq('marketing_role', true).then(({ data }: any) => { if (alive) setIds((data ?? []).map((d: any) => d.id)); });
    return () => { alive = false; };
  }, [enabled]);
  return ids;
}
