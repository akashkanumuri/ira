// Work patterns: how a person works (where, when, how much, pay), dated. The database is the authority
// (employee_work_rules + private.day_rules, see 20261029090000_work_patterns.sql); this file holds the form model,
// the plain-English summary and the same validation the database enforces, so mistakes show before saving.
import { supabase } from './supabase';

const db = supabase as any;

export type EmploymentType = 'full_time' | 'part_time' | 'intern' | 'freelancer' | 'project_based';
export type LocationMode = 'office' | 'hybrid' | 'remote';
export type ScheduleType = 'fixed' | 'flexible' | 'flexible_core' | 'split';
export type FeatureKey = 'attendance' | 'my_time' | 'leave' | 'wfh' | 'holidays' | 'payroll' | 'payouts' | 'client_projects';

export interface WorkRules {
  employment_type: EmploymentType;
  probation_end: string | null;
  engagement_end: string | null;
  project_ids: string[];
  access_end_mode: 'never' | 'end_date' | 'project_close';

  location_mode: LocationMode;
  office_days_count: number | null;
  office_days_period: 'week' | 'month';
  must_come_days: number[];
  extra_wfh: 'not_allowed' | 'approval' | 'free';
  geofence_required: boolean;
  field_visit_allowed: boolean;

  working_days: number[];
  saturday_off: 'none' | 'first_third' | 'second_fourth' | 'all';
  follows_holidays: boolean;
  leave_mode: 'standard' | 'none';

  schedule_type: ScheduleType;
  shift_start: string | null;
  shift_end: string | null;
  shift2_start: string | null;
  shift2_end: string | null;
  core_start: string | null;
  core_end: string | null;
  full_day_minutes: number;
  half_day_minutes: number;
  absent_below_minutes: number;
  late_grace_minutes: number | null;
  early_grace_minutes: number | null;
  break_minutes: number | null;
  earliest_checkin: string | null;
  auto_checkout: 'none' | 'shift_end' | 'midnight';
  extra_hours: 'ignore' | 'show' | 'approval' | 'paid';

  pay_type: 'monthly' | 'hourly' | 'stipend' | 'per_project' | 'per_milestone' | 'per_deliverable';
  pay_rate: number | null;
  tds_percent: number | null;

  features: Partial<Record<FeatureKey, boolean>>;
}

export interface WorkRulesRow extends WorkRules { id: string; employee_id: string; effective_from: string }
export interface WorkTemplate { id: string; name: string; description: string | null; rules: Partial<WorkRules>; is_builtin: boolean; sort_order: number }

export const DEFAULT_RULES: WorkRules = {
  employment_type: 'full_time', probation_end: null, engagement_end: null, project_ids: [], access_end_mode: 'never',
  location_mode: 'office', office_days_count: null, office_days_period: 'week', must_come_days: [], extra_wfh: 'approval',
  geofence_required: true, field_visit_allowed: false,
  working_days: [1, 2, 3, 4, 5, 6], saturday_off: 'none', follows_holidays: true, leave_mode: 'standard',
  schedule_type: 'fixed', shift_start: '09:00', shift_end: '18:00', shift2_start: null, shift2_end: null, core_start: null, core_end: null,
  full_day_minutes: 480, half_day_minutes: 240, absent_below_minutes: 0, late_grace_minutes: null, early_grace_minutes: null,
  break_minutes: null, earliest_checkin: null, auto_checkout: 'none', extra_hours: 'show',
  pay_type: 'monthly', pay_rate: null, tds_percent: null, features: {},
};

