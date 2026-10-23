import { supabase } from './supabase';
import { isMissingSchema } from './tasks';
import type { Tone } from '../ui';

/** KRA / performance review / growth history data access (see 20261023120000_performance.sql). */

export type CycleStatus = 'draft' | 'open' | 'closed';
export type PeriodType = 'monthly' | 'quarterly' | 'half_yearly' | 'annual';
export type ReviewStatus = 'self_review' | 'manager_review' | 'finalized';
export type MilestoneKind = 'promotion' | 'role_change' | 'recognition' | 'warning' | 'improvement_plan' | 'training' | 'certification' | 'note';

export interface Cycle {
  id: string; name: string; period_type: PeriodType; start_date: string; end_date: string; status: CycleStatus;
  self_review_due: string | null; opened_at: string | null; closed_at: string | null; created_at: string;
}
export interface Kra {
  id: string; cycle_id: string; employee_id: string; title: string; description: string | null; measurement: string | null;
  target: string | null; weightage: number; actual: string | null; self_score: number | null; self_comment: string | null;
  manager_score: number | null; manager_comment: string | null; final_score: number | null; sort_order: number;
}
export interface Review {
  id: string; cycle_id: string; employee_id: string; manager_id: string | null; status: ReviewStatus;
  self_summary: string | null; manager_summary: string | null; strengths: string | null; improvements: string | null;
  overall_score: number | null; rating: string | null; self_submitted_at: string | null; manager_submitted_at: string | null; finalized_at: string | null;
}
export interface Milestone {
  id: string; employee_id: string; kind: MilestoneKind; title: string; details: string | null; effective_date: string;
  from_value: string | null; to_value: string | null; visible_to_employee: boolean; created_at: string;
}
export interface PromotionCandidate {
  employee_id: string; name: string; designation: string | null; months_in_role: number; reviews: number; average_score: number; last_promotion: string | null;
}
export interface PerformanceSettings { promotion_min_score: number; promotion_min_reviews: number; promotion_min_months: number }

export const PERIOD_LABEL: Record<PeriodType, string> = { monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', annual: 'Annual' };
export const CYCLE_STATUS: Record<CycleStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'ink' }, open: { label: 'Open', tone: 'brand' }, closed: { label: 'Closed', tone: 'mint' },
};
export const REVIEW_STATUS: Record<ReviewStatus, { label: string; tone: Tone }> = {
  self_review: { label: 'Self-review', tone: 'amber' }, manager_review: { label: 'Manager review', tone: 'brand' }, finalized: { label: 'Finalized', tone: 'mint' },
};
export const MILESTONE_KIND: Record<MilestoneKind, { label: string; tone: Tone; hrOnly: boolean }> = {
  promotion: { label: 'Promotion', tone: 'mint', hrOnly: true },
  role_change: { label: 'Role change', tone: 'brand', hrOnly: true },
  recognition: { label: 'Recognition', tone: 'amber', hrOnly: false },
  training: { label: 'Training', tone: 'sky', hrOnly: false },
  certification: { label: 'Certification', tone: 'sky', hrOnly: false },
  warning: { label: 'Warning', tone: 'rose', hrOnly: true },
  improvement_plan: { label: 'Improvement plan', tone: 'rose', hrOnly: true },
  note: { label: 'Note', tone: 'ink', hrOnly: false },
};

export const ratingFor = (score: number | null | undefined) =>
  score == null ? null : score >= 90 ? 'Outstanding' : score >= 75 ? 'Exceeds expectations' : score >= 60 ? 'Meets expectations' : score >= 40 ? 'Needs improvement' : 'Unsatisfactory';
export const scoreTone = (score: number | null | undefined): Tone =>
  score == null ? 'ink' : score >= 75 ? 'mint' : score >= 60 ? 'brand' : score >= 40 ? 'amber' : 'rose';

/** Weighted score from whichever scores exist (null until every KRA has one). */
export function weighted(kras: Kra[], pick: (k: Kra) => number | null | undefined) {
  if (!kras.length) return null;
  let w = 0; let s = 0;
  for (const k of kras) {
    const v = pick(k);
    if (v == null) return null;
    w += Number(k.weightage); s += Number(k.weightage) * Number(v);
  }
  return w > 0 ? Math.round((s / w) * 100) / 100 : null;
}

const db = supabase as any;
const NOT_READY = 'Performance reviews switch on once the performance database update is applied.';

async function q<T>(p: Promise<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(isMissingSchema(error) ? NOT_READY : error.message);
  return data;
}
async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(isMissingSchema(error) ? NOT_READY : error.message);
  return data as T;
}

