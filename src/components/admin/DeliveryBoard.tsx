import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Clock3, PauseCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { log } from '../../lib/log';
import { DeliverablePage } from '../delivery/DeliverablePage';
import type { AssignTarget } from '../tasks/TaskAssignForm';

const db = () => supabase as any;

export interface BoardRow {
  deliverable_id: string; deliverable_name: string; project_id: string; project_name: string | null;
  client_id: string | null; client_name: string | null; due_date: string | null; status: string;
  lock_state: string; stage_since: string | null; days_in_stage: number;
  waiting_side: 'us' | 'client' | 'done'; waiting_on: string;
  tasks_total: number; tasks_done: number; tasks_unassigned: number; overdue: boolean;
}

type FilterId = 'us' | 'client' | 'overdue' | 'stuck';

const STUCK_DAYS = 5;
const dayWord = (n: number) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

const STAGE_TONE: Record<string, string> = {
  'Awaiting Client Review': 'bg-amber-50 text-amber-800',
  'Awaiting Client Dependency': 'bg-amber-50 text-amber-800',
  'Modification Requested': 'bg-rose-50 text-rose-700',
  'Revision In Progress': 'bg-rose-50 text-rose-700',
  'Under Internal Review': 'bg-brand-50 text-brand-700',
  'In Progress': 'bg-brand-50 text-brand-700',
  Draft: 'bg-ink-100 text-ink-600',
  Pending: 'bg-ink-100 text-ink-600',
};

/**
 * Where is everything — every open promise to a client, longest in its current stage first.
 *
 * "Stuck" counts days in the CURRENT stage, not days since the work started, so a long job that is
 * still moving does not look like a problem. The cards at the top are the filter: there is no second
 * row of tabs underneath saying the same thing.
 */
