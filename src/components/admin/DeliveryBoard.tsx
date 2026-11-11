import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, Clock3, Columns3, List, PauseCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { log } from '../../lib/log';
import { DELIVERY_STAGES, deliveryStageIndex } from '../../lib/deliveryStages';
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

interface DoneRow { id: string; name: string; client: string; project: string; at: string | null }

type FilterId = 'us' | 'client' | 'overdue' | 'stuck';
type ViewId = 'pipeline' | 'list';

const STUCK_DAYS = 5;
const SLOW_DAYS = 3;
const dayWord = (n: number) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);
const shortDate = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : '';

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

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

/** Who holds the ball in each column, so the board reads without a legend. */
const COLUMN_NOTE = ['waiting to begin', 'the team is making it', 'a manager checks it', 'their move', 'last 30 days'];
const COLUMN_DOT = ['bg-ink-300', 'bg-brand-600', 'bg-sky-400', 'bg-amber-400', 'bg-mint-500'];

/**
 * Where is everything — every open promise to a client.
 *
 * Two ways to look at the same rows: the PIPELINE lays them out left to right along the five steps a
 * deliverable walks (so a pile-up in one column is visible at a glance), the LIST ranks them by how
 * long they have sat still. "Stuck" counts days in the CURRENT stage, not days since the work began,
 * so a long job that is still moving does not look like a problem. The cards at the top are the
 * filter for both views.
 */
