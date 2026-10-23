import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, LifeBuoy, Mail, Plus } from 'lucide-react';
import { SUPPORT_CATEGORY, SUPPORT_STATUS, supportApi, type SupportCategory, type SupportRequest } from '../../lib/support';
import { notify } from '../../lib/toast';
import { Badge, Button, Card, EmptyState, Notice, cx } from '../../ui';
import { Modal } from '../../ui/Modal';
import { SupportConversation } from '../common/SupportConversation';

const FAQ: Array<[string, string]> = [
  ['How do I approve a deliverable?', 'Open Deliverables, choose the item marked “Ready for your review” and use Review work. You can approve it or ask for changes with a note.'],
  ['Why can’t I download a file?', 'Final files unlock when the deliverable is marked ready. If a payment is overdue, downloads are paused until the payment is verified.'],
  ['I paid — why does it still show as due?', 'Payments count once our finance team verifies the bank reference you submitted. That usually takes one working day.'],
  ['How do I change scope, quantity or a deadline?', 'Open the deliverable and choose Request modification. The project team reviews it and may suggest a counter-proposal.'],
  ['How do I add a colleague?', 'Raise an “Access & logins” request with their name and email and we’ll set them up.'],
];

/** Client portal: help topics plus their support requests. */
export function ClientSupport({ projects, managerName }: { projects: Array<{ id: string; name: string }>; managerName?: string | null }) {
  const [rows, setRows] = useState<SupportRequest[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [faq, setFaq] = useState<number | null>(0);

  const load = useCallback(async () => {
    try { setRows(await supportApi.list()); setState('ready'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load your requests.'); setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const open = rows.find((r) => r.id === openId) ?? null;

  return (
    <div className="space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Help & support</p>
          <h1 className="font-display text-[28px] font-bold text-ink-900 leading-tight mt-1">How can we help?</h1>
          <p className="text-[14px] text-ink-500 mt-1">Ask a question or report a problem — your project team replies here and you’ll get a notification.</p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)} disabled={state === 'error'}>New request</Button>
      </header>

      {state === 'error' && <Notice tone="sky">{error}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px] items-start">
        <div className="space-y-4">
          {open ? (
            <Card className="p-5 sm:p-6 flex flex-col min-h-[460px]">
              <button type="button" className="btn-ghost btn-sm w-fit mb-3" onClick={() => setOpenId(null)}><ArrowLeft className="w-3.5 h-3.5" /> Your requests</button>
              <p className="text-[11px] font-bold text-ink-400 tnum">{open.request_number} · {SUPPORT_CATEGORY[open.category]}</p>
              <h2 className="font-display text-xl font-bold text-ink-900 mt-0.5">{open.subject}</h2>
              <div className="mt-1 mb-3"><Badge tone={SUPPORT_STATUS[open.status].tone} dot>{SUPPORT_STATUS[open.status].clientLabel}</Badge></div>
              <div className="flex-1 min-h-0"><SupportConversation key={open.id} request={open} staff={false} onChanged={load} /></div>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="px-5 sm:px-6 py-4 border-b border-ink-100"><h2 className="font-display font-bold text-[17px] text-ink-900">Your requests</h2></div>
              {state === 'loading' ? <div className="p-5 space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-14 rounded-2xl" />)}</div>
                : rows.length ? (
                  <ul className="divide-y divide-ink-100">
                    {rows.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => setOpenId(r.id)} className="w-full text-left px-5 sm:px-6 py-3.5 flex items-center gap-3 hover:bg-ink-50/70">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-ink-900 truncate">{r.subject}</p>
                            <p className="text-[12px] text-ink-500">{r.request_number}{r.projects?.name ? ` · ${r.projects.name}` : ''} · updated {new Date(r.last_message_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}</p>
                          </div>
                          <Badge tone={SUPPORT_STATUS[r.status].tone} dot>{SUPPORT_STATUS[r.status].clientLabel}</Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={<LifeBuoy className="w-6 h-6" />} title="No requests yet" text="Questions you send to the team appear here with their replies." className="!py-10" />}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {managerName && (
            <Card className="p-5">
              <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 grid place-items-center"><Mail className="w-4 h-4" /></span>
                <div><p className="text-[12px] text-ink-500">Your account manager</p><p className="font-bold text-ink-900">{managerName}</p></div></div>
              <p className="text-[12px] text-ink-500 mt-3">Requests about a project go to its manager first.</p>
            </Card>
          )}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-ink-100"><h2 className="font-display font-bold text-[15px] text-ink-900">Common questions</h2></div>
            <ul className="divide-y divide-ink-100">
              {FAQ.map(([q, a], i) => (
                <li key={q}>
                  <button type="button" onClick={() => setFaq(faq === i ? null : i)} className="w-full text-left px-5 py-3 flex items-center justify-between gap-3" aria-expanded={faq === i}>
                    <span className="text-[13px] font-semibold text-ink-900">{q}</span><ChevronDown className={cx('w-4 h-4 text-ink-400 transition-transform shrink-0', faq === i && 'rotate-180')} />
                  </button>
                  {faq === i && <p className="px-5 pb-4 -mt-1 text-[13px] text-ink-600 leading-relaxed anim-fade">{a}</p>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {creating && <NewRequestDialog projects={projects} onClose={() => setCreating(false)} onCreated={async (id) => { setCreating(false); await load(); setOpenId(id); }} />}
    </div>
  );
}

function NewRequestDialog({ projects, onClose, onCreated }: { projects: Array<{ id: string; name: string }>; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [category, setCategory] = useState<SupportCategory>('question');
  const [project, setProject] = useState(projects.length === 1 ? projects[0].id : '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (subject.trim().length < 3) { notify('Add a short subject.', 'error'); return; }
    if (!body.trim()) { notify('Describe what you need.', 'error'); return; }
    setBusy(true);
    try { const id = await supportApi.create(subject.trim(), body.trim(), category, project || null); notify('Request sent. We’ll reply here.', 'success'); await onCreated(id); }
    catch (e) { notify(e instanceof Error ? e.message : 'Unable to send.', 'error'); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="New support request" onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SUPPORT_CATEGORY) as SupportCategory[]).map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={cx('rounded-full px-3.5 py-1.5 text-[12px] font-semibold border', category === c ? 'bg-ink-950 text-white border-ink-950' : 'bg-white text-ink-600 border-ink-200 hover:border-ink-300')}>{SUPPORT_CATEGORY[c]}</button>
          ))}
        </div>
        {projects.length > 1 && (
          <label className="block"><span className="label">Project (optional)</span>
            <select className="input" value={project} onChange={(e) => setProject(e.target.value)}><option value="">General / not about one project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
        )}
        <label className="block"><span className="label">Subject</span><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} placeholder="e.g. Question about milestone 2 invoice" /></label>
        <label className="block"><span className="label">Details</span><textarea className="input min-h-[120px]" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="Tell us what you need. Include links or invoice numbers if relevant." /></label>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => void submit()}>Send request</Button></div>
      </div>
    </Modal>
  );
}
