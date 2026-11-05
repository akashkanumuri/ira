import { supabase } from './supabase';
import type { WorkState } from './work';

const db = supabase as any;

/** Research done before work starts on a task (one per task). */
export interface TaskResearch {
  id: string;
  task_id: string;
  employee_id: string;
  started_at: string;
  spent_seconds: number;
  submitted_at: string | null;
  links: string[];
  findings: string | null;
  plan: string | null;
  status: 'researching' | 'submitted' | 'approved' | 'commented';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface ResearchInboxItem {
  research_id: string; task_id: string; task_title: string; employee_name: string;
  submitted_at: string; spent_seconds: number; research_minutes: number | null;
}

export const RESEARCH_STATUS: Record<TaskResearch['status'], { label: string; tone: 'ink' | 'amber' | 'mint' | 'brand' }> = {
  researching: { label: 'Researching', tone: 'brand' },
  submitted: { label: 'Waiting for review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'mint' },
  commented: { label: 'Commented', tone: 'brand' },
};

export const RESEARCH_DEFAULT_MINUTES = 30;

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const researchApi = {
  async forTask(taskId: string): Promise<TaskResearch | null> {
    const { data, error } = await db.from('task_research').select('*').eq('task_id', taskId).maybeSingle();
    if (error) return null;
    return (data ?? null) as TaskResearch | null;
  },
  submit: (taskId: string, links: string[], findings: string, plan: string) =>
    call<WorkState>('task_research_submit', { p_task_id: taskId, p_links: links, p_findings: findings, p_plan: plan }),
  review: (taskId: string, decision: 'approve' | 'comment', note?: string | null) =>
    call<string>('task_research_review', { p_task_id: taskId, p_decision: decision, p_note: note ?? null }),
  setMinutes: (taskId: string, minutes: number) => call<void>('task_set_research', { p_task_id: taskId, p_minutes: minutes }),
  async inbox(): Promise<ResearchInboxItem[]> {
    const { data, error } = await db.rpc('task_research_inbox');
    if (error || !Array.isArray(data)) return [];
    return data as ResearchInboxItem[];
  },
};

/** Seconds of research left (negative = over time) for the running research session. */
export function researchLeft(cur: { started_at: string; research_minutes?: number | null; research_spent_seconds?: number | null } | null | undefined, nowMs: number) {
  if (!cur?.research_minutes) return null;
  const running = Math.max(0, (nowMs - Date.parse(cur.started_at)) / 1000);
  return cur.research_minutes * 60 - (cur.research_spent_seconds ?? 0) - running;
}

export const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim()) && s.trim().length <= 500;