export function DeliveryBoard({ employees, myEmployeeId }: { employees: AssignTarget[]; myEmployeeId?: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterId | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const { data, error: e } = await db().rpc('staff_delivery_board');
    if (e) { log.error('delivery board failed', e); setError(e.message); setRows([]); }
    else { setError(''); setRows((data ?? []) as BoardRow[]); }
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    us: rows?.filter((r) => r.waiting_side === 'us').length ?? 0,
    client: rows?.filter((r) => r.waiting_side === 'client').length ?? 0,
    overdue: rows?.filter((r) => r.overdue).length ?? 0,
    stuck: rows?.filter((r) => r.days_in_stage >= STUCK_DAYS).length ?? 0,
  }), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (filter === 'us' && r.waiting_side !== 'us') return false;
      if (filter === 'client' && r.waiting_side !== 'client') return false;
      if (filter === 'overdue' && !r.overdue) return false;
      if (filter === 'stuck' && r.days_in_stage < STUCK_DAYS) return false;
      if (!needle) return true;
      return `${r.client_name ?? ''} ${r.project_name ?? ''} ${r.deliverable_name} ${r.waiting_on}`.toLowerCase().includes(needle);
    });
  }, [rows, filter, q]);

  const cards: Array<{ id: FilterId; label: string; sub: string; n: number; icon: React.ReactNode; tone: string }> = [
    { id: 'us', label: 'Waiting on us', sub: 'our move next', n: counts.us, icon: <Clock3 className="w-5 h-5" />, tone: 'text-brand-700 bg-brand-50' },
    { id: 'client', label: 'Waiting on the client', sub: 'sent, no reply', n: counts.client, icon: <PauseCircle className="w-5 h-5" />, tone: 'text-amber-800 bg-amber-50' },
    { id: 'overdue', label: 'Past the promised date', sub: 'already late', n: counts.overdue, icon: <CalendarClock className="w-5 h-5" />, tone: 'text-rose-700 bg-rose-50' },
    { id: 'stuck', label: `Stuck ${STUCK_DAYS} days or more`, sub: 'nothing moved', n: counts.stuck, icon: <AlertTriangle className="w-5 h-5" />, tone: 'text-rose-700 bg-rose-50' },
  ];

  return (
    <div className="space-y-5">
      {error && <div className="card p-4 text-[13px] text-rose-700">{error}</div>}

      {/* The cards are the filter. Pressing one again clears it. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((c) => {
          const on = filter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(on ? null : c.id)}
              className={`card p-4 sm:p-5 text-left transition-colors ${on ? 'ring-2 ring-brand-500 border-brand-200' : 'hover:border-ink-200'}`}
            >
              <span className="flex items-center gap-2.5">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.tone}`}>{c.icon}</span>
                <span className="text-[13.5px] font-bold text-ink-900">{c.label}</span>
              </span>
              <span className="block text-3xl font-extrabold tracking-tight mt-2">{c.n}</span>
              <span className="block text-xs text-ink-500 mt-0.5">{on ? 'showing these — press again to clear' : c.sub}</span>
            </button>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-ink-100 flex flex-wrap gap-3 items-center justify-between">
          <h2 className="text-[15px] font-bold">
            {filter ? cards.find((c) => c.id === filter)?.label : 'Every open deliverable'}
            <span className="ml-2 text-xs font-semibold text-ink-500">{shown.length}</span>
          </h2>
          <div className="flex items-center gap-2">
            <label htmlFor="delivery-q" className="sr-only">Search client, project or deliverable</label>
            <input
              id="delivery-q"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search client, project, deliverable"
              className="input !py-2 !text-[13px] w-full sm:w-72"
            />
            <button type="button" className="btn-secondary btn-sm" onClick={() => void load()} disabled={busy}>
              <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />Refresh
            </button>
          </div>
        </div>

        {rows === null && <p className="p-5 text-[13px] text-ink-400">Loading…</p>}
        {rows !== null && shown.length === 0 && (
          <p className="p-5 text-[13px] text-ink-500">
            {rows.length === 0 ? 'Nothing open. Every deliverable is finished or cancelled.' : 'Nothing matches that.'}
          </p>
        )}

        {shown.length > 0 && (
          <ul className="divide-y divide-ink-100">
            {shown.map((r) => (
              <li key={r.deliverable_id}>
                <button
                  type="button"
                  onClick={() => setOpenId(r.deliverable_id)}
                  className="w-full text-left px-4 py-3.5 grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] gap-2 md:gap-4 items-center hover:bg-ink-50/60"
                >
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-bold text-ink-900 truncate">{r.client_name ?? 'No client'}</span>
                    <span className="block text-xs text-ink-500 truncate">{r.project_name ?? '—'}</span>
                  </span>

                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-ink-900 truncate">{r.deliverable_name}</span>
                    <span className="block text-xs text-ink-500 truncate">
                      waiting on {r.waiting_on}
                      {r.tasks_total > 0 && ` · ${r.tasks_done} of ${r.tasks_total} tasks done`}
                    </span>
                  </span>

                  <span className="flex flex-wrap items-center gap-2 md:justify-end">
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STAGE_TONE[r.status] ?? 'bg-ink-100 text-ink-700'}`}>
                      {r.status}
                    </span>
                    <span className={`text-[12px] font-bold ${r.days_in_stage >= STUCK_DAYS ? 'text-rose-700' : 'text-ink-600'}`}>
                      {dayWord(r.days_in_stage)}
                    </span>
                    {r.overdue && <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-rose-50 text-rose-700">Overdue</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="px-4 py-3 text-xs text-ink-400 border-t border-ink-100">
          Days counted in the current stage, not since the work began. Open any row for its tasks, journey and record.
        </p>
      </div>

      {openId && (
        <DeliverablePage
          deliverableId={openId}
          employees={employees}
          myEmployeeId={myEmployeeId}
          onClose={() => { setOpenId(null); void load(); }}
        />
      )}
    </div>
  );
}
