import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, History, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Avatar, Badge, Card, EmptyState, Notice, Page, PageHeader, PillTabs, Skeleton, cx, type Tone } from '../../ui';

const PAGE = 50;

const ENTITY_LABEL: Record<string, string> = {
  clients: 'Client',
  client_users: 'Client user',
  projects: 'Project',
  contracts: 'Contract',
  contract_versions: 'Contract version',
  contract_acceptances: 'Contract acceptance',
  deliverables: 'Deliverable',
  deliverable_dependencies: 'Client dependency',
  change_requests: 'Modification request',
  payment_installments: 'Payment milestone',
  payments: 'Payment',
  files: 'File',
  tasks: 'Task',
  leave_requests: 'Leave request',
  wfh_requests: 'WFH request',
  employees: 'Employee',
  billing_settings: 'Billing rules',
  client_billing_rules: 'Client billing rules',
  user_roles: 'Role assignment',
  role_permissions: 'Role permission',
};

const GROUPS: Record<string, string[] | null> = {
  all: null,
  contracts: ['contracts', 'contract_versions', 'contract_acceptances'],
  delivery: ['deliverables', 'deliverable_dependencies', 'change_requests', 'files', 'tasks', 'projects'],
  billing: ['payment_installments', 'payments', 'billing_settings', 'client_billing_rules'],
  access: ['clients', 'client_users', 'employees', 'user_roles', 'role_permissions'],
};

const ACTION_TONE: Record<string, Tone> = { insert: 'mint', update: 'brand', delete: 'rose' };
const ACTION_WORD: Record<string, string> = { insert: 'created', update: 'changed', delete: 'removed' };
const HIDDEN_FIELDS = new Set(['id', 'created_at', 'updated_at', 'token_hash', 'idempotency_key', 'client_id', 'project_id']);

interface Row {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_role: string | null;
  project_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  changes: Record<string, any> | null;
  reason: string | null;
}

const fmt = (v: any): string => {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};
const label = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function fieldChanges(row: Row): Array<{ field: string; from?: string; to: string }> {
  const c = row.changes ?? {};
  if (row.action === 'update') {
    return Object.entries(c)
      .filter(([k]) => !HIDDEN_FIELDS.has(k))
      .map(([k, v]: [string, any]) => ({ field: label(k), from: fmt(v?.from), to: fmt(v?.to) }));
  }
  return Object.entries(c)
    .filter(([k, v]) => !HIDDEN_FIELDS.has(k) && v != null && v !== '' && typeof v !== 'object')
    .slice(0, 8)
    .map(([k, v]) => ({ field: label(k), to: fmt(v) }));
}