export const DAYS = [
  { n: 1, short: 'Mon' }, { n: 2, short: 'Tue' }, { n: 3, short: 'Wed' }, { n: 4, short: 'Thu' },
  { n: 5, short: 'Fri' }, { n: 6, short: 'Sat' }, { n: 7, short: 'Sun' },
];

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  full_time: 'Full-time', part_time: 'Part-time', intern: 'Intern', freelancer: 'Freelancer', project_based: 'Project-based',
};
export const LOCATION_LABEL: Record<LocationMode, string> = { office: 'Office', hybrid: 'Hybrid', remote: 'Remote' };
export const SCHEDULE_LABEL: Record<ScheduleType, string> = {
  fixed: 'Fixed shift', flexible: 'Flexible hours', flexible_core: 'Flexible with core hours', split: 'Split shift',
};
export const PAY_LABEL: Record<WorkRules['pay_type'], string> = {
  monthly: 'Monthly salary', hourly: 'Hourly', stipend: 'Stipend', per_project: 'Per project', per_milestone: 'Per milestone', per_deliverable: 'Per deliverable',
};
export const FEATURE_LABEL: Record<FeatureKey, string> = {
  attendance: 'Attendance', my_time: 'My time', leave: 'Leave', wfh: 'Work from home', holidays: 'Holidays',
  payroll: 'Payroll', payouts: 'Payouts', client_projects: 'Client projects',
};

const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
const isNonEmployee = (r: WorkRules) => r.employment_type === 'freelancer' || r.employment_type === 'project_based';

/** Normalise a database row / template (times as HH:MM, arrays sorted, missing fields defaulted). */
export function normalizeRules(raw: Partial<WorkRules> | null | undefined): WorkRules {
  const r = { ...DEFAULT_RULES, ...(raw ?? {}) } as WorkRules;
  for (const k of ['shift_start', 'shift_end', 'shift2_start', 'shift2_end', 'core_start', 'core_end', 'earliest_checkin'] as const) {
    r[k] = r[k] ? hm(r[k]) : null;
  }
  r.working_days = [...new Set((r.working_days ?? []).map(Number))].sort((a, b) => a - b);
  r.must_come_days = [...new Set((r.must_come_days ?? []).map(Number))].sort((a, b) => a - b);
  r.project_ids = r.project_ids ?? [];
  r.features = r.features ?? {};
  r.pay_rate = r.pay_rate == null ? null : Number(r.pay_rate);
  r.tds_percent = r.tds_percent == null ? null : Number(r.tds_percent);
  return r;
}

/** Features the settings switch on (before overrides) — mirrors private.work_features. */
export function derivedFeatures(r: WorkRules): Record<FeatureKey, boolean> {
  const emp = !isNonEmployee(r);
  return {
    attendance: emp,
    my_time: true,
    leave: emp && r.leave_mode !== 'none',
    wfh: emp && (r.location_mode === 'office' || (r.location_mode === 'hybrid' && (r.extra_wfh === 'approval' || r.must_come_days.length > 0))),
    holidays: emp && r.follows_holidays,
    payroll: ['full_time', 'part_time', 'intern'].includes(r.employment_type),
    payouts: !emp,
    client_projects: true,
  };
}
export const effectiveFeatures = (r: WorkRules) => ({ ...derivedFeatures(r), ...r.features }) as Record<FeatureKey, boolean>;

