import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Save, Send, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fmtDate, inr, rpc, type ContractRow, type ContractVersionRow, type InstallmentRow, todayIST } from '../../lib/sigma';
import { Button, Field, Input, Select, SidePanel, Textarea, cx, useToast } from '../client/ClientUI';

const db = supabase as any;

/**
 * Admin writes the whole contract in SIGMA: details → terms → payment plan → review & send.
 * The contract value is final (GST included). Accepting it requests Term 1; the client gets
 * full access once that payment is verified. Later terms are requested from Billing.
 */

type Step = 'details' | 'terms' | 'plan' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'terms', label: 'Terms' },
  { id: 'plan', label: 'Payment plan' },
  { id: 'review', label: 'Review & send' },
];

interface Term { name: string; pct: string }
const QUICK: { label: string; pcts: number[] }[] = [
  { label: '50 / 30 / 20', pcts: [50, 30, 20] },
  { label: '40 / 30 / 30', pcts: [40, 30, 30] },
  { label: '50 / 50', pcts: [50, 50] },
  { label: '100% upfront', pcts: [100] },
];
const termsFrom = (pcts: number[]): Term[] => pcts.map((p, i) => ({ name: i === 0 ? 'Advance' : i === pcts.length - 1 ? 'Final payment' : `Term ${i + 1}`, pct: String(p) }));

const PLACEHOLDERS = ['{client}', '{project}', '{value}', '{start_date}', '{end_date}', '{today}'] as const;

const STARTER = `1. Scope of work
{client} engages us for "{project}". The deliverables, quantities and timelines are listed in the project on SIGMA 1.

2. Fees and payment
The total contract value is {value} (all taxes included). Payment follows the plan in this contract. Work starts after the first payment is received.

3. Drafts and changes
Each deliverable includes up to 3 drafts. Changes requested after the last included draft are charged extra, at a price agreed before the work starts.

4. Timelines
The project runs from {start_date} to {end_date}. Delays in the client's inputs or approvals move the timeline by the same amount.

5. Late payment
If a payment is more than 7 days overdue, access to the project and its files is paused until the payment is received.

6. Ownership
Final files are handed over once all payments are complete.`;

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  clientId: string | null;
  /** Existing unsent draft to edit; omit to create a new contract. */
  contract?: ContractRow | null;
  version?: ContractVersionRow | null;
  plan?: InstallmentRow[];
  onSaved: () => Promise<void>;
}

