import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { log } from '../../lib/log';
import { createAssignedTask } from '../../lib/taskCreate';
import { notifyTaskAssigned } from '../../lib/notifications';
import { TaskAssignForm } from '../tasks/TaskAssignForm';
import { Modal } from '../../ui/Modal';
import type { Employee } from '../../types/attendance';

const db = () => supabase as any;

interface Row {
  id: string; title: string; status: string; due_date: string | null;
  assigned_to: string | null; research_minutes: number | null;
}

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Not started', accepted: 'Not started', in_progress: 'In progress',
  blocked: 'Blocked', awaiting_review: 'In review', revision_required: 'Changes asked',
  completed: 'Done', cancelled: 'Cancelled',
};
const STATUS_TONE: Record<string, string> = {
  assigned: 'bg-ink-100 text-ink-700', accepted: 'bg-ink-100 text-ink-700',
  in_progress: 'bg-brand-50 text-brand-700', blocked: 'bg-rose-50 text-rose-700',
  awaiting_review: 'bg-amber-50 text-amber-800', revision_required: 'bg-rose-50 text-rose-700',
  completed: 'bg-mint-50 text-mint-700', cancelled: 'bg-ink-100 text-ink-500',
};

const dayWord = (n: number) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

/**
 * The work inside one client deliverable: who is on what, how long the deliverable has sat in its
 * current stage, and what is holding it up. New tasks go through the same Assign work form the rest
 * of SIGMA uses, so every one carries a brief.
 */
export function DeliverableWork({
  deliverableId, deliverableLabel, status, stageSince, dueDate, employees, onChanged,
}: {
  deliverableId: string;
  deliverableLabel: string;
  status: string;
  stageSince: string | null;
  dueDate: string | null;
  employees: Employee[];
  onChanged?: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await db().from('tasks')
      .select('id, title, status, due_date, assigned_to, research_minutes')
      .eq('deliverable_id', deliverableId).is('archived_at', null)
      .order('due_date', { ascending: true, nullsFirst: false });
    if (e) { setError(e.message); setRows([]); return; }
    setError(''); setRows((data ?? []) as Row[]);
  }, [deliverableId]);

  useEffect(() => { void load(); }, [load]);

  const nameOf = useCallback(
    (id: string | null) => (id ? employees.find((e) => e.id === id)?.name ?? 'Someone' : null),
    [employees],
  );

  const daysInStage = useMemo(() => {
    if (!stageSince) return null;
    return Math.max(0, Math.floor((Date.now() - new Date(stageSince).getTime()) / 86_400_000));
  }, [stageSince]);

  const waitingOnClient = status === 'Awaiting Client Review' || status === 'Awaiting Client Dependency';

  const open = rows?.filter((r) => r.status !== 'completed' && r.status !== 'cancelled') ?? [];
  const done = rows?.filter((r) => r.status === 'completed').length ?? 0;
  const unassigned = open.filter((r) => !r.assigned_to).length;

  /** Hand a task to someone else without leaving the deliverable. */
  const moveTo = async (taskId: string, employeeId: string) => {
    if (!employeeId) return;
    setMoving(taskId);
    try {
      // An admin, or the person who assigned it, may change the owner directly; the database checks.
      const { error: e } = await db().from('tasks').update({ assigned_to: employeeId }).eq('id', taskId);
      if (e) throw new Error(e.message);
      const row = rows?.find((r) => r.id === taskId);
      if (row) void notifyTaskAssigned({ assigneeEmployeeId: employeeId, taskTitle: row.title, dueDate: row.due_date ?? '', taskId, actorUserId: '' });
      notify('Task moved.', 'success');
      await load();
      await onChanged?.();
    } catch (err) {
      log.error('reassign failed', err);
      notify(err instanceof Error ? err.message : 'Could not move this task.', 'error');
    } finally { setMoving(null); }
  };

  const submitNew = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    setBusy(true);
    try {
      await createAssignedTask(new FormData(form), { requestId: crypto.randomUUID(), deliverableId });
      notify('Task assigned.', 'success');
      setAddOpen(false);
      await load();
      await onChanged?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not assign this task.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <section>
      {/* Where it stands, in one line, before any list */}
      <div className="rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-3 mb-3">
        <p className="text-[13.5px] font-semibold text-ink-900">
          {waitingOnClient
            ? `Waiting on the client${daysInStage != null ? ` for ${dayWord(daysInStage)}` : ''}`
            : unassigned > 0
              ? `${unassigned} task${unassigned === 1 ? '' : 's'} with nobody on ${unassigned === 1 ? 'it' : 'them'}`
              : open.length === 0 && (rows?.length ?? 0) === 0
                ? 'No tasks yet — this deliverable has not been broken down'
                : `${open.length} task${open.length === 1 ? '' : 's'} still open`}
        </p>
        <p className="text-xs text-ink-500 mt-0.5">
          {status}
          {daysInStage != null && ` · ${dayWord(daysInStage)} in this stage`}
          {rows && rows.length > 0 && ` · ${done} of ${rows.length} done`}
          {dueDate && ` · due ${dueDate}`}
        </p>
      </div>

      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold">Tasks</h3>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" />Add a task
        </button>
      </div>

      {error && <p className="text-xs text-rose-700">{error}</p>}
      {rows === null && <p className="text-xs text-ink-400">Loading…</p>}
      {rows !== null && rows.length === 0 && !error && (
        <p className="text-xs text-ink-500">Nothing yet. Break the deliverable into the pieces people will actually do.</p>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-100 overflow-hidden">
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2 sm:gap-3 items-center px-3 py-2.5 bg-white">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-ink-900 truncate">{r.title}</p>
                <p className="text-xs text-ink-500">
                  {r.due_date ? `due ${r.due_date}` : 'no date'}
                  {r.research_minutes ? ` · ${r.research_minutes}m research` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 justify-start sm:justify-end">
                <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${STATUS_TONE[r.status] ?? 'bg-ink-100 text-ink-700'}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                <label className="sr-only" htmlFor={`own-${r.id}`}>Owner of {r.title}</label>
                <select
                  id={`own-${r.id}`}
                  className={`input !py-1.5 !text-[12.5px] w-36 ${r.assigned_to ? '' : 'border-amber-300 bg-amber-50 text-amber-900'}`}
                  value={r.assigned_to ?? ''}
                  disabled={moving === r.id}
                  onChange={(e) => void moveTo(r.id, e.target.value)}
                >
                  {!r.assigned_to && <option value="">Pick someone</option>}
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </li>
          ))}
        </ul>
      )}

      {rows !== null && rows.length > 0 && (
        <p className="text-xs text-ink-400 mt-2">
          Changing the owner here moves the task straight away — {nameOf(rows[0].assigned_to) ? 'the person is told' : 'they are told'} and it appears on their list.
        </p>
      )}

      {addOpen && (
        <Modal title="Assign work" onClose={() => setAddOpen(false)} closeDisabled={busy} wide>
          <TaskAssignForm
            targets={employees}
            onSubmit={submitNew}
            onClose={() => setAddOpen(false)}
            busy={busy}
            isAdmin
            fixedDeliverable={{ id: deliverableId, label: deliverableLabel }}
          />
        </Modal>
      )}

      {unassigned > 0 && (
        <p className="text-xs text-amber-800 mt-2 flex items-center gap-1.5">
          <UserPlus className="w-3.5 h-3.5" />
          A task with nobody on it blocks the whole deliverable.
        </p>
      )}
    </section>
  );
}
