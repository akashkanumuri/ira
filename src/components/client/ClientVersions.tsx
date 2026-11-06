import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Layers, Lock, Undo2 } from 'lucide-react';
import { CLIENT_ROUND, isMissingSchema, reviewApi, type ClientVersion } from '../../lib/tasks';
import { Badge, Button, Checkbox, Textarea, cx, useToast } from './ClientUI';
import { useLiveRefresh } from '../../lib/live';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const TONE = { pending: 'warn', approved: 'ok', changes_requested: 'err', withdrawn: 'neutral' } as const;

/**
 * Versions the IRA team has sent for this deliverable, newest first. The client
 * opens the link, then approves or asks for changes. Staff are always shown as
 * “IRA team”; who did the work is never exposed here.
 */
export function ClientVersions({ deliverableId, canReview, onChanged }: { deliverableId: string; canReview: boolean; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [rows, setRows] = useState<ClientVersion[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [mode, setMode] = useState<'approve' | 'changes' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [extraAck, setExtraAck] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await reviewApi.clientVersions(deliverableId)); setUnavailable(false); }
    catch (e) {
      if (isMissingSchema(e as any) || /switch on/i.test(String((e as Error).message))) setUnavailable(true);
      setRows([]);
    }
  }, [deliverableId]);
  useLiveRefresh(load);
  useEffect(() => { void load(); }, [load]);

  if (unavailable || rows === null || rows.length === 0) return null;
  const pending = rows.find((r) => r.status === 'pending') ?? null;
  const included = rows[0]?.included_drafts ?? 3;
  /** Asking for changes on the last included draft (or an extra one) makes the next draft billable. */
  const lastIncluded = !!pending && pending.round_no >= included;
  const draftsLeft = Math.max(0, included - (pending?.round_no ?? rows.length));

  async function decide(approve: boolean) {
    if (!pending) return;
    if (!approve && comment.trim().length < 5) { toast('Describe the changes you need (at least 5 characters).', 'err'); return; }
    if (!approve && lastIncluded && !extraAck) { toast('Please confirm that more changes are charged extra.', 'err'); return; }
    setBusy(true);
    try {
      await reviewApi.clientDecide(pending.id, approve, comment.trim() || null, !approve && lastIncluded && extraAck);
      toast(approve ? 'Approved. Thank you!' : 'Your feedback was sent to the IRA team.');
      setMode(null); setComment(''); setExtraAck(false);
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t save your review.', 'err');
    } finally { setBusy(false); }
  }

  return (
    <section>
      <h3 className="text-[13px] font-semibold mb-1 flex items-center gap-1.5 text-ink"><Layers size={14} /> Drafts for review</h3>
      <p className="text-[12px] text-ink-3 mb-3">{included} drafts are included{pending ? (lastIncluded ? ' — this is the last included draft.' : ` — ${draftsLeft} more after this one.`) : '.'}</p>
      <ol className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.id} className={cx('rounded-2xl border p-3.5 space-y-2', r.status === 'pending' ? 'border-[#f3d9a4] bg-warn-soft/40' : 'border-ink-200')}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold text-ink">Draft {r.round_no}</span>
              {r.is_extra && <Badge tone="info">Extra draft</Badge>}
              <Badge tone={TONE[r.status]}>{CLIENT_ROUND[r.status].clientLabel}</Badge>
              <span className="text-[11px] text-ink-3 ml-auto tnum">{when(r.sent_at)}</span>
            </div>
            {r.message && <p className="text-xs text-ink-2 whitespace-pre-line"><b className="text-ink">IRA team:</b> {r.message}</p>}
            {r.link ? (
              <a href={r.link} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline max-w-full">
                <ExternalLink size={13} className="shrink-0" /><span className="truncate">Open draft {r.round_no}</span>
              </a>
            ) : r.link_locked ? (
              <p className="text-xs text-warn flex items-center gap-1.5"><Lock size={12} /> The final link unlocks once the related payment is verified.</p>
            ) : null}
            {r.client_comment && <p className="text-xs text-ink-2 whitespace-pre-line"><b className="text-ink">You:</b> {r.client_comment}</p>}

            {r.status === 'pending' && canReview && (
              mode ? (
                <div className="space-y-2 pt-1">
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} autoFocus
                    placeholder={mode === 'approve' ? 'Anything you’d like to add? (optional)' : 'What should change? Be as specific as you can.'} />
                  {mode === 'changes' && lastIncluded && (
                    <div className="rounded-xl border border-[#f3d9a4] bg-warn-soft/50 p-3 space-y-2">
                      <p className="text-[12.5px] text-ink">
                        {r.is_extra ? 'This is an extra draft.' : `This is your last included draft (${included} of ${included}).`} More changes are charged extra — the team will tell you the price before adding it to your next payment.
                      </p>
                      <Checkbox checked={extraAck} onChange={setExtraAck} label="I understand that the next draft is charged extra." />
                    </div>
                  )}
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setMode(null); setComment(''); }}>Back</Button>
                    {mode === 'approve'
                      ? <Button size="sm" variant="primary" loading={busy} icon={CheckCircle2} onClick={() => void decide(true)}>Approve draft {r.round_no}</Button>
                      : <Button size="sm" variant="danger" loading={busy} icon={Undo2} disabled={comment.trim().length < 5 || (lastIncluded && !extraAck)} onClick={() => void decide(false)}>Send change request</Button>}
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="primary" icon={CheckCircle2} onClick={() => setMode('approve')}>Approve</Button>
                  <Button size="sm" icon={Undo2} onClick={() => setMode('changes')}>Request changes</Button>
                </div>
              )
            )}
            {r.status === 'pending' && !canReview && <p className="text-xs text-ink-3">Your organisation’s reviewer can approve this version.</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