export function ContractWizard({ open, onClose, projectId, projectName, clientId, contract, version, plan = [], onSaved }: Props) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('details');
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [dueDays, setDueDays] = useState('7');
  const [docUrl, setDocUrl] = useState('');
  const [body, setBody] = useState('');
  const [terms, setTerms] = useState<Term[]>(termsFrom([50, 30, 20]));
  const [clientName, setClientName] = useState('the client');
  const [templates, setTemplates] = useState<{ id: string; name: string; body: string }[]>([]);
  const [busy, setBusy] = useState<'draft' | 'send' | 'template' | null>(null);

  const planTerms = plan.filter(i => i.term_no != null).sort((a, b) => (a.term_no ?? 0) - (b.term_no ?? 0));
  /** Once a term was asked for or paid, the plan can only change from Billing. */
  const planLocked = planTerms.some(i => i.requested_at || Number(i.amount_paid) > 0);

  useEffect(() => {
    if (!open) return;
    setStep('details');
    setTitle(contract?.title ?? `${projectName} agreement`);
    setValue(contract?.contract_value != null ? String(contract.contract_value) : '');
    setStart(contract?.start_date ?? '');
    setEnd(contract?.end_date ?? '');
    setDueDays(String(contract?.first_term_due_days ?? 7));
    setDocUrl('');
    setBody(version?.terms_body ?? '');
    setTerms(planTerms.length ? planTerms.map(t => ({ name: t.name, pct: String(t.percentage ?? '') })) : termsFrom([50, 30, 20]));
    void (async () => {
      if (clientId) {
        const { data } = await db.from('clients').select('company_name').eq('id', clientId).maybeSingle();
        if (data?.company_name) setClientName(data.company_name);
      }
      const { data: t } = await db.from('contract_templates').select('id, name, body').order('name');
      setTemplates(Array.isArray(t) ? t : []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contract?.id]);

  const amount = Number(value);
  const pctTotal = terms.reduce((s, t) => s + (Number(t.pct) || 0), 0);
  const fill = (text: string) =>
    text
      .split('{client}').join(clientName)
      .split('{project}').join(projectName)
      .split('{value}').join(amount > 0 ? inr(amount) : '{value}')
      .split('{start_date}').join(start ? fmtDate(start) : 'the agreed start date')
      .split('{end_date}').join(end ? fmtDate(end) : 'the agreed end date')
      .split('{today}').join(fmtDate(todayIST()));

  const problems = useMemo(() => {
    const p: Partial<Record<Step, string>> = {};
    if (title.trim().length < 3) p.details = 'Give the contract a title.';
    else if (!(amount > 0)) p.details = 'Enter the contract value (GST included).';
    else if (end && start && end < start) p.details = 'End date can’t be before the start date.';
    else if (!(Number(dueDays) >= 0 && Number(dueDays) <= 90)) p.details = 'Term 1 due days must be 0–90.';
    else if (docUrl.trim() && !/^https:\/\/\S+$/i.test(docUrl.trim())) p.details = 'The document link must start with https://';
    if (body.trim().length < 20 && !docUrl.trim() && !version?.document_url) p.terms = 'Write the terms (at least a few lines) or add a document link.';
    if (!planLocked) {
      if (terms.length < 1) p.plan = 'Add at least one payment term.';
      else if (terms.some(t => !(Number(t.pct) > 0))) p.plan = 'Each term needs a percentage above 0.';
      else if (Math.abs(pctTotal - 100) >= 0.01) p.plan = `The terms must add up to 100% (now ${Number(pctTotal.toFixed(2))}%).`;
    }
    return p;
  }, [title, amount, start, end, dueDays, docUrl, body, terms, pctTotal, planLocked, version?.document_url]);

  const idx = STEPS.findIndex(s => s.id === step);
  const canNext = !problems[step as Exclude<Step, 'review'>];
  const allOk = !problems.details && !problems.terms && !problems.plan;

  const saveTemplate = async () => {
    const name = window.prompt('Template name', `${title.trim() || 'Standard'} terms`);
    if (!name || name.trim().length < 2) return;
    setBusy('template');
    try {
      const { data: me } = await supabase.auth.getUser();
      const { error } = await db.from('contract_templates').insert({ name: name.trim(), body, created_by: me.user?.id ?? null });
      if (error) throw new Error(error.message);
      const { data: t } = await db.from('contract_templates').select('id, name, body').order('name');
      setTemplates(Array.isArray(t) ? t : []);
      toast('Template saved.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the template.', 'err');
    } finally { setBusy(null); }
  };

  const save = async (send: boolean) => {
    if (!allOk) return;
    setBusy(send ? 'send' : 'draft');
    try {
      let id = contract?.id ?? null;
      if (!id) {
        id = await rpc<string>('staff_create_contract', {
          p_project_id: projectId,
          p_title: title.trim(),
          p_ref: null,
          p_document_url: docUrl.trim() || null,
          p_document_file_id: null,
          p_contract_value: amount,
          p_tax_note: 'GST included',
          p_start_date: start || null,
          p_end_date: end || null,
          p_renewal_date: null,
          p_terms_summary: null,
        });
      }
      await rpc('staff_update_contract_draft', {
        p_contract_id: id,
        p_title: title.trim(),
        p_contract_value: amount,
        p_start_date: start || null,
        p_end_date: end || null,
        p_terms_body: body.trim() ? fill(body.trim()) : null,
        p_first_term_due_days: Number(dueDays),
      });
      if (!planLocked) {
        await rpc('staff_set_payment_plan', {
          p_contract_id: id,
          p_terms: terms.map(t => ({ name: t.name.trim() || null, percentage: Number(t.pct) })),
        });
      }
      if (send) await rpc('staff_send_contract', { p_contract_id: id });
      toast(send ? 'Contract sent. The client sees it as soon as they sign in.' : 'Contract saved as a draft.');
      onClose();
      await onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the contract.', 'err');
    } finally { setBusy(null); }
  };

  const footer = (
    <>
      {idx > 0 && <Button icon={ArrowLeft} onClick={() => setStep(STEPS[idx - 1].id)}>Back</Button>}
      <div className="flex-1" />
      {step !== 'review' ? (
        <Button variant="primary" disabled={!canNext} onClick={() => setStep(STEPS[idx + 1].id)}>
          Next <ArrowRight size={15} />
        </Button>
      ) : (
        <>
          <Button icon={Save} loading={busy === 'draft'} disabled={!allOk || !!busy} onClick={() => void save(false)}>Save draft</Button>
          <Button variant="primary" icon={Send} loading={busy === 'send'} disabled={!allOk || !!busy || !clientId} onClick={() => void save(true)}>Send to client</Button>
        </>
      )}
    </>
  );

  return (
    <SidePanel open={open} onClose={onClose} title={contract ? 'Edit contract draft' : 'New contract'} sub={`${projectName} · ${clientName}`} footer={footer}>
      <ol className="flex items-center gap-1.5 mb-5" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex-1">
            <button
              type="button"
              onClick={() => { if (i <= idx || STEPS.slice(0, i).every(x => !problems[x.id as Exclude<Step, 'review'>])) setStep(s.id); }}
              className={cx('w-full text-left rounded-xl px-2.5 py-2 text-[11.5px] font-semibold transition-colors',
                s.id === step ? 'bg-primary text-white' : i < idx ? 'bg-primary/10 text-primary' : 'bg-ink-50 text-ink-500')}
              aria-current={s.id === step ? 'step' : undefined}
            >
              <span className="block opacity-75">Step {i + 1}</span>{s.label}
            </button>
          </li>
        ))}
      </ol>

      {step === 'details' && (
        <div className="space-y-4">
          <Field label="Contract title" required><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Brand campaign agreement" /></Field>
          <Field label="Contract value (₹)" required hint="The final amount the client pays, GST included.">
            <Input type="number" min={0} step="1" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} placeholder="100000" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></Field>
            <Field label="End date"><Input type="date" value={end} onChange={e => setEnd(e.target.value)} /></Field>
          </div>
          <Field label="Term 1 is due" hint="Days after the client accepts. Full access opens once you verify this payment.">
            <Select value={dueDays} onChange={e => setDueDays(e.target.value)}>
              {[0, 3, 5, 7, 10, 14, 30].map(d => <option key={d} value={d}>{d === 0 ? 'On acceptance' : `${d} days after acceptance`}</option>)}
            </Select>
          </Field>
          {!contract && (
            <Field label="Signed document link (optional)" hint="If you also have the contract as a PDF on Drive or Dropbox (https://).">
              <Input value={docUrl} onChange={e => setDocUrl(e.target.value)} placeholder="https://" />
            </Field>
          )}
          {problems.details && <p className="text-[12px] text-warn">{problems.details}</p>}
        </div>
      )}

      {step === 'terms' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Start from a template"
              className="!w-auto flex-1 min-w-[180px]"
              value=""
              onChange={e => {
                const v = e.target.value;
                if (!v) return;
                const next = v === '__starter' ? STARTER : templates.find(t => t.id === v)?.body ?? '';
                if (body.trim() && !window.confirm('Replace the current text with this template?')) return;
                setBody(next);
              }}
            >
              <option value="">Start from a template…</option>
              <option value="__starter">SIGMA standard terms</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <Button size="sm" loading={busy === 'template'} disabled={body.trim().length < 20} onClick={() => void saveTemplate()}>Save as template</Button>
          </div>
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={14}
            className="font-[inherit] text-[13px] leading-relaxed min-h-[280px]"
            placeholder="Write the terms and conditions the client will accept…"
          />
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[11.5px] text-ink-500 mr-1">Insert:</span>
            {PLACEHOLDERS.map(p => (
              <button key={p} type="button" onClick={() => setBody(b => (b ? `${b}${b.endsWith(' ') || b.endsWith('\n') ? '' : ' '}${p}` : p))}
                className="rounded-full border border-ink-200 px-2.5 py-1 text-[11.5px] font-mono text-ink-700 hover:bg-ink-50">{p}</button>
            ))}
          </div>
          <p className="text-[11.5px] text-ink-500">Placeholders are filled in when you save: {'{client}'} → {clientName}, {'{value}'} → {amount > 0 ? inr(amount) : 'the value'}.</p>
          {problems.terms && <p className="text-[12px] text-warn">{problems.terms}</p>}
        </div>
      )}

      {step === 'plan' && (
        <div className="space-y-4">
          {planLocked ? (
            <p className="text-[13px] text-ink-600 rounded-2xl bg-ink-50 p-3.5">Payments were already requested on this plan, so it stays as it is. Adjust the remaining terms from Billing.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {QUICK.map(q => (
                <button key={q.label} type="button" onClick={() => setTerms(termsFrom(q.pcts))}
                  className={cx('rounded-full border px-3 py-1.5 text-[12.5px] font-semibold',
                    terms.map(t => Number(t.pct)).join('/') === q.pcts.join('/') ? 'border-primary bg-primary/10 text-primary' : 'border-ink-200 text-ink-700 hover:bg-ink-50')}>
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <ul className="space-y-2">
            {(planLocked ? planTerms.map(t => ({ name: t.name, pct: String(t.percentage ?? '') })) : terms).map((t, i) => (
              <li key={i} className="grid grid-cols-[1fr_90px_110px_auto] gap-2 items-center">
                <Input aria-label={`Term ${i + 1} name`} value={t.name} disabled={planLocked}
                  onChange={e => setTerms(ts => ts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <div className="relative">
                  <Input aria-label={`Term ${i + 1} percentage`} type="number" min={1} max={100} value={t.pct} disabled={planLocked} className="pr-7"
                    onChange={e => setTerms(ts => ts.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-ink-400">%</span>
                </div>
                <span className="text-[13px] font-semibold text-ink-900 text-right tabular-nums">{amount > 0 ? inr(Math.round(amount * (Number(t.pct) || 0)) / 100) : '—'}</span>
                {!planLocked && terms.length > 1 ? (
                  <button type="button" className="icon-btn" aria-label={`Remove term ${i + 1}`} onClick={() => setTerms(ts => ts.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
                ) : <span className="w-9" />}
              </li>
            ))}
          </ul>
          {!planLocked && (
            <div className="flex items-center justify-between">
              <Button size="sm" icon={Plus} disabled={terms.length >= 10} onClick={() => setTerms(ts => [...ts, { name: `Term ${ts.length + 1}`, pct: String(Math.max(0, 100 - pctTotal)) }])}>Add term</Button>
              <span className={cx('text-[13px] font-semibold tabular-nums', Math.abs(pctTotal - 100) < 0.01 ? 'text-ok' : 'text-warn')}>Total {Number(pctTotal.toFixed(2))}%</span>
            </div>
          )}
          <p className="text-[11.5px] text-ink-500">Term 1 is requested automatically when the client accepts. You request the other terms from Billing when they’re due.</p>
          {problems.plan && <p className="text-[12px] text-warn">{problems.plan}</p>}
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-ink-100 p-4">
            <p className="font-display text-lg font-bold text-ink-950">{title}</p>
            <p className="text-[13px] text-ink-600 mt-0.5">{clientName} · {projectName}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
              <span className="text-ink-500">Value (GST incl.)</span><span className="font-semibold text-right">{inr(amount)}</span>
              <span className="text-ink-500">Dates</span><span className="text-right">{start ? fmtDate(start) : '—'} → {end ? fmtDate(end) : '—'}</span>
              <span className="text-ink-500">Term 1 due</span><span className="text-right">{Number(dueDays) === 0 ? 'On acceptance' : `${dueDays} days after acceptance`}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-ink-100 p-4">
            <p className="text-[12px] font-semibold text-ink-500 uppercase tracking-wide mb-2">Payment plan</p>
            <ul className="space-y-1 text-[13px]">
              {(planLocked ? planTerms.map(t => ({ name: t.name, pct: String(t.percentage ?? '') })) : terms).map((t, i) => (
                <li key={i} className="flex justify-between"><span>{i + 1}. {t.name || `Term ${i + 1}`} · {t.pct}%</span><span className="font-semibold tabular-nums">{inr(Math.round(amount * (Number(t.pct) || 0)) / 100)}</span></li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-ink-100 p-4">
            <p className="text-[12px] font-semibold text-ink-500 uppercase tracking-wide mb-2">What the client will read</p>
            <div className="max-h-64 overflow-y-auto whitespace-pre-line text-[13px] leading-relaxed text-ink-800">{body.trim() ? fill(body.trim()) : 'See the attached document.'}</div>
          </div>
          {!clientId && <p className="text-[12px] text-warn">This project has no client yet, so it can only be saved as a draft.</p>}
          <p className="text-[11.5px] text-ink-500">After sending, the client sees only the contract and Help until they accept and you verify Term 1.</p>
        </div>
      )}
    </SidePanel>
  );
}