const hours = (m: number) => (m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} m`);

function daysText(r: WorkRules) {
  const d = r.working_days;
  const names = d.map((n) => DAYS[n - 1].short);
  const contiguous = d.length > 1 && d.every((n, i) => i === 0 || n === d[i - 1] + 1);
  let s = contiguous ? `${names[0]}–${names[names.length - 1]}` : names.join(', ');
  if (d.includes(6) && r.saturday_off !== 'none') {
    s += r.saturday_off === 'all' ? ' (Saturdays off)' : r.saturday_off === 'second_fourth' ? ' (2nd & 4th Saturday off)' : ' (1st & 3rd Saturday off)';
  }
  return s;
}

/** One line a person can check before saving. */
export function rulesSummary(r: WorkRules): string {
  const parts: string[] = [EMPLOYMENT_LABEL[r.employment_type]];
  if (r.location_mode === 'hybrid') {
    let h = `Hybrid, any ${r.office_days_count ?? '?'} office day${r.office_days_count === 1 ? '' : 's'} a ${r.office_days_period}`;
    if (r.must_come_days.length) h += `, must come ${r.must_come_days.map((n) => DAYS[n - 1].short).join('/')}`;
    parts.push(h);
  } else parts.push(r.location_mode === 'office' ? 'Office' : 'Remote');
  if (!isNonEmployee(r)) {
    const t = r.schedule_type === 'fixed' ? `fixed ${r.shift_start}–${r.shift_end}`
      : r.schedule_type === 'split' ? `split ${r.shift_start}–${r.shift_end} & ${r.shift2_start}–${r.shift2_end}`
        : r.schedule_type === 'flexible_core' ? `flexible with core ${r.core_start}–${r.core_end}` : 'flexible hours';
    parts.push(`${t}, ${hours(r.full_day_minutes)} a day`);
    parts.push(daysText(r));
    parts.push(r.follows_holidays ? 'follows company holidays' : 'no company holidays');
  } else {
    parts.push('no attendance');
  }
  parts.push(PAY_LABEL[r.pay_type].toLowerCase() + (r.pay_rate != null && r.pay_type !== 'monthly' ? ` ₹${r.pay_rate.toLocaleString('en-IN')}` : ''));
  if (r.engagement_end) parts.push(`until ${new Date(`${r.engagement_end}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`);
  return parts.join(' · ');
}

/** Short label for tables: "Hybrid 3d/wk · Part-time". */
export function rulesBadge(r: WorkRules): string {
  const where = r.location_mode === 'hybrid' ? `Hybrid ${r.office_days_count ?? '?'}d/${r.office_days_period === 'week' ? 'wk' : 'mo'}` : LOCATION_LABEL[r.location_mode];
  return r.employment_type === 'full_time' ? where : `${where} · ${EMPLOYMENT_LABEL[r.employment_type]}`;
}

/** Same checks the database makes; returns the first problem or null. */
export function validateRules(r: WorkRules, effectiveFrom?: string): string | null {
  if (!r.working_days.length) return 'Pick at least one working day.';
  if (r.location_mode === 'hybrid') {
    if (!r.office_days_count) return 'Set how many office days a hybrid employee needs.';
    if (r.office_days_period === 'week' && r.office_days_count > r.working_days.length) return `Office days a week (${r.office_days_count}) can’t be more than working days (${r.working_days.length}).`;
    if (r.office_days_period === 'month' && r.office_days_count > 27) return 'Office days a month is too high.';
    if (r.must_come_days.some((d) => !r.working_days.includes(d))) return 'Must-come days have to be working days.';
    if (r.office_days_period === 'week' && r.must_come_days.length > r.office_days_count) return 'More must-come days than office days a week.';
  }
  if (!isNonEmployee(r)) {
    if ((r.schedule_type === 'fixed' || r.schedule_type === 'split') && (!r.shift_start || !r.shift_end)) return 'Set the shift start and end.';
    if (r.schedule_type === 'split' && (!r.shift2_start || !r.shift2_end)) return 'Set the second shift start and end.';
    if (r.schedule_type === 'flexible_core' && (!r.core_start || !r.core_end || r.core_end <= r.core_start)) return 'Set core hours (end after start).';
  }
  if (r.half_day_minutes >= r.full_day_minutes) return 'Half-day hours must be less than full-day hours.';
  if (r.absent_below_minutes > r.half_day_minutes) return 'The absent threshold must be at or below the half-day threshold.';
  if (r.employment_type === 'project_based' && !r.project_ids.length && !r.engagement_end) return 'A project-based person needs a project or an end date.';
  if (r.employment_type === 'intern' && !r.engagement_end) return 'Set the internship end date.';
  if (r.access_end_mode === 'end_date' && !r.engagement_end) return 'Set the end date access should end on.';
  if (r.access_end_mode === 'project_close' && !r.project_ids.length) return 'Link a project for access to end when it closes.';
  if (r.engagement_end && effectiveFrom && r.engagement_end < effectiveFrom) return 'End date is before the start date.';
  if (['hourly', 'per_project', 'per_milestone', 'per_deliverable'].includes(r.pay_type) && r.pay_rate == null) return 'Set the pay rate.';
  if (r.pay_type === 'hourly' && r.features.my_time === false) return 'Hourly pay needs time tracking switched on.';
  return null;
}

