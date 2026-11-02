import React, { useState } from 'react';
import { BookmarkPlus, Briefcase, Building2, CalendarDays, ChevronDown, Clock3, GraduationCap, Home, Laptop, MapPin, Shuffle, Sparkles, Timer, ToggleRight } from 'lucide-react';
import {
  DAYS, FEATURE_LABEL, PAY_LABEL, SCHEDULE_LABEL, derivedFeatures, normalizeRules, rulesSummary, saveTemplate, validateRules,
  type FeatureKey, type WorkRules, type WorkTemplate,
} from '../../lib/workRules';
import { notify } from '../../lib/toast';
import { cx } from '../../ui';

/* ---------- small controls ---------- */

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.id} type="button" title={o.hint} onClick={() => onChange(o.id)}
          className={cx('rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
            value === o.id ? 'border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-100' : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DayPicker({ value, onChange, allowed }: { value: number[]; onChange: (v: number[]) => void; allowed?: number[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DAYS.map((d) => {
        const on = value.includes(d.n);
        const disabled = allowed ? !allowed.includes(d.n) : false;
        return (
          <button key={d.n} type="button" disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== d.n) : [...value, d.n].sort((a, b) => a - b))}
            className={cx('w-12 rounded-xl border py-1.5 text-[12.5px] font-bold transition-colors disabled:opacity-35',
              on ? 'border-brand-500 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300')}>
            {d.short}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cx('relative w-10 h-[22px] rounded-full transition-colors shrink-0', on ? 'bg-brand-600' : 'bg-ink-200')}>
      <span className={cx('absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform', on && 'translate-x-[18px]')} />
    </button>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[190px_1fr] sm:items-start py-2.5">
      <div className="pt-1">
        <p className="text-[13px] font-semibold text-ink-800">{label}</p>
        {hint && <p className="text-[11.5px] text-ink-400 leading-snug mt-0.5">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Block({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white px-4 py-2">
      <p className="flex items-center gap-2 pt-2 pb-1 text-[12px] font-bold uppercase tracking-wide text-ink-500">{icon}{title}</p>
      <div className="divide-y divide-ink-50">{children}</div>
    </div>
  );
}

const Time = ({ value, onChange, label }: { value: string | null; onChange: (v: string | null) => void; label: string }) => (
  <input type="time" aria-label={label} className="input tnum !w-[120px] !min-h-[38px] !py-1.5" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
);
const Num = ({ value, onChange, min = 0, max, step = 1, label, width = '!w-[100px]', placeholder }: { value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; label: string; width?: string; placeholder?: string }) => (
  <input type="number" aria-label={label} className={cx('input tnum !min-h-[38px] !py-1.5', width)} min={min} max={max} step={step} placeholder={placeholder}
    value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
);
const HoursInput = ({ minutes, onChange, label }: { minutes: number; onChange: (m: number) => void; label: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <input type="number" aria-label={label} className="input tnum !w-[90px] !min-h-[38px] !py-1.5" min={0} max={24} step={0.25}
      value={Math.round((minutes / 60) * 100) / 100} onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * 60))} />
    <span className="text-[12.5px] text-ink-500">hours</span>
  </span>
);

/* ---------- the six employee types (agreed whiteboard) ---------- */

export type BoardType = 'office' | 'hybrid' | 'remote' | 'part_time' | 'intern' | 'freelancer';

export const BOARD_TYPES: { id: BoardType; label: string; line: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'office', label: 'Standard office', line: 'Office · fixed shift · monthly', icon: Building2 },
  { id: 'hybrid', label: 'Hybrid', line: 'Office + home · fixed shift · monthly', icon: Shuffle },
  { id: 'remote', label: 'Remote', line: 'Home · fixed shift · monthly', icon: Home },
  { id: 'part_time', label: 'Part-time', line: 'Home or office · flexible hours · hourly', icon: Timer },
  { id: 'intern', label: 'Intern', line: 'Office · fixed · stipend', icon: GraduationCap },
  { id: 'freelancer', label: 'Project-based freelancer', line: 'Home · flexible hours · per project', icon: Laptop },
];

/** Which of the six a stored pattern is. */
export function boardTypeOf(r: WorkRules): BoardType {
  if (r.employment_type === 'project_based' || r.employment_type === 'freelancer') return 'freelancer';
  if (r.employment_type === 'intern') return 'intern';
  if (r.employment_type === 'part_time') return 'part_time';
  return r.location_mode === 'hybrid' ? 'hybrid' : r.location_mode === 'remote' ? 'remote' : 'office';
}

/** Choosing a type fills the main settings for it (person-specific dates/projects are kept). */
function applyBoardType(r: WorkRules, t: BoardType): WorkRules {
  const keep = { probation_end: r.probation_end, engagement_end: r.engagement_end, project_ids: r.project_ids, features: {} };
  const shift = { shift_start: r.shift_start ?? '09:00', shift_end: r.shift_end ?? '18:00' };
  const staff = { leave_mode: 'standard' as const, follows_holidays: true, tds_percent: null, access_end_mode: 'never' as const, extra_hours: 'show' as const };
  const fixedDay = { schedule_type: 'fixed' as const, ...shift, full_day_minutes: 480, half_day_minutes: 240 };
  const flexDay = (h: number) => ({ schedule_type: 'flexible' as const, full_day_minutes: h * 60, half_day_minutes: Math.round(h * 30), absent_below_minutes: 0 });
  const base = normalizeRules({ ...r, ...keep });
  switch (t) {
    case 'office': return normalizeRules({ ...base, ...staff, ...fixedDay, employment_type: 'full_time', location_mode: 'office', office_days_count: null, must_come_days: [], extra_wfh: 'approval', geofence_required: true, pay_type: 'monthly', pay_rate: null });
    case 'hybrid': return normalizeRules({ ...base, ...staff, ...fixedDay, employment_type: 'full_time', location_mode: 'hybrid', office_days_count: r.office_days_count ?? 3, office_days_period: 'week', extra_wfh: 'free', geofence_required: true, pay_type: 'monthly', pay_rate: null });
    case 'remote': return normalizeRules({ ...base, ...staff, ...fixedDay, employment_type: 'full_time', location_mode: 'remote', office_days_count: null, must_come_days: [], extra_wfh: 'free', geofence_required: false, pay_type: 'monthly', pay_rate: null });
    case 'part_time': return normalizeRules({ ...base, ...staff, ...flexDay(4), employment_type: 'part_time', location_mode: r.location_mode === 'office' ? 'office' : 'remote', office_days_count: null, must_come_days: [], extra_hours: 'approval', pay_type: 'hourly' });
    case 'intern': return normalizeRules({ ...base, ...staff, ...fixedDay, employment_type: 'intern', location_mode: 'office', office_days_count: null, must_come_days: [], extra_wfh: 'approval', geofence_required: true, pay_type: 'stipend', pay_rate: null, access_end_mode: 'end_date' });
    case 'freelancer': return normalizeRules({ ...base, ...flexDay(4), employment_type: 'project_based', location_mode: 'remote', office_days_count: null, must_come_days: [], extra_wfh: 'free', geofence_required: false, leave_mode: 'none', follows_holidays: false, pay_type: 'per_project', access_end_mode: base.project_ids.length ? 'project_close' : 'end_date', extra_hours: 'ignore' });
  }
}

/* ---------- editor ---------- */

export interface WorkRulesEditorProps {
  value: WorkRules;
  onChange: (r: WorkRules) => void;
  effectiveFrom: string;
  onEffectiveFrom?: (d: string) => void;
  minEffective?: string;
  templates: WorkTemplate[];
  onTemplatesChanged?: () => void;
  projects: { id: string; name: string }[];
  hidePay?: boolean;
  /** Monthly salary / stipend (stored with the employee's salary history). Omit when editing a template. */
  salary?: string;
  onSalary?: (v: string) => void;
}

export function WorkRulesEditor({ value: r, onChange, effectiveFrom, onEffectiveFrom, minEffective, templates, onTemplatesChanged, projects, hidePay, salary, onSalary }: WorkRulesEditorProps) {
  const set = <K extends keyof WorkRules>(k: K, v: WorkRules[K]) => onChange({ ...r, [k]: v });
  const patch = (p: Partial<WorkRules>) => onChange({ ...r, ...p });
  const [savingTpl, setSavingTpl] = useState(false);
  const [more, setMore] = useState(false);
  const type = boardTypeOf(r);
  const nonEmployee = r.employment_type === 'freelancer' || r.employment_type === 'project_based';
  const derived = derivedFeatures(r);
  const problem = validateRules(r, effectiveFrom);
  const savedTemplates = templates.filter((t) => !t.is_builtin);
  const monthlyPay = r.pay_type === 'monthly' || r.pay_type === 'stipend';

  const applyTemplate = (t: WorkTemplate) => {
    const keep = { probation_end: r.probation_end, engagement_end: r.engagement_end, project_ids: r.project_ids };
    onChange(normalizeRules({ ...t.rules, ...keep }));
    notify(`“${t.name}” applied.`, 'success', 2600);
  };

  async function saveAsTemplate() {
    const name = window.prompt('Name this template (e.g. “Hybrid 4 days, editors”)');
    if (!name?.trim()) return;
    setSavingTpl(true);
    try { await saveTemplate(name, r); notify('Template saved.', 'success'); onTemplatesChanged?.(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Couldn’t save the template.', 'error'); }
    finally { setSavingTpl(false); }
  }

  const scheduleMain: ScheduleKind = r.schedule_type === 'fixed' || r.schedule_type === 'split' ? 'fixed' : 'flexible';
  const setSchedule = (k: ScheduleKind) => patch(k === 'fixed'
    ? { schedule_type: 'fixed', shift_start: r.shift_start ?? '09:00', shift_end: r.shift_end ?? '18:00' }
    : { schedule_type: 'flexible' });

  return (
    <div className="space-y-3">
      {/* 1 — type (required) */}
      <div>
        <p className="text-[12px] font-bold uppercase tracking-wide text-ink-500 mb-2">Employee type <span className="text-rose-500">*</span></p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Employee type">
          {BOARD_TYPES.map((t) => {
            const on = type === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => { if (!on) onChange(applyBoardType(r, t.id)); }}
                className={cx('flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors',
                  on ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-ink-200 bg-white hover:border-ink-300')}>
                <span className={cx('grid place-items-center w-9 h-9 rounded-xl shrink-0', on ? 'bg-brand-600 text-white' : 'bg-ink-50 text-ink-500')}><Icon className="w-4 h-4" /></span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold text-ink-900">{t.label}</span>
                  <span className="block text-[11.5px] text-ink-500 leading-snug">{t.line}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2 — the essentials for that type (all required) */}
      <Block icon={<Briefcase className="w-3.5 h-3.5" />} title="Essentials">
        <Row label="Work location *">
          {type === 'hybrid' ? (
            <div className="space-y-2">
              <span className="inline-flex items-center gap-2 flex-wrap text-[13px] text-ink-700">
                <Num label="Office days" value={r.office_days_count} min={1} max={r.office_days_period === 'week' ? 7 : 27} onChange={(v) => set('office_days_count', v)} width="!w-[72px]" />
                office days
                <Seg value={r.office_days_period} onChange={(v) => set('office_days_period', v)} options={[{ id: 'week', label: 'a week' }, { id: 'month', label: 'a month' }]} />
                · the rest from home
              </span>
              <div>
                <p className="text-[11.5px] text-ink-500 mb-1">Fixed office days (optional — leave empty to let them choose)</p>
                <DayPicker value={r.must_come_days} allowed={r.working_days} onChange={(v) => set('must_come_days', v)} />
              </div>
            </div>
          ) : type === 'part_time' ? (
            <Seg value={r.location_mode === 'office' ? 'office' : 'remote'} onChange={(v) => patch({ location_mode: v, geofence_required: v === 'office', extra_wfh: v === 'office' ? 'approval' : 'free' })}
              options={[{ id: 'remote', label: 'Work from home' }, { id: 'office', label: 'Work from office' }]} />
          ) : (
            <p className="pt-1.5 text-[13px] font-semibold text-ink-800">{type === 'remote' || type === 'freelancer' ? 'Work from home' : 'Work from office'}</p>
          )}
        </Row>
        <Row label="Working days *">
          <div className="space-y-2">
            <DayPicker value={r.working_days} onChange={(v) => patch({ working_days: v, must_come_days: r.must_come_days.filter((d) => v.includes(d)) })} />
            {r.working_days.includes(6) && (
              <Seg value={r.saturday_off} onChange={(v) => set('saturday_off', v)} options={[
                { id: 'none', label: 'Every Saturday' }, { id: 'second_fourth', label: '2nd & 4th Sat off' }, { id: 'first_third', label: '1st & 3rd Sat off' }, { id: 'all', label: 'Saturdays off' },
              ]} />
            )}
          </div>
        </Row>
        <Row label="Timing *">
          <div className="space-y-2">
            <Seg value={scheduleMain} onChange={setSchedule} options={[{ id: 'fixed', label: 'Fixed shift' }, { id: 'flexible', label: 'Flexible hours' }]} />
            {r.schedule_type === 'fixed' && (
              <span className="inline-flex items-center gap-2 text-[13px] text-ink-600"><Time label="Shift start" value={r.shift_start} onChange={(v) => set('shift_start', v)} /> to <Time label="Shift end" value={r.shift_end} onChange={(v) => set('shift_end', v)} />{r.shift_end && r.shift_start && r.shift_end <= r.shift_start && <span className="text-[11.5px] text-ink-400">ends next day</span>}</span>
            )}
            {r.schedule_type === 'flexible' && (
              <span className="inline-flex items-center gap-2 text-[13px] text-ink-600">Any time, <HoursInput label="Hours a day" minutes={r.full_day_minutes} onChange={(m) => { const half = r.half_day_minutes < m ? r.half_day_minutes : Math.round(m / 2); patch({ full_day_minutes: m, half_day_minutes: half, absent_below_minutes: Math.min(r.absent_below_minutes, half) }); }} /> a day</span>
            )}
            {(r.schedule_type === 'split' || r.schedule_type === 'flexible_core') && (
              <p className="text-[12.5px] text-ink-500">{SCHEDULE_LABEL[r.schedule_type]} — set under More settings.</p>
            )}
          </div>
        </Row>
        {!hidePay && (
          <Row label="Pay *">
            <div className="space-y-2">
              {type === 'freelancer' && (
                <Seg value={r.pay_type} onChange={(v) => set('pay_type', v)} options={(['per_project', 'per_milestone', 'per_deliverable', 'hourly'] as const).map((id) => ({ id, label: PAY_LABEL[id] }))} />
              )}
              {monthlyPay ? (
                onSalary ? (
                  <span className="inline-flex items-center gap-2 text-[13px] text-ink-600"><span className="text-ink-500">₹</span>
                    <input type="number" aria-label={r.pay_type === 'stipend' ? 'Monthly stipend' : 'Monthly salary'} className="input tnum !w-[150px] !min-h-[38px] !py-1.5" min={0} step={100} value={salary ?? ''} onChange={(e) => onSalary(e.target.value)} />
                    {r.pay_type === 'stipend' ? 'stipend a month' : 'a month'}</span>
                ) : <p className="pt-1.5 text-[13px] text-ink-700">{PAY_LABEL[r.pay_type]} (amount set per person)</p>
              ) : (
                <span className="inline-flex items-center gap-2 text-[13px] text-ink-600"><span className="text-ink-500">₹</span>
                  <Num label="Pay rate" value={r.pay_rate} step={r.pay_type === 'hourly' ? 10 : 500} width="!w-[150px]" onChange={(v) => set('pay_rate', v)} />
                  {r.pay_type === 'hourly' ? 'an hour' : r.pay_type.replace('per_', 'per ')}</span>
              )}
              {nonEmployee && (
                <span className="inline-flex items-center gap-2 text-[12.5px] text-ink-600">TDS <Num label="TDS percent" value={r.tds_percent} max={50} step={0.5} onChange={(v) => set('tds_percent', v)} width="!w-[80px]" /> % on payouts</span>
              )}
            </div>
          </Row>
        )}
        {(type === 'intern' || type === 'freelancer') && (
          <Row label={type === 'intern' ? 'Internship ends *' : 'Engagement ends'} hint={type === 'freelancer' ? 'Or link a project below' : undefined}>
            <input type="date" className="input !w-[170px] !min-h-[38px] !py-1.5" value={r.engagement_end ?? ''} min={effectiveFrom} onChange={(e) => set('engagement_end', e.target.value || null)} />
          </Row>
        )}
        {type === 'freelancer' && (
          <Row label="Project *" hint="They only see these; a project or an end date is required">
            {projects.length ? (
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {projects.map((p) => {
                  const on = r.project_ids.includes(p.id);
                  return (
                    <button key={p.id} type="button" onClick={() => set('project_ids', on ? r.project_ids.filter((x) => x !== p.id) : [...r.project_ids, p.id])}
                      className={cx('rounded-full border px-3 py-1 text-[12px] font-semibold', on ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 text-ink-600')}>
                      {p.name}
                    </button>
                  );
                })}
              </div>
            ) : <p className="text-[12.5px] text-ink-400 pt-1.5">No projects yet.</p>}
          </Row>
        )}
      </Block>

      {/* 3 — everything else, already set sensibly for the type */}
      <div className="rounded-2xl border border-ink-100 bg-white">
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
          <span>
            <span className="block text-[13px] font-bold text-ink-800">More settings</span>
            <span className="block text-[11.5px] text-ink-500">Probation, leave & holidays, office check-in, half-day/late rules, breaks, what they can use. Already set for this type.</span>
          </span>
          <ChevronDown className={cx('w-4 h-4 text-ink-400 transition-transform', more && 'rotate-180')} />
        </button>
        {more && (
          <div className="px-4 pb-3 space-y-3">
            {savedTemplates.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-semibold text-ink-500 mr-1 inline-flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" />Your saved setups</span>
                {savedTemplates.map((t) => (
                  <button key={t.id} type="button" title={t.description ?? undefined} onClick={() => applyTemplate(t)}
                    className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[12px] font-semibold text-ink-700 hover:border-brand-300 hover:bg-brand-50">{t.name}</button>
                ))}
              </div>
            )}

            <Block icon={<Briefcase className="w-3.5 h-3.5" />} title="Employment">
              {!nonEmployee && (
                <Row label="Probation ends" hint="Optional">
                  <input type="date" className="input !w-[170px] !min-h-[38px] !py-1.5" value={r.probation_end ?? ''} onChange={(e) => set('probation_end', e.target.value || null)} />
                </Row>
              )}
              {type !== 'intern' && type !== 'freelancer' && (
                <Row label="Contract ends" hint="Optional">
                  <input type="date" className="input !w-[170px] !min-h-[38px] !py-1.5" value={r.engagement_end ?? ''} min={effectiveFrom} onChange={(e) => set('engagement_end', e.target.value || null)} />
                </Row>
              )}
              <Row label="Login access ends">
                <Seg value={r.access_end_mode} onChange={(v) => set('access_end_mode', v)} options={[
                  { id: 'never', label: 'Never' }, { id: 'end_date', label: 'On the end date' }, { id: 'project_close', label: 'When the project closes' },
                ]} />
              </Row>
            </Block>

            <Block icon={<MapPin className="w-3.5 h-3.5" />} title="Office & home">
              {type === 'hybrid' && (
                <Row label="Extra home days" hint="Beyond the quota / on a fixed office day">
                  <Seg value={r.extra_wfh} onChange={(v) => set('extra_wfh', v)} options={[
                    { id: 'free', label: 'Free' }, { id: 'approval', label: 'Needs approval' }, { id: 'not_allowed', label: 'Not allowed' },
                  ]} />
                </Row>
              )}
              {r.location_mode === 'office' && !nonEmployee && (
                <Row label="Occasional work from home">
                  <Seg value={r.extra_wfh} onChange={(v) => set('extra_wfh', v)} options={[
                    { id: 'approval', label: 'Needs approval' }, { id: 'not_allowed', label: 'Not allowed' }, { id: 'free', label: 'Free' },
                  ]} />
                </Row>
              )}
              {r.location_mode !== 'remote' && (
                <Row label="Location check at office check-in">
                  <Seg value={r.geofence_required ? 'yes' : 'no'} onChange={(v) => set('geofence_required', v === 'yes')} options={[
                    { id: 'yes', label: 'Required (office radius)' }, { id: 'no', label: 'Not required' },
                  ]} />
                </Row>
              )}
              {!nonEmployee && (
                <Row label="Client / field visits" hint="Check in away from the office with a reason">
                  <Seg value={r.field_visit_allowed ? 'yes' : 'no'} onChange={(v) => set('field_visit_allowed', v === 'yes')} options={[{ id: 'no', label: 'Not allowed' }, { id: 'yes', label: 'Allowed' }]} />
                </Row>
              )}
            </Block>

            <Block icon={<CalendarDays className="w-3.5 h-3.5" />} title="Time off">
              <Row label="Company holidays">
                <Seg value={r.follows_holidays ? 'yes' : 'no'} onChange={(v) => set('follows_holidays', v === 'yes')} options={[{ id: 'yes', label: 'Follows' }, { id: 'no', label: 'Doesn’t follow' }]} />
              </Row>
              <Row label="Leave">
                <Seg value={r.leave_mode} onChange={(v) => set('leave_mode', v)} options={[{ id: 'standard', label: 'Standard leave policy' }, { id: 'none', label: 'No leave' }]} />
              </Row>
            </Block>

            <Block icon={<Clock3 className="w-3.5 h-3.5" />} title="Day rules">
              <Row label="Other schedules" hint="Rarely needed">
                <Seg value={r.schedule_type} onChange={(v) => patch({
                  schedule_type: v,
                  shift_start: (v === 'fixed' || v === 'split') ? (r.shift_start ?? '09:00') : r.shift_start,
                  shift_end: (v === 'fixed' || v === 'split') ? (r.shift_end ?? (v === 'split' ? '13:00' : '18:00')) : r.shift_end,
                  shift2_start: v === 'split' ? (r.shift2_start ?? '17:00') : r.shift2_start,
                  shift2_end: v === 'split' ? (r.shift2_end ?? '21:00') : r.shift2_end,
                  core_start: v === 'flexible_core' ? (r.core_start ?? '11:00') : r.core_start,
                  core_end: v === 'flexible_core' ? (r.core_end ?? '16:00') : r.core_end,
                })} options={(Object.keys(SCHEDULE_LABEL) as WorkRules['schedule_type'][]).map((id) => ({ id, label: SCHEDULE_LABEL[id] }))} />
              </Row>
              {r.schedule_type === 'split' && (
                <>
                  <Row label="First part"><span className="inline-flex items-center gap-2"><Time label="Shift start" value={r.shift_start} onChange={(v) => set('shift_start', v)} /> to <Time label="Shift end" value={r.shift_end} onChange={(v) => set('shift_end', v)} /></span></Row>
                  <Row label="Second part"><span className="inline-flex items-center gap-2"><Time label="Second start" value={r.shift2_start} onChange={(v) => set('shift2_start', v)} /> to <Time label="Second end" value={r.shift2_end} onChange={(v) => set('shift2_end', v)} /></span></Row>
                </>
              )}
              {r.schedule_type === 'flexible_core' && (
                <Row label="Core hours" hint="Must be working between these">
                  <span className="inline-flex items-center gap-2"><Time label="Core start" value={r.core_start} onChange={(v) => set('core_start', v)} /> to <Time label="Core end" value={r.core_end} onChange={(v) => set('core_end', v)} /></span>
                </Row>
              )}
              {r.schedule_type !== 'flexible' && <Row label="Full day"><HoursInput label="Full-day hours" minutes={r.full_day_minutes} onChange={(m) => set('full_day_minutes', m)} /></Row>}
              <Row label="Half day if below"><HoursInput label="Half-day hours" minutes={r.half_day_minutes} onChange={(m) => set('half_day_minutes', m)} /></Row>
              <Row label="Absent if below" hint="0 = any check-in counts"><HoursInput label="Absent hours" minutes={r.absent_below_minutes} onChange={(m) => set('absent_below_minutes', m)} /></Row>
              {r.schedule_type !== 'flexible' && (
                <Row label="Late after" hint="Minutes of grace after the start">
                  <span className="inline-flex items-center gap-2"><Num label="Late grace" value={r.late_grace_minutes} max={240} placeholder="default" onChange={(v) => set('late_grace_minutes', v)} /><span className="text-[12.5px] text-ink-500">min (blank = company default)</span></span>
                </Row>
              )}
              {r.schedule_type !== 'flexible' && (
                <Row label="Early leave grace">
                  <span className="inline-flex items-center gap-2"><Num label="Early grace" value={r.early_grace_minutes} max={240} placeholder="0" onChange={(v) => set('early_grace_minutes', v)} /><span className="text-[12.5px] text-ink-500">min</span></span>
                </Row>
              )}
              <Row label="Break allowed">
                <span className="inline-flex items-center gap-2"><Num label="Break minutes" value={r.break_minutes} max={480} placeholder="default" onChange={(v) => set('break_minutes', v)} /><span className="text-[12.5px] text-ink-500">min a day (blank = company default)</span></span>
              </Row>
              <Row label="Earliest check-in" hint="Optional"><Time label="Earliest check-in" value={r.earliest_checkin} onChange={(v) => set('earliest_checkin', v)} /></Row>
              <Row label="Forgot to check out">
                <Seg value={r.auto_checkout} onChange={(v) => set('auto_checkout', v)} options={[
                  { id: 'none', label: 'Leave it open' }, { id: 'shift_end', label: 'Auto at shift end' }, { id: 'midnight', label: 'Auto at midnight' },
                ]} />
              </Row>
              <Row label="Extra hours">
                <Seg value={r.extra_hours} onChange={(v) => set('extra_hours', v)} options={[
                  { id: 'ignore', label: 'Ignore' }, { id: 'show', label: 'Show only' }, { id: 'approval', label: 'Needs approval' }, { id: 'paid', label: 'Paid' },
                ]} />
              </Row>
            </Block>

            <Block icon={<ToggleRight className="w-3.5 h-3.5" />} title="What they can use">
              <div className="py-2.5 grid gap-2 sm:grid-cols-2">
                {(Object.keys(FEATURE_LABEL) as FeatureKey[]).map((k) => {
                  const auto = derived[k];
                  const val = r.features[k] ?? auto;
                  const overridden = r.features[k] !== undefined && r.features[k] !== auto;
                  return (
                    <div key={k} className="flex items-center gap-2.5">
                      <Toggle on={val} label={FEATURE_LABEL[k]} onChange={(v) => {
                        const f = { ...r.features };
                        if (v === auto) delete f[k]; else f[k] = v;
                        set('features', f);
                      }} />
                      <span className="text-[13px] text-ink-800">{FEATURE_LABEL[k]}</span>
                      {overridden && <span className="text-[10.5px] font-semibold text-amber-700 bg-amber-50 rounded-full px-1.5">changed</span>}
                    </div>
                  );
                })}
              </div>
            </Block>
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-ink-950 text-white px-4 py-3.5 space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/50">Summary</p>
        <p className="text-[13.5px] leading-relaxed">{rulesSummary(r)}{monthlyPay && salary && Number(salary) > 0 ? ` ₹${Number(salary).toLocaleString('en-IN')}` : ''}</p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {onEffectiveFrom && (
            <label className="inline-flex items-center gap-2 text-[12.5px] text-white/80">
              Starts from
              <input type="date" value={effectiveFrom} min={minEffective} onChange={(e) => e.target.value && onEffectiveFrom(e.target.value)}
                className="rounded-lg bg-white/10 px-2 py-1 text-white tnum [color-scheme:dark]" />
            </label>
          )}
          <button type="button" disabled={savingTpl} onClick={() => void saveAsTemplate()} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white/80 hover:text-white">
            <BookmarkPlus className="w-4 h-4" /> Save as a setup
          </button>
        </div>
        {problem && <p className="text-[12.5px] font-semibold text-amber-300">{problem}</p>}
      </div>
    </div>
  );
}

type ScheduleKind = 'fixed' | 'flexible';