export function DeliveryBoard({ employees, myEmployeeId }: { employees: AssignTarget[]; myEmployeeId?: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [doneRows, setDoneRows] = useState<DoneRow[]>([]);
  /** deliverable id → the people holding its open tasks, for the initials on each card. */
  const [holders, setHolders] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterId | null>(null);
  const [view, setView] = useState<ViewId>('pipeline');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const { data, error: e } = await db().rpc('staff_delivery_board');
    if (e) { log.error('delivery board failed', e); setError(e.message); setRows([]); }
    else { setError(''); setRows((data ?? []) as BoardRow[]); }

    // Who is on each one. Shows only the tasks this person may see; the board works without it.
    try {
      const ids = ((data ?? []) as BoardRow[]).map((r) => r.deliverable_id);
      if (ids.length) {
        const { data: ts } = await db().from('tasks').select('deliverable_id, assigned_to, status')
          .in('deliverable_id', ids).is('archived_at', null);
        const map: Record<string, string[]> = {};
        for (const t of ((ts ?? []) as Array<{ deliverable_id: string; assigned_to: string | null; status: string }>)) {
          if (!t.assigned_to || t.status === 'completed' || t.status === 'cancelled') continue;
          const list = (map[t.deliverable_id] ??= []);
          if (!list.includes(t.assigned_to)) list.push(t.assigned_to);
        }
        setHolders(map);
      } else setHolders({});
    } catch (err) {
      log.warn('task holders failed', err);
      setHolders({});
    }

    // Recently approved work, for the last column. The board still works if this read fails.
    try {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data: fin } = await db().from('deliverables')
        .select('id, name, project_id, client_id, completed_at')
        .in('status', ['Completed', 'Ready for Download']).is('deleted_at', null)
        .gte('completed_at', since).order('completed_at', { ascending: false }).limit(12);
      const list = (fin ?? []) as Array<{ id: string; name: string; project_id: string | null; client_id: string | null; completed_at: string | null }>;
      const pids = Array.from(new Set(list.map((x) => x.project_id).filter(Boolean))) as string[];
      const cids = Array.from(new Set(list.map((x) => x.client_id).filter(Boolean))) as string[];
      const [pr, cl] = await Promise.all([
        pids.length ? db().from('projects').select('id, name').in('id', pids) : Promise.resolve({ data: [] }),
        cids.length ? db().from('clients').select('id, company_name').in('id', cids) : Promise.resolve({ data: [] }),
      ]);
      const pName = new Map<string, string>(((pr.data ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name] as [string, string]));
      const cName = new Map<string, string>(((cl.data ?? []) as Array<{ id: string; company_name: string }>).map((x) => [x.id, x.company_name] as [string, string]));
      setDoneRows(list.map((x) => ({ id: x.id, name: x.name, client: (x.client_id && cName.get(x.client_id)) || 'Client', project: (x.project_id && pName.get(x.project_id)) || '', at: x.completed_at })));
    } catch (err) {
      log.warn('recently approved list failed', err);
      setDoneRows([]);
    }
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    us: rows?.filter((r) => r.waiting_side === 'us').length ?? 0,
    client: rows?.filter((r) => r.waiting_side === 'client').length ?? 0,
    overdue: rows?.filter((r) => r.overdue).length ?? 0,
    stuck: rows?.filter((r) => r.days_in_stage >= STUCK_DAYS).length ?? 0,
  }), [rows]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? []).filter((r) => {
    if (filter === 'us' && r.waiting_side !== 'us') return false;
    if (filter === 'client' && r.waiting_side !== 'client') return false;
    if (filter === 'overdue' && !r.overdue) return false;
    if (filter === 'stuck' && r.days_in_stage < STUCK_DAYS) return false;
    if (!needle) return true;
    return `${r.client_name ?? ''} ${r.project_name ?? ''} ${r.deliverable_name} ${r.waiting_on}`.toLowerCase().includes(needle);
  }), [rows, filter, needle]);

  const shownDone = useMemo(
    () => (filter ? [] : doneRows.filter((r) => !needle || `${r.client} ${r.project} ${r.name}`.toLowerCase().includes(needle))),
    [doneRows, filter, needle],
  );

  /** The open rows, split along the track. Column 4 is the recently approved list. */
  const columns = useMemo(() => {
    const cols: BoardRow[][] = [[], [], [], []];
    for (const r of shown) cols[Math.min(3, deliveryStageIndex(r.status))].push(r);
    return cols;
  }, [shown]);

  const cards: Array<{ id: FilterId; label: string; sub: string; n: number; icon: React.ReactNode; tone: string }> = [
    { id: 'us', label: 'Waiting on us', sub: 'our move next', n: counts.us, icon: <Clock3 className="w-5 h-5" />, tone: 'text-brand-700 bg-brand-50' },
    { id: 'client', label: 'Waiting on the client', sub: 'sent, no reply', n: counts.client, icon: <PauseCircle className="w-5 h-5" />, tone: 'text-amber-800 bg-amber-50' },
    { id: 'overdue', label: 'Past the promised date', sub: 'already late', n: counts.overdue, icon: <CalendarClock className="w-5 h-5" />, tone: 'text-rose-700 bg-rose-50' },
    { id: 'stuck', label: `Stuck ${STUCK_DAYS} days or more`, sub: 'nothing moved', n: counts.stuck, icon: <AlertTriangle className="w-5 h-5" />, tone: 'text-rose-700 bg-rose-50' },
  ];

  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? 'Someone';
  const ageTone = (r: BoardRow) =>
    r.days_in_stage >= STUCK_DAYS ? 'bg-rose-50 text-rose-700' : r.days_in_stage >= SLOW_DAYS ? 'bg-amber-50 text-amber-800' : 'bg-ink-100 text-ink-600';
  const edgeTone = (r: BoardRow) =>
    r.overdue || r.days_in_stage >= STUCK_DAYS ? 'border-l-rose-400' : r.days_in_stage >= SLOW_DAYS ? 'border-l-amber-300' : 'border-l-transparent';

  return (
    <div className="space-y-5">
      {error && <div className="card p-4 text-[13px] text-rose-700">{error}</div>}

      {/* The cards are the filter. Pressing one again clears it. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((c, i) => {
          const on = filter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(on ? null : c.id)}
              className="card rise p-4 sm:p-5 text-left transition-shadow"
              style={{ ['--i' as string]: i, ...(on ? { borderColor: '#5b35e8', boxShadow: '0 0 0 2px #5b35e8' } : {}) } as React.CSSProperties}
            >
              <span className="flex items-center gap-2.5">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.tone}`}>{c.icon}</span>
                <span className="text-[13.5px] font-bold text-ink-900">{c.label}</span>
              </span>
              <span className="block stat-value text-[32px] text-ink-950 mt-3">{c.n}</span>
              <span className="block text-xs text-ink-500 mt-1.5">{on ? 'press again to clear' : c.sub}</span>
            </button>
          );
        })}
      </div>

      {/* Toolbar: one row for the view, the search and the refresh */}
      <div className="card p-3 sm:p-4 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="inline-flex p-1 rounded-full bg-ink-50 border border-ink-100" role="tablist" aria-label="How to show the deliverables">
            {([['pipeline', 'Pipeline', Columns3], ['list', 'List', List]] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-colors ${view === id ? 'bg-ink-950 text-white' : 'text-ink-600 hover:text-ink-900'}`}
              >
                <Icon className="w-4 h-4" />{label}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-ink-500 truncate">
            <strong className="text-ink-900">{shown.length}</strong> open{filter ? ` · ${cards.find((c) => c.id === filter)?.label.toLowerCase()}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="delivery-q" className="sr-only">Search client, project or deliverable</label>
          <input
            id="delivery-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search client, project, deliverable"
            className="input !py-2 !text-[13px] w-full sm:w-72"
          />
          <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>
      </div>

      {rows === null && <div className="card p-6 text-[13px] text-ink-400">Loading…</div>}

      {/* ------------------------------------------------ Pipeline */}
      {rows !== null && view === 'pipeline' && (
        <div className="overflow-x-auto pb-2 -mx-1 px-1">
          <div className="flex gap-4 min-w-max lg:min-w-0">
            {DELIVERY_STAGES.map((stage, ci) => {
              const isDone = ci === 4;
              const list = isDone ? [] : columns[ci];
              const n = isDone ? shownDone.length : list.length;
              return (
                <section key={stage.id} className="w-[260px] lg:w-auto lg:flex-1 lg:min-w-0 shrink-0 rounded-[24px] bg-white/60 border border-ink-100 p-3" aria-label={stage.name}>
                  <header className="px-1.5 pb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[13.5px] font-bold text-ink-900">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${COLUMN_DOT[ci]}`} />{stage.name}
                      </p>
                      <p className="text-[11.5px] text-ink-500 mt-0.5 pl-[18px]">{COLUMN_NOTE[ci]}</p>
                    </div>
                    <span className="text-[12px] font-bold text-ink-700 bg-ink-100 rounded-full px-2 py-0.5 tnum">{n}</span>
                  </header>

                  <ul className="space-y-2.5">
                    {!isDone && list.map((r, i) => {
                      const pct = r.tasks_total ? Math.round((r.tasks_done / r.tasks_total) * 100) : 0;
                      return (
                        <li key={r.deliverable_id} className="rise" style={{ ['--i' as string]: Math.min(i, 8) } as React.CSSProperties}>
                          <button
                            type="button"
                            onClick={() => setOpenId(r.deliverable_id)}
                            className={`w-full text-left rounded-2xl bg-white border border-ink-100 border-l-4 ${edgeTone(r)} p-3 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all`}
                          >
                            <span className="flex items-start justify-between gap-2">
                              <span className="text-[11.5px] font-bold text-ink-500 truncate">{r.client_name ?? 'No client'}</span>
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${ageTone(r)}`}>{dayWord(r.days_in_stage)}</span>
                            </span>
                            <span className="block text-[14px] font-bold text-ink-950 leading-snug mt-1">{r.deliverable_name}</span>
                            {r.project_name && <span className="block text-[11.5px] text-ink-500 truncate">{r.project_name}</span>}

                            <span className="block mt-2.5">
                              <span className="block h-1.5 rounded-full bg-ink-100 overflow-hidden">
                                <span className={`block h-full rounded-full grow-x ${pct === 100 ? 'bg-mint-500' : 'bg-brand-600'}`} style={{ width: `${pct}%` }} />
                              </span>
                              <span className="flex items-center justify-between gap-2 mt-1.5 text-[11.5px]">
                                <span className={r.tasks_total === 0 || r.tasks_unassigned > 0 ? 'font-bold text-rose-700' : 'text-ink-500'}>
                                  {r.tasks_total === 0 ? 'no tasks yet' : r.tasks_unassigned > 0 ? `${r.tasks_unassigned} unassigned` : `${r.tasks_done} of ${r.tasks_total} tasks`}
                                </span>
                                {r.due_date && <span className={r.overdue ? 'font-bold text-rose-700' : 'text-ink-500'}>{r.overdue ? 'late · ' : 'due '}{shortDate(r.due_date)}</span>}
                              </span>
                            </span>

                            {(holders[r.deliverable_id]?.length ?? 0) > 0 && (
                              <span className="flex items-center mt-2.5 pt-2.5 border-t border-ink-100">
                                {holders[r.deliverable_id].slice(0, 4).map((id, hi) => (
                                  <span
                                    key={id}
                                    title={nameOf(id)}
                                    className={`w-6 h-6 rounded-full bg-brand-50 text-brand-700 border-2 border-white text-[9.5px] font-extrabold flex items-center justify-center ${hi ? '-ml-1.5' : ''}`}
                                  >
                                    {initials(nameOf(id))}
                                  </span>
                                ))}
                                {holders[r.deliverable_id].length > 4 && <span className="ml-1 text-[11px] font-bold text-ink-500">+{holders[r.deliverable_id].length - 4}</span>}
                                <span className="ml-2 text-[11.5px] text-ink-500 truncate">
                                  {holders[r.deliverable_id].length === 1 ? nameOf(holders[r.deliverable_id][0]) : `${holders[r.deliverable_id].length} people on it`}
                                </span>
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}

                    {isDone && shownDone.map((r, i) => (
                      <li key={r.id} className="rise" style={{ ['--i' as string]: Math.min(i, 8) } as React.CSSProperties}>
                        <button
                          type="button"
                          onClick={() => setOpenId(r.id)}
                          className="w-full text-left rounded-2xl bg-white border border-ink-100 p-3 hover:shadow-md hover:-translate-y-0.5 transition-all"
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="text-[11.5px] font-bold text-ink-500 truncate">{r.client}</span>
                            <span className="w-5 h-5 rounded-full bg-mint-500 text-white flex items-center justify-center shrink-0"><Check className="w-3 h-3" strokeWidth={3} /></span>
                          </span>
                          <span className="block text-[14px] font-bold text-ink-950 leading-snug mt-1">{r.name}</span>
                          <span className="block text-[11.5px] text-ink-500 mt-0.5">{r.at ? `approved ${shortDate(r.at)}` : 'approved'}</span>
                        </button>
                      </li>
                    ))}

                    {n === 0 && (
                      <li className="rounded-2xl border border-dashed border-ink-200 px-3 py-6 text-center text-[12px] text-ink-400">
                        {isDone && filter ? 'hidden while a filter is on' : 'nothing here'}
                      </li>
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {/* ------------------------------------------------ List */}
      {rows !== null && view === 'list' && (
        <div className="card overflow-hidden">
          {shown.length === 0 && (
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
                    className="w-full text-left px-4 py-3.5 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,320px)] gap-2 md:gap-4 items-center hover:bg-ink-50/60"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-bold text-ink-900 truncate">{r.client_name ?? 'No client'}</span>
                      <span className="block text-xs text-ink-500 truncate">{r.project_name ?? '—'}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-ink-900 truncate">{r.deliverable_name}</span>
                      <span className="block text-xs text-ink-500 truncate">
                        {r.tasks_total === 0 ? 'no tasks created yet' : r.tasks_unassigned > 0 ? `${r.tasks_unassigned} task${r.tasks_unassigned === 1 ? '' : 's'} with nobody on it` : `waiting on ${r.waiting_on}`}
                        {r.tasks_total > 0 && ` · ${r.tasks_done} of ${r.tasks_total} tasks done`}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 md:justify-end">
                      <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STAGE_TONE[r.status] ?? 'bg-ink-100 text-ink-700'}`}>{r.status}</span>
                      <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${ageTone(r)}`}>{dayWord(r.days_in_stage)}</span>
                      {r.overdue && <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-rose-50 text-rose-700">Overdue</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {rows !== null && (
        <p className="text-xs text-ink-400">
          The day count is time in the current step, not since the work began. Amber is {SLOW_DAYS}+ days without moving, red is {STUCK_DAYS}+ or past its date. Open any card for its tasks, journey and record.
        </p>
      )}

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
