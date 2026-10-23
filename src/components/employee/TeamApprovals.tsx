import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCheck, FileText, RefreshCw, X } from 'lucide-react';
import { CHAIN_LABEL, leaveApi, useLeavePolicy, type TeamLeaveRequest } from '../../lib/leave';
import { openFile } from '../../lib/sigma';
import { notify } from '../../lib/toast';
import { dateLabel } from '../../lib/v2';
import { Avatar, Badge, Button, Card, EmptyState, Notice, Page, PageHeader, PillTabs, Skeleton, StatusBadge } from '../../ui';
import { Modal } from '../../ui/Modal';

/** Reporting managers review their team's leave here. */
export function TeamApprovals({ onRefresh }: { onRefresh?: () => Promise<void> }) {
  const policy = useLeavePolicy();
  const [rows, setRows] = useState<TeamLeaveRequest[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'waiting' | 'recent'>('waiting');
  const [deciding, setDeciding] = useState<{ row: TeamLeaveRequest; decision: 'approved' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setRows(await leaveApi.teamRequests());
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load your team’s requests.');
      setState('error');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const waiting = useMemo(() => rows.filter((r) => r.status === 'pending' && r.manager_status === 'pending'), [rows]);
  const recent = useMemo(() => rows.filter((r) => !(r.status === 'pending' && r.manager_status === 'pending')), [rows]);
  const shown = tab === 'waiting' ? waiting : recent;
  const typeName = (code: string) => policy.types.find((t) => t.code === code)?.name ?? code;

  async function viewDocs(r: TeamLeaveRequest) {
    try {
      const docs = await leaveApi.documents(r.id);
      if (!docs.length) { notify('No document attached yet.', 'info'); return; }
      await openFile(docs[0], false);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Unable to open the document.', 'error');
    }
  }

  async function decide() {
    if (!deciding) return;
    if (deciding.decision === 'rejected' && !note.trim()) { notify('Give a reason for rejecting.', 'error'); return; }
    setBusy(true);
    try {
      const result = await leaveApi.managerReview(deciding.row.id, deciding.decision, note.trim() || null);
      notify(result === 'forwarded' ? 'Approved — sent to admin for final approval.' : result === 'approved' ? 'Leave approved.' : 'Leave rejected.', 'success');
      setDeciding(null);
      setNote('');
      await load();
      await onRefresh?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Unable to save your decision.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Team approvals"
        subtitle="Leave requests from people who report to you."
        actions={<button type="button" className="btn-secondary" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</button>}
      />
      {policy.ready && policy.chain === 'admin' && (
        <Notice tone="sky" title={CHAIN_LABEL.admin.title}>Your company currently sends leave straight to administrators. You’ll still see your team’s requests here.</Notice>
      )}
      {state === 'error' && <Notice tone="rose">{error}</Notice>}

      <PillTabs value={tab} onChange={setTab} items={[{ id: 'waiting', label: 'Waiting for you', count: waiting.length || undefined }, { id: 'recent', label: 'Recent', count: recent.length || undefined }]} />

      {state === 'loading' ? (
        <Card className="p-5 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}</Card>
      ) : shown.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((r, i) => (
            <Card key={r.id} index={i} className="p-5">
              <div className="flex items-start gap-3">
                <Avatar name={r.employee_name} src={r.avatar_url} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="font-display font-bold text-[15px] text-ink-900 truncate">{r.employee_name}</p>
                  <p className="text-[12px] text-ink-500">{r.designation ?? '—'}</p>
                </div>
                {r.status === 'pending' && r.manager_status === 'pending'
                  ? <Badge tone="amber" dot>Needs you</Badge>
                  : r.status === 'pending' ? <Badge tone="brand" dot>With admin</Badge>
                  : <StatusBadge status={r.status} label={r.status === 'cancelled' ? 'Withdrawn' : undefined} />}
              </div>
              <div className="mt-4 rounded-2xl bg-ink-50 px-4 py-3">
                <p className="text-sm font-bold text-ink-900">{typeName(r.leave_type)} leave · {Number(r.days)} day{Number(r.days) === 1 ? '' : 's'}{r.duration === 'half' ? ' (half day)' : ''}</p>
                <p className="text-[12px] text-ink-500 tnum mt-0.5">{r.start_date === r.end_date ? dateLabel(r.start_date, { weekday: 'short', day: 'numeric', month: 'short' }) : `${dateLabel(r.start_date)} → ${dateLabel(r.end_date)}`}{r.available_paid != null ? ` · ${Number(r.available_paid)} paid day(s) available` : ''}</p>
                {r.reason && <p className="text-[13px] text-ink-700 mt-2">{r.reason}</p>}
                {r.manager_note && <p className="text-[12px] text-ink-500 mt-2"><b className="text-ink-700">Your note:</b> {r.manager_note}</p>}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {r.has_document && <button type="button" className="btn-ghost btn-sm" onClick={() => void viewDocs(r)}><FileText className="w-3.5 h-3.5" /> View document</button>}
                {r.status === 'pending' && r.manager_status === 'pending' && (
                  <div className="ml-auto flex gap-2">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => { setNote(''); setDeciding({ row: r, decision: 'rejected' }); }}><X className="w-3.5 h-3.5" /> Reject</button>
                    <button type="button" className="btn-primary btn-sm" onClick={() => { setNote(''); setDeciding({ row: r, decision: 'approved' }); }}><Check className="w-3.5 h-3.5" /> Approve</button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : state === 'ready' ? (
        <Card><EmptyState icon={<ClipboardCheck className="w-6 h-6" />} title={tab === 'waiting' ? 'Nothing waiting for you' : 'No recent requests'} text={tab === 'waiting' ? 'New leave requests from your team show up here.' : 'Decided requests from the last 60 days appear here.'} /></Card>
      ) : null}

      {deciding && (
        <Modal title={deciding.decision === 'approved' ? 'Approve leave' : 'Reject leave'} onClose={() => setDeciding(null)} closeDisabled={busy}>
          <div className="space-y-4">
            <p className="text-sm text-ink-600">
              {deciding.row.employee_name} · {typeName(deciding.row.leave_type)} leave, {Number(deciding.row.days)} day(s) from {dateLabel(deciding.row.start_date)}.
              {deciding.decision === 'approved' && policy.chain === 'manager_then_admin' ? ' An admin gives the final approval after you.' : ''}
            </p>
            <label className="block">
              <span className="label">{deciding.decision === 'approved' ? 'Note (optional)' : 'Reason'}</span>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={deciding.decision === 'approved' ? 'Anything the employee or admin should know' : 'Tell them why, so they can plan'} />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeciding(null)} disabled={busy}>Cancel</Button>
              <Button variant={deciding.decision === 'approved' ? 'primary' : 'danger'} loading={busy} onClick={() => void decide()}>{deciding.decision === 'approved' ? 'Approve' : 'Reject'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
