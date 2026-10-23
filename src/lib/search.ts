import { supabase } from './supabase';

/**
 * Global search for staff. Every query goes through PostgREST, so row-level
 * security decides what each person can find — an employee only finds the
 * clients, projects and tasks they can already open.
 */
export type SearchKind = 'client' | 'project' | 'contract' | 'deliverable' | 'invoice' | 'task' | 'file' | 'employee';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  /** "tab?query" understood by the portal's navigate() */
  to: string | null;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  client: 'Clients', project: 'Projects', contract: 'Contracts', deliverable: 'Deliverables',
  invoice: 'Invoices & milestones', task: 'Tasks', file: 'Files', employee: 'People',
};

const db = supabase as any;
const LIMIT = 6;

/** Characters that would break a PostgREST or() filter. */
const clean = (q: string) => q.replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim();

export async function globalSearch(raw: string, role: 'admin' | 'employee' | string): Promise<SearchHit[]> {
  const q = clean(raw);
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const anyLike = `*${q}*`; // or() filters use * as the wildcard
  const admin = role === 'admin';
  const projectLink = (projectId: string | null | undefined, view?: string) =>
    projectId ? (admin ? `admin-clients?project=${projectId}${view ? `&view=${view}` : ''}` : `emp-client-work?project=${projectId}${view ? `&view=${view}` : ''}`) : null;

  const settle = async <T,>(p: Promise<{ data: T[] | null; error: any }>): Promise<T[]> => {
    try { const { data, error } = await p; return error ? [] : data ?? []; } catch { return []; }
  };

  const [clients, projects, contracts, deliverables, invoices, tasks, files, people] = await Promise.all([
    settle<any>(db.from('clients').select('id, company_name, primary_contact, email').is('deleted_at', null)
      .or(`company_name.ilike.${anyLike},primary_contact.ilike.${anyLike},email.ilike.${anyLike}`).limit(LIMIT)),
    settle<any>(db.from('projects').select('id, name, status, clients:client_id (company_name)').is('deleted_at', null)
      .ilike('name', like).limit(LIMIT)),
    settle<any>(db.from('contracts').select('id, title, ref, status, project_id, projects:project_id (name)').is('deleted_at', null)
      .or(`title.ilike.${anyLike},ref.ilike.${anyLike}`).limit(LIMIT)),
    settle<any>(db.from('deliverables').select('id, name, deliverable_number, status, project_id, projects:project_id (name)').is('deleted_at', null)
      .or(`name.ilike.${anyLike},deliverable_number.ilike.${anyLike}`).limit(LIMIT)),
    settle<any>(db.from('payment_installments').select('id, name, invoice_number, status, project_id, projects:project_id (name)').is('deleted_at', null)
      .or(`name.ilike.${anyLike},invoice_number.ilike.${anyLike}`).limit(LIMIT)),
    settle<any>(db.from('tasks').select('id, title, status, due_date').is('archived_at', null).ilike('title', like).limit(LIMIT)),
    settle<any>(db.from('files').select('id, name, parent_type, project_id, created_at').is('deleted_at', null).ilike('name', like).limit(LIMIT)),
    admin
      ? settle<any>(db.from('employees').select('id, name, emp_id, login_id, status').or(`name.ilike.${anyLike},emp_id.ilike.${anyLike},login_id.ilike.${anyLike}`).limit(LIMIT))
      : Promise.resolve([]),
  ]);

  const hits: SearchHit[] = [];
  for (const c of clients) hits.push({ kind: 'client', id: c.id, title: c.company_name, subtitle: [c.primary_contact, c.email].filter(Boolean).join(' · '), to: admin ? `admin-clients?client=${c.id}` : 'emp-client-work' });
  for (const p of projects) hits.push({ kind: 'project', id: p.id, title: p.name, subtitle: [p.clients?.company_name, p.status].filter(Boolean).join(' · '), to: projectLink(p.id) });
  for (const c of contracts) hits.push({ kind: 'contract', id: c.id, title: c.title, subtitle: [c.ref, c.projects?.name, c.status].filter(Boolean).join(' · '), to: projectLink(c.project_id, 'contract') });
  for (const d of deliverables) hits.push({ kind: 'deliverable', id: d.id, title: d.name, subtitle: [d.deliverable_number, d.projects?.name, d.status].filter(Boolean).join(' · '), to: projectLink(d.project_id, 'deliverables') });
  for (const i of invoices) hits.push({ kind: 'invoice', id: i.id, title: i.invoice_number ? `${i.invoice_number} · ${i.name}` : i.name, subtitle: [i.projects?.name, i.status].filter(Boolean).join(' · '), to: projectLink(i.project_id, 'billing') });
  for (const t of tasks) hits.push({ kind: 'task', id: t.id, title: t.title, subtitle: [t.status?.replace(/_/g, ' '), t.due_date ? `due ${t.due_date}` : null].filter(Boolean).join(' · '), to: `${admin ? 'admin-tasks' : 'emp-tasks'}?task=${t.id}` });
  for (const f of files) hits.push({ kind: 'file', id: f.id, title: f.name, subtitle: String(f.parent_type ?? 'file').replace(/_/g, ' '), to: projectLink(f.project_id) });
  for (const e of people) hits.push({ kind: 'employee', id: e.id, title: e.name, subtitle: [e.emp_id, e.status === 'inactive' ? 'inactive' : null].filter(Boolean).join(' · '), to: `admin-employees?employee=${e.id}` });
  return hits;
}