export function ActivityLogPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [group, setGroup] = useState<keyof typeof GROUPS>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const fetchPage = useCallback(
    async (offset: number) => {
      let q = (supabase as any)
        .from('audit_logs')
        .select('id, occurred_at, actor_id, actor_role, project_id, entity_type, entity_id, action, changes, reason')
        .order('occurred_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      const g = GROUPS[group];
      if (g) q = q.in('entity_type', g);
      if (from) q = q.gte('occurred_at', `${from}T00:00:00+05:30`);
      if (to) q = q.lte('occurred_at', `${to}T23:59:59+05:30`);
      const { data, error: err } = await q;
      if (err) throw err;
      return (data ?? []) as Row[];
    },
    [group, from, to]
  );

  const resolveNames = useCallback(async (list: Row[]) => {
    const db = supabase as any;
    const actorIds = Array.from(new Set(list.map((r) => r.actor_id).filter(Boolean))) as string[];
    const projectIds = Array.from(new Set(list.map((r) => r.project_id).filter(Boolean))) as string[];
    const [emp, cu, pr] = await Promise.all([
      actorIds.length ? db.from('employees').select('profile_id, name').in('profile_id', actorIds) : { data: [] },
      actorIds.length ? db.from('client_users').select('profile_id, full_name, clients:client_id (company_name)').in('profile_id', actorIds) : { data: [] },
      projectIds.length ? db.from('projects').select('id, name').in('id', projectIds) : { data: [] },
    ]);
    setNames((prev) => {
      const next = { ...prev };
      for (const e of emp.data ?? []) next[e.profile_id] = e.name;
      for (const c of cu.data ?? []) next[c.profile_id] = `${c.full_name ?? 'Client user'}${c.clients?.company_name ? ` (${c.clients.company_name})` : ''}`;
      return next;
    });
    setProjects((prev) => {
      const next = { ...prev };
      for (const p of pr.data ?? []) next[p.id] = p.name;
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(0);
      setRows(page);
      setMore(page.length === PAGE);
      await resolveNames(page);
    } catch (e: any) {
      setError(e?.message ?? 'Unable to load the activity log.');
    } finally {
      setLoading(false);
    }
  }, [fetchPage, resolveNames]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = async () => {
    try {
      const page = await fetchPage(rows.length);
      setRows((r) => [...r, ...page]);
      setMore(page.length === PAGE);
      await resolveNames(page);
    } catch (e: any) {
      setError(e?.message ?? 'Unable to load more.');
    }
  };

  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const d = new Date(r.occurred_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      m.set(d, [...(m.get(d) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);

  const who = (r: Row) => (r.actor_id ? names[r.actor_id] ?? (r.actor_role === 'admin' ? 'Administrator' : 'User') : 'System');

  return (
    <Page>
      <PageHeader
        title="Activity log"
        subtitle="Every important change — who made it, when, and what it was before. Entries can’t be edited or deleted."
        actions={<button type="button" className="btn-secondary" onClick={() => void reload()}><RefreshCw className="w-4 h-4" /> Refresh</button>}
      />
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
        <PillTabs
          value={group}
          onChange={setGroup}
          items={[
            { id: 'all', label: 'Everything' },
            { id: 'contracts', label: 'Contracts' },
            { id: 'delivery', label: 'Delivery' },
            { id: 'billing', label: 'Billing' },
            { id: 'access', label: 'People & access' },
          ]}
        />
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input !w-auto !min-h-[40px] !rounded-full !text-[13px]" aria-label="From date" />
          <span className="text-ink-400 text-sm">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input !w-auto !min-h-[40px] !rounded-full !text-[13px]" aria-label="To date" />
        </div>
      </div>

      {error && <Notice tone="rose">{error}</Notice>}

      {loading ? (
        <Card className="p-6 space-y-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}</Card>
      ) : rows.length ? (
        <div className="space-y-5">
          {byDay.map(([day, items]) => (
            <section key={day} className="space-y-2">
              <p className="eyebrow">{new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
              <Card className="divide-y divide-ink-100">
                {items.map((r) => {
                  const changes = fieldChanges(r);
                  const expanded = open[r.id];
                  const shown = expanded ? changes : changes.slice(0, 3);
                  return (
                    <article key={r.id} className="px-5 py-4 flex gap-4">
                      <Avatar name={who(r)} size={36} tone={r.actor_id ? 'brand' : 'ink'} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink-700">
                          <b className="text-ink-900">{who(r)}</b> {ACTION_WORD[r.action] ?? r.action} {/^[aeiou]/i.test(ENTITY_LABEL[r.entity_type] ?? r.entity_type) ? 'an' : 'a'} <b className="text-ink-900">{(ENTITY_LABEL[r.entity_type] ?? label(r.entity_type)).toLowerCase()}</b>
                          {r.project_id && projects[r.project_id] ? <> in <span className="font-semibold text-ink-800">{projects[r.project_id]}</span></> : null}
                        </p>
                        <p className="text-xs text-ink-400 mt-0.5 tnum">
                          {new Date(r.occurred_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                          {r.reason ? ` · “${r.reason}”` : ''}
                        </p>
                        {shown.length > 0 && (
                          <ul className="mt-2.5 space-y-1">
                            {shown.map((c) => (
                              <li key={c.field} className="text-[13px] text-ink-600 flex flex-wrap gap-x-2">
                                <span className="font-semibold text-ink-700">{c.field}</span>
                                {c.from !== undefined ? (
                                  <span className="tnum"><span className="line-through decoration-ink-300 text-ink-400">{c.from}</span> → <span className="text-ink-900">{c.to}</span></span>
                                ) : (
                                  <span className="tnum text-ink-900">{c.to}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {changes.length > 3 && (
                          <button type="button" className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-700" onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}>
                            {expanded ? 'Show less' : `${changes.length - 3} more field${changes.length - 3 === 1 ? '' : 's'}`}
                            <ChevronDown className={cx('w-3.5 h-3.5 transition-transform', expanded && 'rotate-180')} />
                          </button>
                        )}
                      </div>
                      <Badge tone={ACTION_TONE[r.action] ?? 'ink'} className="self-start">{ENTITY_LABEL[r.entity_type] ?? label(r.entity_type)}</Badge>
                    </article>
                  );
                })}
              </Card>
            </section>
          ))}
          {more && (
            <div className="flex justify-center">
              <button type="button" className="btn-secondary" onClick={() => void loadMore()}>Load older activity</button>
            </div>
          )}
        </div>
      ) : (
        <Card><EmptyState icon={<History className="w-6 h-6" />} title="No activity in this range" text="Changes to contracts, deliverables, billing and access appear here as they happen." /></Card>
      )}
    </Page>
  );
}
