import React, { useEffect, useMemo, useState } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Badge, EmptyState, Notice, PillTabs, Skeleton, cx } from '../../ui';

interface Role { code: string; name: string; scope: 'staff' | 'client'; description: string | null }
interface Permission { code: string; module: string; description: string }

const MODULE_LABEL: Record<string, string> = { admin: 'Clients & delivery', finance: 'Finance', hr: 'People', employee: 'Employee self-service', client: 'Client portal' };
const ROLE_ORDER = ['super_admin', 'admin', 'finance_admin', 'hr_admin', 'project_manager', 'employee', 'client_admin', 'client_user'];

/**
 * Read-only view of the permission model the database enforces (roles,
 * permissions and role_permissions). Editing is intentionally not offered
 * here yet: staff screens are still chosen by account type, so granting a
 * staff role would change database access without a matching screen.
 */
export function RolesMatrix() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<'staff' | 'client'>('staff');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    (async () => {
      const db = supabase as any;
      const [r, p, rp] = await Promise.all([
        db.from('roles').select('code, name, scope, description'),
        db.from('permissions').select('code, module, description'),
        db.from('role_permissions').select('role_code, permission_code'),
      ]);
      if (!live) return;
      if (r.error || p.error || rp.error) { setState('error'); return; }
      setRoles(r.data ?? []);
      setPerms(p.data ?? []);
      setGrants(new Set((rp.data ?? []).map((g: any) => `${g.role_code}|${g.permission_code}`)));
      setState('ready');
    })();
    return () => { live = false; };
  }, []);

  const shownRoles = useMemo(() => roles.filter((r) => r.scope === scope).sort((a, b) => ROLE_ORDER.indexOf(a.code) - ROLE_ORDER.indexOf(b.code)), [roles, scope]);
  const modules = useMemo(() => {
    const wanted = scope === 'client' ? ['client'] : ['admin', 'finance', 'hr', 'employee'];
    return wanted.map((m) => ({ id: m, perms: perms.filter((p) => p.module === m).sort((a, b) => a.description.localeCompare(b.description)) })).filter((m) => m.perms.length);
  }, [perms, scope]);

  if (state === 'loading') return <div className="card p-5 space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div>;
  if (state === 'error') return <Notice tone="rose" title="Couldn’t load roles">Refresh the page to try again.</Notice>;

  return (
    <div className="space-y-4">
      <Notice tone="brand" title="How access works today">
        Admins have full access. Employees and managers see the employee portal, and project managers act only on projects they manage. Client users get the client permissions below.
        Assigning extra staff roles (Finance, HR, Project manager) will be switched on together with the matching screens.
      </Notice>
      <PillTabs value={scope} onChange={setScope} items={[{ id: 'staff', label: 'Staff roles' }, { id: 'client', label: 'Client roles' }]} />
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table min-w-[720px]">
            <thead>
              <tr>
                <th className="w-[40%]">Permission</th>
                {shownRoles.map((r) => <th key={r.code} className="!text-center" title={r.description ?? ''}>{r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <React.Fragment key={m.id}>
                  <tr><td colSpan={shownRoles.length + 1} className="!bg-ink-50/70 !py-2"><span className="eyebrow">{MODULE_LABEL[m.id] ?? m.id}</span></td></tr>
                  {m.perms.map((p) => (
                    <tr key={p.code}>
                      <td><span className="text-ink-800 font-semibold">{p.description}</span></td>
                      {shownRoles.map((r) => {
                        const on = r.code === 'super_admin' || grants.has(`${r.code}|${p.code}`);
                        return (
                          <td key={r.code} className="!text-center">
                            <span className={cx('inline-grid place-items-center w-6 h-6 rounded-full', on ? 'bg-mint-50 text-mint-600' : 'text-ink-200')} aria-label={on ? 'Allowed' : 'Not allowed'}>
                              {on ? <Check className="w-3.5 h-3.5" /> : '–'}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {!shownRoles.length && <EmptyState icon={<ShieldCheck className="w-6 h-6" />} title="No roles defined" />}
      </div>
      <p className="text-[12px] text-ink-400 flex items-center gap-2"><Badge tone="ink">Read-only</Badge> Changes to this matrix are made by a database migration so they’re reviewed and audited.</p>
    </div>
  );
}