export const perfApi = {
  /** false when the migration hasn't been applied yet */
  async available() {
    const { error } = await db.from('performance_cycles').select('id', { head: true, count: 'exact' }).limit(1);
    return !error || !isMissingSchema(error);
  },
  cycles: () => q<Cycle[]>(db.from('performance_cycles').select('*').order('start_date', { ascending: false })),
  kras: (cycleId: string) => q<Kra[]>(db.from('kras').select('*').eq('cycle_id', cycleId).order('sort_order').order('created_at')),
  krasFor: (employeeIds: string[]) => q<Kra[]>(db.from('kras').select('*').in('employee_id', employeeIds).order('sort_order').order('created_at')),
  reviews: (cycleId: string) => q<Review[]>(db.from('performance_reviews').select('*').eq('cycle_id', cycleId)),
  reviewsFor: (employeeIds: string[]) => q<Review[]>(db.from('performance_reviews').select('*').in('employee_id', employeeIds)),
  milestones: (employeeId: string) => q<Milestone[]>(db.from('employee_milestones').select('*').eq('employee_id', employeeId).order('effective_date', { ascending: false })),
  salaryHistory: (employeeId: string) =>
    q<Array<{ id: string; monthly_salary: number; effective_from: string }>>(db.from('salary_history').select('id, monthly_salary, effective_from').eq('employee_id', employeeId).order('effective_from', { ascending: false })),
  settings: () => q<PerformanceSettings | null>(db.from('performance_settings').select('promotion_min_score, promotion_min_reviews, promotion_min_months').eq('id', true).maybeSingle()),
  saveSettings: (s: PerformanceSettings) => q(db.from('performance_settings').update(s).eq('id', true).select('id').maybeSingle()),
  candidates: () => rpc<PromotionCandidate[]>('performance_promotion_candidates'),

  createCycle: (c: Pick<Cycle, 'name' | 'period_type' | 'start_date' | 'end_date' | 'self_review_due'>) =>
    q<Cycle>(db.from('performance_cycles').insert(c).select('*').single()),
  deleteDraftCycle: (id: string) => q(db.from('performance_cycles').delete().eq('id', id).eq('status', 'draft')),
  /** Replace one employee's KRA set in a draft cycle. */
  async saveKras(cycleId: string, employeeId: string, rows: Array<Partial<Kra> & { title: string; weightage: number }>, existing: Kra[]) {
    const keep = new Set(rows.filter((r) => r.id).map((r) => r.id as string));
    const removed = existing.filter((k) => !keep.has(k.id)).map((k) => k.id);
    if (removed.length) await q(db.from('kras').delete().in('id', removed));
    for (const [i, r] of rows.entries()) {
      const row = { title: r.title.trim(), description: r.description?.trim() || null, measurement: r.measurement?.trim() || null, target: r.target?.trim() || null, weightage: Number(r.weightage), sort_order: i };
      if (r.id) await q(db.from('kras').update(row).eq('id', r.id));
      else await q(db.from('kras').insert({ ...row, cycle_id: cycleId, employee_id: employeeId }));
    }
  },
  copyKras: (cycleId: string, fromEmployee: string, designationId: string) =>
    rpc<number>('performance_copy_kras', { p_cycle_id: cycleId, p_from_employee: fromEmployee, p_designation_id: designationId }),
  openCycle: (id: string) => rpc<number>('performance_open_cycle', { p_cycle_id: id }),
  closeCycle: (id: string) => rpc('performance_close_cycle', { p_cycle_id: id }),
  selfAssess: (kraId: string, actual: string, score: number, comment?: string) =>
    rpc('performance_self_assess', { p_kra_id: kraId, p_actual: actual, p_score: score, p_comment: comment ?? null }),
  submitSelf: (reviewId: string, summary?: string) => rpc('performance_submit_self', { p_review_id: reviewId, p_summary: summary ?? null }),
  managerAssess: (kraId: string, score: number, comment?: string) =>
    rpc('performance_manager_assess', { p_kra_id: kraId, p_score: score, p_comment: comment ?? null }),
  submitManager: (reviewId: string, summary: string, strengths?: string, improvements?: string) =>
    rpc('performance_submit_manager', { p_review_id: reviewId, p_summary: summary, p_strengths: strengths ?? null, p_improvements: improvements ?? null }),
  finalize: (reviewId: string, overrides: Record<string, number>) => rpc<number>('performance_finalize', { p_review_id: reviewId, p_overrides: overrides }),
  addMilestone: (m: { employeeId: string; kind: MilestoneKind; title: string; date: string; details?: string; from?: string; to?: string; visible?: boolean }) =>
    rpc<string>('employee_add_milestone', {
      p_employee_id: m.employeeId, p_kind: m.kind, p_title: m.title, p_effective_date: m.date,
      p_details: m.details ?? null, p_from: m.from ?? null, p_to: m.to ?? null, p_visible: m.visible ?? true,
    }),
};
