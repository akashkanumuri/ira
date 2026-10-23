import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Send, Undo2 } from 'lucide-react';
import { CLIENT_ROUND, reviewApi, type ClientRound } from '../../lib/tasks';
import { Badge, Button, Field, Input, Select, Textarea, useToast } from '../client/ClientUI';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const TONE = { pending: 'warn', approved: 'ok', changes_requested: 'err', withdrawn: 'neutral' } as const;
type LinkedTask = Awaited<ReturnType<typeof reviewApi.approvedTasks>>[number];

/**
 * Manager/admin side of the client review loop for one deliverable:
 * send an internally approved version to the client (as “IRA team”), see the
 * client's decision, and forward requested changes to the assignee's task.
 */
export function StaffClientReview({ deliverableId, deliverableStatus, nameOf, onChanged }: {
  deliverableId: string; deliverableStatus: string; nameOf: (employeeId: string) => string; onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [rounds, setRounds] = useState<ClientRound[] | null>(null);
  const [tasks, setTasks] = useState<LinkedTask[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({ taskId: '', link: '', message: '' });
  const [fwd, setFwd] = useState<{ id: string; note: string; taskId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([reviewApi.rounds(deliverableId), reviewApi.approvedTasks(deliverableId)]);
      setRounds(r); setTasks(t); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t load client reviews.'); setRounds([]); }
  }, [deliverableId]);
  useEffect(() => { void load(); }, [load]);

  const approved = tasks.filter((t) => t.status === 'completed');
  const pending = rounds?.find((r) => r.status === 'pending');
  const canSend = !pending && !['Draft', 'Cancelled'].includes(deliverableStatus);
  const chosen = approved.find((t) => t.id === form.taskId);

  async function send() {
    setBusy(true);
    try {
      await reviewApi.sendToClient(deliverableId, form.link.trim() || null, form.message.trim() || null, form.taskId || null);
      toast('Sent to the client for review.');
      setSending(false); setForm({ taskId: '', link: '', message: '' });
      await Promise.all([load(), onChanged()]);
    } catch (e) { toast(e instanceof Error ? e.message : 'Couldn’t send.', 'err'); }
    finally { setBusy(false); }
  }
  async function forward() {
    if (!fwd) return;
    setBusy(true);
    try {
      await reviewApi.forward(fwd.id, fwd.note.trim() || null, fwd.taskId || null);
      toast('Feedback forwarded. The task is reopened for changes.');
      setFwd(null);
      await Promise.all([load(), onChanged()]);
    } catch (e) { toast(e instanceof Error ? e.message : 'Couldn’t forward.', 'err'); }
    finally { setBusy(false); }
  }

  if (error && /switch on/i.test(error)) return <p className="text-xs text-ink-3">Client review rounds switch on once the review database update is applied.</p>;

  return (
    <section>
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-[13px] font-semibold">Client review</h3>
        {canSend && !sending && <Button size="sm" variant="primary" icon={Send} onClick={() => { setSending(true); setForm({ taskId: approved[0]?.id ?? '', link: '', message: '' }); }}>Send version {(rounds?.[0]?.round_no ?? 0) + 1}</Button>}
      </div>
      {error && !/switch on/i.test(error) && <p className="text-xs text-err mb-2">{error}</p>}

      {sending && (
        <div className="rounded-2xl border border-ink-200 p-3.5 space-y-3 mb-3">
          <p className="text-xs text-ink-2">The client sees this as coming from <b>IRA team</b>. Pick the internally approved task — its approved draft link is sent — or paste a link.</p>
          {approved.length > 0 && (
            <Field label="Approved work">
              <Select value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })}>
                <option value="">Paste a link instead</option>
                {approved.map((t) => <option key={t.id} value={t.id}>{t.title} · {nameOf(t.assigned_to)}</option>)}
              </Select>
            </Field>
          )}
          {!form.taskId && (
            <Field label="Link for the client" required>
              <Input value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" inputMode="url" />
            </Field>
          )}
          {chosen?.submitted_link && <a href={chosen.submitted_link} target="_blank" rel="noreferrer" className="text-xs text-info hover:underline inline-flex items-center gap-1"><ExternalLink size={12} /> Check the link first</a>}
          <Field label="Message to the client (optional)">
            <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} maxLength={2000} placeholder="What should they look at?" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" disabled={busy} onClick={() => setSending(false)}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!form.taskId && !/^https?:\/\/\S+/i.test(form.link.trim())} onClick={() => void send()}>Send for review</Button>
          </div>
        </div>
      )}

      {rounds === null ? <div className="skeleton h-12 rounded-2xl" /> : rounds.length === 0 ? (
        <p className="text-xs text-ink-3">{approved.length ? 'Approved work is ready to send to the client.' : 'Nothing sent to the client yet. Approve the linked task first.'}</p>
      ) : (
        <ol className="space-y-2">
          {rounds.map((r) => (
            <li key={r.id} className="rounded-2xl border border-ink-200 p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold">Version {r.round_no}</span>
                <Badge tone={TONE[r.status]}>{CLIENT_ROUND[r.status].label}</Badge>
                <span className="text-[11px] text-ink-3 ml-auto">{when(r.sent_at)}</span>
              </div>
              {r.link && <a href={r.link} target="_blank" rel="noreferrer" className="text-xs text-info hover:underline inline-flex items-center gap-1 max-w-full"><ExternalLink size={12} className="shrink-0" /><span className="truncate">{r.link}</span></a>}
              {r.client_comment && <p className="text-xs text-ink-2 whitespace-pre-line"><b>Client:</b> {r.client_comment}</p>}
              {r.status === 'changes_requested' && (r.forwarded_at ? (
                <p className="text-[11px] text-ink-3">Forwarded to the team {when(r.forwarded_at)}{r.forward_note ? ` · “${r.forward_note}”` : ''}</p>
              ) : fwd?.id === r.id ? (
                <div className="space-y-2 pt-1">
                  {!r.task_id && (
                    <Select value={fwd.taskId} onChange={(e) => setFwd({ ...fwd, taskId: e.target.value })} aria-label="Task to reopen">
                      <option value="">Choose the task to reopen…</option>
                      {tasks.map((t) => <option key={t.id} value={t.id}>{t.title} · {nameOf(t.assigned_to)}</option>)}
                    </Select>
                  )}
                  <Textarea value={fwd.note} onChange={(e) => setFwd({ ...fwd, note: e.target.value })} maxLength={2000} placeholder="Your guidance for the assignee (optional)" />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" disabled={busy} onClick={() => setFwd(null)}>Cancel</Button>
                    <Button size="sm" variant="primary" loading={busy} disabled={!r.task_id && !fwd.taskId} onClick={() => void forward()}>Reopen task with feedback</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" icon={Undo2} onClick={() => setFwd({ id: r.id, note: '', taskId: r.task_id ?? '' })}>Forward to the assignee</Button>
              ))}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
