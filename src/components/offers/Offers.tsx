import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, FileSignature, LogOut, Plus, RefreshCw, Save, Send, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { getKolkataDateString } from '../../lib/workingDays';
import type { Employee } from '../../types/attendance';
import { Badge, Card, CardHeader, EmptyState, Notice, Skeleton, cx, type Tone } from '../../ui';
import { Modal } from '../../ui/Modal';

/**
 * Employee offer letters — the same shape as a client contract, without payment.
 * Admin writes the offer from a template and sends it with an expiry; the employee sees only the offer
 * until they accept it. Templates and the terms library are edited in Settings → Offer letters.
 */

const db = () => supabase as any;
const today = () => getKolkataDateString();
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const longDate = (d?: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');

export interface OfferTemplate { code: string; name: string; employment_type: string; body: string; clause_codes: string[]; active: boolean }
export interface OfferClause { code: string; title: string; body: string; sort: number; active: boolean }
export interface OfferLetter {
  id: string; employee_id: string; template_code: string | null; version_no: number;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Declined' | 'Withdrawn';
  title: string; body: string; clauses: Array<{ title: string; body: string }>; fields: Record<string, string>;
  expires_on: string | null; sent_at: string | null; accepted_at: string | null; signer_name: string | null;
  declined_at: string | null; decline_reason: string | null; created_at: string;
}

const isExpired = (o: Pick<OfferLetter, 'status' | 'expires_on'>) => o.status === 'Sent' && !!o.expires_on && o.expires_on < today();
export const offerStatusLabel = (o: OfferLetter) => (isExpired(o) ? 'Expired' : o.status === 'Sent' ? 'Waiting for employee' : o.status);
const STATUS_TONE: Record<string, Tone> = { Draft: 'ink', 'Waiting for employee': 'amber', Accepted: 'mint', Declined: 'rose', Withdrawn: 'ink', Expired: 'rose' };

const PLACEHOLDER = /\{([a-z_]+)\}/g;
const fill = (text: string, f: Record<string, string>) => text.replace(PLACEHOLDER, (m, k) => (f[k] ?? '').trim() || m);
const placeholdersIn = (...texts: string[]) => Array.from(new Set(texts.flatMap((t) => Array.from(t.matchAll(PLACEHOLDER), (m) => m[1]))));
const LABELS: Record<string, string> = {
  employee_name: 'Employee name', designation: 'Designation', department: 'Department', reporting_manager: 'Reporting manager',
  joining_date: 'Date of joining', work_location: 'Work location', working_days: 'Working days', working_hours: 'Working hours',
  ctc_annual: 'Annual CTC', monthly_gross: 'Monthly gross', pay_day: 'Pay day (e.g. 7th)', probation_months: 'Probation (months)',
  probation_notice: 'Notice during probation', notice_period: 'Notice period', offer_expiry_date: 'Offer valid until',
  company_name: 'Company name', signatory_name: 'Signed by', signatory_title: 'Signatory title', jurisdiction_city: 'Courts at (city)',
  non_solicit_months: 'No-poaching period (months)', home_city: 'Home city', home_state: 'Home state', equipment_clause: 'Equipment',
  internet_allowance: 'Internet allowance', visit_notice: 'Notice for office visits', office_days_per_week: 'Office days a week',
  fixed_office_days: 'Which office days', hybrid_change_notice: 'Notice to change office days', hours_per_week: 'Hours a week',
  part_time_days: 'Part-time days', part_time_hours: 'Part-time hours', hourly_rate: 'Hourly rate', internship_end_date: 'Internship ends',
  stipend_monthly: 'Monthly stipend', intern_leave_days: 'Leave days', intern_notice: 'Notice to end early',
};

/** The letter as the employee reads it. */
export function OfferDocument({ title, body, clauses }: { title: string; body: string; clauses: Array<{ title: string; body: string }> }) {
  return (
    <article className="rounded-2xl border border-ink-100 bg-white p-5 sm:p-7">
      <h2 className="font-display text-[20px] font-bold text-ink-950">{title}</h2>
      <div className="mt-4 whitespace-pre-line text-[14px] leading-relaxed text-ink-800">{body}</div>
      {clauses.length > 0 && (
        <section className="mt-6 pt-5 border-t border-ink-100">
          <h3 className="text-[14px] font-bold text-ink-900">Terms and conditions</h3>
          <ol className="mt-3 space-y-3">
            {clauses.map((c, i) => (
              <li key={i} className="text-[13.5px] leading-relaxed text-ink-800">
                <b className="text-ink-900">{i + 1}. {c.title}.</b> {c.body}
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}

/* ================================================================== admin: the offer box */

export function OfferBox({ employee, employees, onClose }: { employee: Employee; employees: Employee[]; onClose: () => void }) {
  const [templates, setTemplates] = useState<OfferTemplate[] | null>(null);
  const [clauses, setClauses] = useState<OfferClause[]>([]);
  const [history, setHistory] = useState<OfferLetter[]>([]);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('Offer of employment');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [expires, setExpires] = useState(addDays(today(), 7));
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'write' | 'preview'>('write');

  const current = history.find((o) => o.status === 'Draft' || o.status === 'Sent') ?? history[0] ?? null;
  const locked = !!current && current.status === 'Sent';
  const manager = employees.find((e) => e.id === employee.managerId);

  const load = useCallback(async () => {
    const [t, c, h] = await Promise.all([
      db().from('offer_templates').select('*').order('name'),
      db().from('offer_clauses').select('*').order('sort'),
      db().from('offer_letters').select('*').eq('employee_id', employee.id).order('created_at', { ascending: false }),
    ]);
    if (t.error || c.error || h.error) { notify((t.error ?? c.error ?? h.error).message, 'error'); return; }
    setTemplates(t.data ?? []); setClauses(c.data ?? []); setHistory(h.data ?? []);
    const open = (h.data ?? []).find((o: OfferLetter) => o.status === 'Draft' || o.status === 'Sent');
    const base: Record<string, string> = {
      employee_name: employee.name, designation: employee.designation ?? '', department: employee.department ?? '',
      reporting_manager: manager?.name ?? '', joining_date: longDate(employee.joinDate), company_name: 'IRA Hospitality',
      probation_months: '3', probation_notice: '7 days', notice_period: '30 days', pay_day: '7th', non_solicit_months: '6',
      working_days: 'Monday to Saturday', working_hours: '10:00 AM to 7:00 PM', jurisdiction_city: 'Hyderabad',
    };
    if (open) {
      setCode(open.template_code ?? ''); setTitle(open.title); setFields({ ...base, ...(open.fields ?? {}) });
      if (open.expires_on) setExpires(open.expires_on);
      setPicked((t.data ?? []).find((x: OfferTemplate) => x.code === open.template_code)?.clause_codes ?? []);
    } else {
      const first = (t.data ?? []).find((x: OfferTemplate) => x.active);
      setCode(first?.code ?? ''); setPicked(first?.clause_codes ?? []); setFields(base);
    }
  }, [employee.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const tpl = templates?.find((t) => t.code === code) ?? null;
  const chosen = clauses.filter((c) => picked.includes(c.code)).sort((a, b) => a.sort - b.sort);
  const f = { ...fields, offer_expiry_date: longDate(expires) };
  const body = tpl ? fill(tpl.body, f) : '';
  const filledClauses = chosen.map((c) => ({ title: c.title, body: fill(c.body, f) }));
  const needed = tpl ? placeholdersIn(tpl.body, ...chosen.map((c) => c.body)).filter((k) => k !== 'offer_expiry_date') : [];
  const missing = needed.filter((k) => !(fields[k] ?? '').trim());

  const chooseTemplate = (c: string) => { setCode(c); setPicked(templates?.find((t) => t.code === c)?.clause_codes ?? []); };

  async function save(andSend: boolean) {
    if (!tpl) return;
    if (andSend && missing.length) { notify(`Fill in: ${missing.map((k) => LABELS[k] ?? k).join(', ')}.`, 'error'); return; }
    setBusy(true);
    try {
      const { data: id, error } = await db().rpc('offer_save', {
        p_employee_id: employee.id, p_template_code: tpl.code, p_title: title, p_body: body,
        p_clauses: filledClauses, p_fields: fields, p_expires_on: expires,
      });
      if (error) throw new Error(error.message);
      if (andSend) {
        const s = await db().rpc('offer_send', { p_offer_id: id, p_expires_on: expires });
        if (s.error) throw new Error(s.error.message);
      }
      notify(andSend ? `Offer sent to ${employee.name}.` : 'Offer saved as a draft.', 'success');
      await load();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save the offer.', 'error'); } finally { setBusy(false); }
  }
  async function act(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    try { const { error } = await db().rpc(fn, args); if (error) throw new Error(error.message); notify(ok, 'success'); await load(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not update the offer.', 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Offer letter · ${employee.name}`} onClose={() => !busy && onClose()} closeDisabled={busy} wide>
      {templates === null ? <Skeleton className="h-64 w-full rounded-2xl" /> : (
        <div className="space-y-5">
          {current && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ink-50 px-4 py-3">
              <span className="text-[13.5px] text-ink-800">
                Version {current.version_no} · <Badge tone={STATUS_TONE[offerStatusLabel(current)]} dot>{offerStatusLabel(current)}</Badge>
                {current.status === 'Sent' && current.expires_on && <span className="ml-2 text-ink-500">valid until {longDate(current.expires_on)}</span>}
                {current.status === 'Accepted' && <span className="ml-2 text-ink-500">signed by {current.signer_name} on {longDate(current.accepted_at)}</span>}
                {current.status === 'Declined' && <span className="ml-2 text-rose-700">“{current.decline_reason}”</span>}
              </span>
              {current.status === 'Sent' && (
                <span className="flex flex-wrap items-center gap-2">
                  <input type="date" className="input !w-auto !min-h-[36px] !py-1" min={today()} value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="New expiry date" />
                  <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void act('offer_extend', { p_offer_id: current.id, p_expires_on: expires }, 'Expiry updated.')}><Clock3 className="w-3.5 h-3.5" />Extend</button>
                  <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => void act('offer_withdraw', { p_offer_id: current.id }, 'Offer withdrawn.')}>Withdraw</button>
                </span>
              )}
            </div>
          )}

          {current?.status === 'Accepted' ? (
            <OfferDocument title={current.title} body={current.body} clauses={current.clauses ?? []} />
          ) : locked ? (
            <>
              <Notice tone="sky">This offer is with {employee.name}. To change it, edit below and press Send revised offer; they will be asked to accept the new version.</Notice>
              <OfferDocument title={current!.title} body={current!.body} clauses={current!.clauses ?? []} />
            </>
          ) : null}

          {current?.status !== 'Accepted' && (
            <>
              <div className="flex gap-2" role="tablist">
                {(['write', 'preview'] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('px-4 py-2 rounded-full text-[13px] font-semibold', tab === t ? 'bg-ink-950 text-white' : 'bg-white border border-ink-100 text-ink-700')}>
                    {t === 'write' ? (locked ? 'Revise' : 'Write') : 'Preview'}
                  </button>
                ))}
              </div>
              {tab === 'write' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block"><span className="label">Template</span>
                      <select className="input" value={code} onChange={(e) => chooseTemplate(e.target.value)}>
                        {templates.filter((t) => t.active || t.code === code).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                      </select>
                    </label>
                    <label className="block"><span className="label">Offer valid until</span>
                      <input type="date" className="input" min={today()} value={expires} onChange={(e) => setExpires(e.target.value)} />
                    </label>
                  </div>
                  <label className="block"><span className="label">Title</span><input className="input" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
                  <section>
                    <h4 className="text-[13px] font-bold text-ink-800 mb-2">Details {missing.length > 0 && <span className="font-semibold text-amber-800">· {missing.length} to fill</span>}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {needed.map((k) => (
                        <label key={k} className="block"><span className="label">{LABELS[k] ?? k.replace(/_/g, ' ')}</span>
                          <input className={cx('input', !(fields[k] ?? '').trim() && 'border-amber-300')} value={fields[k] ?? ''} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} />
                        </label>
                      ))}
                    </div>
                  </section>
                  <section>
                    <h4 className="text-[13px] font-bold text-ink-800 mb-2">Terms and conditions in this letter</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {clauses.filter((c) => c.active || picked.includes(c.code)).map((c) => (
                        <label key={c.code} className="flex items-start gap-2.5 text-[13.5px] py-1">
                          <input type="checkbox" className="mt-0.5 accent-[var(--brand)]" checked={picked.includes(c.code)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.code] : picked.filter((x) => x !== c.code))} />
                          {c.title}
                        </label>
                      ))}
                    </div>
                  </section>
                </div>
              ) : <OfferDocument title={title} body={body} clauses={filledClauses} />}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" disabled={busy || !tpl} onClick={() => void save(false)}><Save className="w-4 h-4" />Save draft</button>
                <button type="button" className="btn-primary" disabled={busy || !tpl} onClick={() => void save(true)}>
                  {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{locked ? 'Send revised offer' : 'Send to employee'}
                </button>
              </div>
            </>
          )}

          {history.length > 1 && (
            <section>
              <h4 className="text-[13px] font-bold text-ink-800 mb-2">History</h4>
              <ul className="space-y-1 text-[13px] text-ink-600">
                {history.map((o) => <li key={o.id}>v{o.version_no} · {offerStatusLabel(o)} · {longDate(o.sent_at ?? o.created_at)}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ================================================================== settings: templates and terms */

export function OfferTemplatesSettings() {
  const [templates, setTemplates] = useState<OfferTemplate[] | null>(null);
  const [clauses, setClauses] = useState<OfferClause[]>([]);
  const [editT, setEditT] = useState<OfferTemplate | null>(null);
  const [editC, setEditC] = useState<OfferClause | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [t, c] = await Promise.all([db().from('offer_templates').select('*').order('name'), db().from('offer_clauses').select('*').order('sort')]);
    if (t.error || c.error) { notify((t.error ?? c.error).message, 'error'); return; }
    setTemplates(t.data ?? []); setClauses(c.data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function saveT() {
    if (!editT) return;
    setBusy(true);
    try {
      const { error } = await db().rpc('offer_template_save', { p_code: editT.code, p_name: editT.name, p_type: editT.employment_type, p_body: editT.body, p_clause_codes: editT.clause_codes, p_active: editT.active });
      if (error) throw new Error(error.message);
      notify('Template saved. Letters already sent are not changed.', 'success'); setEditT(null); await load();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); } finally { setBusy(false); }
  }
  async function saveC() {
    if (!editC) return;
    setBusy(true);
    try {
      const code = editC.code || editC.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
      const { error } = await db().rpc('offer_clause_save', { p_code: code, p_title: editC.title, p_body: editC.body, p_sort: editC.sort, p_active: editC.active });
      if (error) throw new Error(error.message);
      notify('Term saved.', 'success'); setEditC(null); await load();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); } finally { setBusy(false); }
  }

  if (!templates) return <Card className="p-5"><Skeleton className="h-40 w-full rounded-2xl" /></Card>;
  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <CardHeader title="Offer letter templates" subtitle="One per type of employment. Words in {braces} fill in from the employee and the offer box." />
        <ul className="mt-4 divide-y divide-ink-100">
          {templates.map((t) => (
            <li key={t.code} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <span><b className="text-ink-900">{t.name}</b> <span className="text-[12.5px] text-ink-500">· {t.clause_codes.length} terms{t.active ? '' : ' · retired'}</span></span>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setEditT({ ...t })}>Edit</button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <CardHeader title="Terms and conditions" subtitle="The library each template picks from." />
          <button type="button" className="btn-secondary btn-sm" onClick={() => setEditC({ code: '', title: '', body: '', sort: (clauses[clauses.length - 1]?.sort ?? 0) + 10, active: true })}><Plus className="w-3.5 h-3.5" />Add term</button>
        </div>
        <ul className="mt-4 divide-y divide-ink-100">
          {clauses.map((c) => (
            <li key={c.code} className="py-3 flex items-start justify-between gap-3">
              <span className="min-w-0"><b className="text-ink-900">{c.title}</b>{!c.active && <span className="text-[12px] text-ink-500"> · retired</span>}<span className="block text-[12.5px] text-ink-500 line-clamp-2">{c.body}</span></span>
              <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setEditC({ ...c })}>Edit</button>
            </li>
          ))}
        </ul>
      </Card>

      {editT && (
        <Modal title={`Template · ${editT.name}`} onClose={() => !busy && setEditT(null)} closeDisabled={busy} wide>
          <div className="space-y-4">
            <label className="block"><span className="label">Name</span><input className="input" maxLength={80} value={editT.name} onChange={(e) => setEditT({ ...editT, name: e.target.value })} /></label>
            <label className="block"><span className="label">Letter text</span><textarea className="input min-h-[320px] font-mono text-[12.5px]" value={editT.body} onChange={(e) => setEditT({ ...editT, body: e.target.value })} /></label>
            <section>
              <h4 className="text-[13px] font-bold text-ink-800 mb-2">Terms included by default</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {clauses.map((c) => (
                  <label key={c.code} className="flex items-center gap-2.5 text-[13.5px]">
                    <input type="checkbox" className="accent-[var(--brand)]" checked={editT.clause_codes.includes(c.code)} onChange={(e) => setEditT({ ...editT, clause_codes: e.target.checked ? [...editT.clause_codes, c.code] : editT.clause_codes.filter((x) => x !== c.code) })} />
                    {c.title}
                  </label>
                ))}
              </div>
            </section>
            <label className="flex items-center gap-2.5 text-[14px]"><input type="checkbox" className="accent-[var(--brand)]" checked={editT.active} onChange={(e) => setEditT({ ...editT, active: e.target.checked })} />In use</label>
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEditT(null)} disabled={busy}>Cancel</button><button type="button" className="btn-primary" onClick={() => void saveT()} disabled={busy}>Save template</button></div>
          </div>
        </Modal>
      )}
      {editC && (
        <Modal title={editC.code ? `Term · ${editC.title}` : 'New term'} onClose={() => !busy && setEditC(null)} closeDisabled={busy}>
          <div className="space-y-4">
            <label className="block"><span className="label">Title</span><input className="input" maxLength={120} value={editC.title} onChange={(e) => setEditC({ ...editC, title: e.target.value })} /></label>
            <label className="block"><span className="label">Wording</span><textarea className="input min-h-[160px]" maxLength={4000} value={editC.body} onChange={(e) => setEditC({ ...editC, body: e.target.value })} /></label>
            <label className="flex items-center gap-2.5 text-[14px]"><input type="checkbox" className="accent-[var(--brand)]" checked={editC.active} onChange={(e) => setEditC({ ...editC, active: e.target.checked })} />In use</label>
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEditC(null)} disabled={busy}>Cancel</button><button type="button" className="btn-primary" onClick={() => void saveC()} disabled={busy || editC.title.trim().length < 2 || editC.body.trim().length < 5}>Save term</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================================================================== employee: the gate */

interface Gate { gated: boolean; status?: string; offer_id?: string | null }

/** An employee with an offer they haven't accepted sees only that offer. Employees with no offer pass straight through. */
export function OfferGate({ userName, onLogout, children }: { userName: string; onLogout: () => void | Promise<void>; children: React.ReactNode }) {
  const [gate, setGate] = useState<Gate | null>(null);
  const [offer, setOffer] = useState<OfferLetter | null>(null);
  const [agree, setAgree] = useState(false);
  const [name, setName] = useState('');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db().rpc('my_offer_gate');
    if (error) { setGate({ gated: false }); return; } // the check must never lock anyone out by failing
    setGate(data as Gate);
    if ((data as Gate)?.offer_id) {
      const o = await db().from('offer_letters').select('*').eq('id', (data as Gate).offer_id).maybeSingle();
      setOffer((o.data ?? null) as OfferLetter | null);
    } else setOffer(null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function respond(accept: boolean) {
    if (!offer) return;
    setBusy(true);
    try {
      const { error } = await db().rpc('offer_respond', { p_offer_id: offer.id, p_accept: accept, p_signer_name: accept ? name.trim() : null, p_reason: accept ? null : reason.trim() });
      if (error) throw new Error(error.message);
      notify(accept ? 'Welcome aboard! Your workspace is open.' : 'Your answer has been sent to the company.', 'success');
      await load();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not send your answer.', 'error'); } finally { setBusy(false); }
  }

  if (!gate) return <div className="min-h-dvh grid place-items-center"><Skeleton className="h-10 w-48 rounded-full" /></div>;
  if (!gate.gated) return <>{children}</>;

  const status = gate.status ?? 'Draft';
  return (
    <div className="min-h-dvh" style={{ background: 'var(--app-bg)' }}>
      <header className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 flex items-center justify-between">
        <span className="font-display font-bold text-ink-950">SIGMA 1</span>
        <button type="button" className="btn-ghost btn-sm" onClick={() => void onLogout()}><LogOut className="w-4 h-4" />Sign out</button>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        <div>
          <p className="eyebrow">Welcome, {userName.split(' ')[0]}</p>
          <h1 className="font-display text-[26px] font-bold text-ink-950 mt-1">
            {status === 'Sent' ? 'Your offer letter' : status === 'Expired' ? 'Your offer has expired' : status === 'Declined' ? 'You declined this offer' : 'Your offer letter is being prepared'}
          </h1>
          <p className="text-[14px] text-ink-600 mt-1">
            {status === 'Sent' ? `Please read it and accept it${offer?.expires_on ? ` by ${longDate(offer.expires_on)}` : ''}. Your workspace opens as soon as you accept.`
              : status === 'Expired' ? 'Ask the company to extend it, then come back here.'
              : status === 'Declined' ? 'The company has been told. They may send you a revised offer.'
              : 'The company will send it shortly. You will get a notification.'}
          </p>
        </div>

        {offer && status !== 'Withdrawn' && <OfferDocument title={offer.title} body={offer.body} clauses={offer.clauses ?? []} />}
        {(!offer || status === 'Withdrawn') && status !== 'Sent' && <Card><EmptyState icon={<FileSignature className="w-6 h-6" />} title="Nothing to sign yet" /></Card>}

        {offer && status === 'Sent' && !declining && (
          <Card className="p-5 sm:p-6 space-y-4">
            <label className="flex items-start gap-3 text-[14px] text-ink-900">
              <input type="checkbox" className="mt-0.5 w-[18px] h-[18px] accent-[var(--brand)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              I have read this offer letter and accept it, including its terms and conditions.
            </label>
            <label className="block max-w-sm"><span className="label">Type your full name to sign</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder={userName} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={busy || !agree || name.trim().length < 3} onClick={() => void respond(true)}>{busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}Accept offer</button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDeclining(true)}><XCircle className="w-4 h-4" />Decline</button>
            </div>
          </Card>
        )}
        {offer && status === 'Sent' && declining && (
          <Card className="p-5 sm:p-6 space-y-4">
            <label className="block"><span className="label">Why are you declining? The company will see this.</span>
              <textarea className="input min-h-24" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => void respond(false)}>Decline offer</button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDeclining(false)}>Back</button>
            </div>
          </Card>
        )}
        <button type="button" className="btn-ghost btn-sm" onClick={() => void load()}><RefreshCw className="w-3.5 h-3.5" />Check again</button>
      </main>
    </div>
  );
}

/** Small summary for the employees list: the latest offer status per employee. */
export function useOfferStatuses(enabled: boolean) {
  const [map, setMap] = useState<Record<string, OfferLetter>>({});
  const reload = useCallback(async () => {
    if (!enabled) return;
    const { data } = await db().from('offer_letters').select('id, employee_id, status, expires_on, version_no, created_at').order('created_at', { ascending: false });
    const m: Record<string, OfferLetter> = {};
    for (const o of (data ?? []) as OfferLetter[]) if (!m[o.employee_id]) m[o.employee_id] = o;
    setMap(m);
  }, [enabled]);
  useEffect(() => { void reload(); }, [reload]);
  return useMemo(() => ({ map, reload }), [map, reload]);
}