/** For the legacy employee columns the admin function still needs. */
export function legacyFields(r: WorkRules) {
  const start = r.schedule_type === 'flexible_core' ? r.core_start : r.shift_start;
  const end = r.schedule_type === 'flexible_core' ? r.core_end : r.schedule_type === 'split' ? r.shift2_end : r.shift_end;
  return { workMode: r.location_mode === 'remote' ? 'remote' : 'office', shiftStart: start || '09:00', shiftEnd: end || '18:00' };
}

/* ------------------------------------------------------------------ data */

const RULE_COLS = 'id,employee_id,effective_from,employment_type,probation_end,engagement_end,project_ids,access_end_mode,location_mode,office_days_count,office_days_period,must_come_days,extra_wfh,geofence_required,field_visit_allowed,working_days,saturday_off,follows_holidays,leave_mode,schedule_type,shift_start,shift_end,shift2_start,shift2_end,core_start,core_end,full_day_minutes,half_day_minutes,absent_below_minutes,late_grace_minutes,early_grace_minutes,break_minutes,earliest_checkin,auto_checkout,extra_hours,pay_type,pay_rate,tds_percent,features';

const toRow = (d: any): WorkRulesRow => ({ ...normalizeRules(d), id: d.id, employee_id: d.employee_id, effective_from: d.effective_from });

/** All rows for one employee, newest first. null = feature not installed yet. */
export async function fetchRulesHistory(employeeId: string): Promise<WorkRulesRow[] | null> {
  const { data, error } = await db.from('employee_work_rules').select(RULE_COLS).eq('employee_id', employeeId).order('effective_from', { ascending: false });
  if (error) return null;
  return (data ?? []).map(toRow);
}

/** Current rules for every employee the viewer can see (admins: all). */
export async function fetchCurrentRulesMap(onDate: string): Promise<Map<string, WorkRulesRow> | null> {
  const { data, error } = await db.from('employee_work_rules').select(RULE_COLS).lte('effective_from', onDate).order('effective_from', { ascending: false });
  if (error) return null;
  const m = new Map<string, WorkRulesRow>();
  for (const d of data ?? []) if (!m.has(d.employee_id)) m.set(d.employee_id, toRow(d));
  return m;
}

export const currentOf = (rows: WorkRulesRow[], onDate: string) => rows.find((r) => r.effective_from <= onDate) ?? null;

export async function saveRules(employeeId: string, rules: WorkRules, effectiveFrom: string): Promise<string> {
  const { data, error } = await db.rpc('admin_set_work_rules', { p_employee_id: employeeId, p_rules: rules, p_effective_from: effectiveFrom });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function fetchTemplates(): Promise<WorkTemplate[] | null> {
  const { data, error } = await db.from('work_rule_templates').select('id,name,description,rules,is_builtin,sort_order').order('sort_order').order('name');
  if (error) return null;
  return data as WorkTemplate[];
}

export async function saveTemplate(name: string, rules: WorkRules, description?: string | null): Promise<void> {
  const r = { ...rules } as Partial<WorkRules>;
  delete r.probation_end; delete r.engagement_end; delete r.project_ids; // person-specific
  const { error } = await db.from('work_rule_templates').insert({ name: name.trim(), description: description || rulesSummary(normalizeRules(r)), rules: r, sort_order: 200 });
  if (error) throw new Error(error.code === '23505' ? 'A template with that name already exists.' : error.message);
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await db.from('work_rule_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function fetchProjectsLite(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db.from('projects').select('id,name,status').is('deleted_at', null).order('name');
  if (error) return [];
  return (data ?? []).map((p: any) => ({ id: p.id, name: p.name }));
}
