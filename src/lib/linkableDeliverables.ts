import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface LinkableDeliverable {
  id: string;
  number: string | null;
  name: string;
  status: string;
  projectId: string;
  projectName: string;
}

const CLOSED = ['Completed', 'Ready for Download', 'Cancelled'];

/**
 * Client deliverables the signed-in user can see (RLS decides: admins see all,
 * project managers their projects, employees those assigned to them).
 * Linking is still authorised server-side by staff_link_task_to_deliverable.
 */
export function useLinkableDeliverables(enabled = true) {
  const [items, setItems] = useState<LinkableDeliverable[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      const { data, error } = await (supabase as any)
        .from('deliverables')
        .select('id, deliverable_number, name, status, project_id, projects:project_id (name)')
        .is('deleted_at', null)
        .order('deliverable_number', { ascending: true });
      if (!alive) return;
      if (!error) {
        setItems(
          (data ?? []).map((d: any) => ({
            id: d.id,
            number: d.deliverable_number ?? null,
            name: d.name,
            status: d.status,
            projectId: d.project_id,
            projectName: d.projects?.name ?? 'Project',
          }))
        );
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);

  return { all: items, open: items.filter((d) => !CLOSED.includes(d.status)), loaded };
}
