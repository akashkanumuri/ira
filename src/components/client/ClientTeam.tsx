import React, { useCallback, useEffect, useState } from 'react';
import { Link2, RefreshCw, UserPlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invokeClientAdmin } from '../../lib/v2';
import { isMissingSchema } from '../../lib/tasks';
import { notify } from '../../lib/toast';
import { Avatar, Badge, Button, cx } from '../../ui';
import { Modal } from '../../ui/Modal';
import { SetupLinkDialog, type SetupLink } from '../common/SetupLinkDialog';
import { closePasswordRequests } from '../../lib/passwordRequests';

interface Member { id: string; profile_id: string; role: 'client_admin' | 'client_user'; status: 'invited' | 'active' | 'inactive'; full_name: string | null; email: string; created_at: string }

const ROLE: Record<Member['role'], { label: string; hint: string }> = {
  client_admin: { label: 'Admin', hint: 'Signs contracts, approves work, pays and manages people' },
  client_user: { label: 'Member', hint: 'Views progress, downloads files, uploads what the team needs' },
};

const db = supabase as any;

/**
 * People with portal access for one client organisation.
 * `mode="client"`: the signed-in client admin manages their own colleagues.
 * `mode="admin"`: an IRA administrator manages any client's users (gets the setup link back).
 */
export function ClientTeam({ clientId, primaryProfileId, mode, canManage, currentUserId }: {
  clientId: string; primaryProfileId?: string | null; mode: 'client' | 'admin'; canManage: boolean; currentUserId?: string | null;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<SetupLink | null>(null);
  const [primary, setPrimary] = useState<string | null>(primaryProfileId ?? null);

  const load = useCallback(async () => {
    const [u, c] = await Promise.all([
      db.from('client_users').select('id, profile_id, role, status, full_name, email, created_at').eq('client_id', clientId).order('created_at'),
      primaryProfileId === undefined ? db.from('clients').select('profile_id').eq('id', clientId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (u.error) notify(u.error.message, 'error'); else setMembers(u.data ?? []);
    if (c.data?.profile_id) setPrimary(c.data.profile_id);
    setLoading(false);
  }, [clientId, primaryProfileId]);
  useEffect(() => { void load(); }, [load]);

  async function update(m: Member, patch: { status?: 'active' | 'inactive'; role?: Member['role'] }) {
    setBusy(m.id);
    try {
      const { error } = await db.rpc('client_user_update', { p_client_user_id: m.id, p_status: patch.status ?? null, p_role: patch.role ?? null });
      if (error) throw new Error(isMissingSchema(error) ? 'Managing access switches on once the client team database update is applied.' : error.message);
      notify('Access updated.', 'success');
      await load();
    } catch (e) { notify(e instanceof Error ? e.message : 'Unable to update.', 'error'); }
    finally { setBusy(null); }
  }

  /** Creates a fresh one-time link (setup for invited people, reset for active ones) and shows it. No email is sent. */
  async function getLink(m: Member, isPrimary: boolean) {
    setBusy(m.id);
    try {
      // The primary contact's login belongs to the client account itself.
      const res = isPrimary && mode === 'admin'
        ? await invokeClientAdmin({ action: 'resend_invitation', clientId: m.profile_id })
        : await invokeClientAdmin({ action: 'resend_client_user_invitation', clientUserId: m.id });
      if (!res?.invitationUrl) throw new Error('No link came back. Try again.');
      setLink({ name: m.full_name, email: m.email, url: res.invitationUrl, kind: res?.kind === 'reset' ? 'reset' : 'invite' });
      if (mode === 'admin') void closePasswordRequests(m.email);
    } catch (e) { notify(e instanceof Error ? e.message : 'Unable to create the link.', 'error'); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-[13px] text-ink-500">{members.filter((m) => m.status !== 'inactive').length} with access</p>
        <div className="flex gap-2">
          <button type="button" className="icon-btn" onClick={() => void load()} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
          {canManage && <Button size="sm" icon={<UserPlus className="w-3.5 h-3.5" />} onClick={() => setInviting(true)}>Add person</Button>}
        </div>
      </div>
      {loading ? <div className="skeleton h-14 rounded-2xl" /> : (
        <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-100">
          {members.map((m) => {
            const isPrimary = m.profile_id === primary;
            const self = m.profile_id === currentUserId;
            const locked = !canManage || self || (isPrimary && mode !== 'admin');
            return (
              <li key={m.id} className={cx('px-4 py-3 flex flex-wrap items-center gap-3', m.status === 'inactive' && 'opacity-60')}>
                <Avatar name={m.full_name ?? m.email} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink-900 truncate">{m.full_name ?? m.email}{self && <span className="text-ink-400 font-medium"> · you</span>}</p>
                  <p className="text-[12px] text-ink-500 truncate">{m.email}{isPrimary ? ' · primary contact' : ''}</p>
                </div>
                <Badge tone={m.role === 'client_admin' ? 'brand' : 'ink'}>{ROLE[m.role].label}</Badge>
                <Badge tone={m.status === 'active' ? 'mint' : m.status === 'invited' ? 'amber' : 'rose'} dot>{m.status === 'invited' ? 'Invited' : m.status === 'active' ? 'Active' : 'No access'}</Badge>
                {!locked && (
                  <div className="flex gap-1.5 w-full sm:w-auto justify-end">
                    {m.status === 'invited' && <button type="button" className="btn-ghost btn-sm" disabled={busy === m.id} onClick={() => void getLink(m, isPrimary)}><Link2 className="w-3.5 h-3.5" /> Get setup link</button>}
                    {m.status === 'active' && mode === 'admin' && <button type="button" className="btn-ghost btn-sm" disabled={busy === m.id} onClick={() => void getLink(m, isPrimary)}><Link2 className="w-3.5 h-3.5" /> Get reset link</button>}
                    {m.status === 'active' && <button type="button" className="btn-ghost btn-sm" disabled={busy === m.id} onClick={() => void update(m, { role: m.role === 'client_admin' ? 'client_user' : 'client_admin' })}>{m.role === 'client_admin' ? 'Make member' : 'Make admin'}</button>}
                    {m.status !== 'inactive'
                      ? <button type="button" className="btn-ghost btn-sm text-rose-600" disabled={busy === m.id} onClick={() => void update(m, { status: 'inactive' })}>Remove access</button>
                      : <button type="button" className="btn-ghost btn-sm" disabled={busy === m.id} onClick={() => void update(m, { status: 'active' })}>Restore access</button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!canManage && mode === 'client' && <p className="text-[12px] text-ink-400 mt-2">Only your organisation’s admins can add or remove people.</p>}
      {inviting && <InviteDialog clientId={clientId} mode={mode} onClose={() => setInviting(false)} onDone={async (res) => { setInviting(false); if (res) setLink({ ...res, kind: 'invite' }); await load(); }} />}
      {link && <SetupLinkDialog link={link} onClose={() => setLink(null)} />}
    </div>
  );
}

function InviteDialog({ clientId, mode, onClose, onDone }: { clientId: string; mode: 'client' | 'admin'; onClose: () => void; onDone: (link: { name: string; email: string; url: string } | null) => Promise<void> }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Member['role']>('client_user');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (name.trim().length < 2) { notify('Enter their name.', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { notify('Enter a valid email.', 'error'); return; }
    setBusy(true);
    try {
      const res = await invokeClientAdmin({ action: 'invite_client_user', fullName: name.trim(), email: email.trim(), role, clientId: mode === 'admin' ? clientId : undefined });
      notify(`${name.trim()} added. Share the setup link with them.`, 'success');
      await onDone(res?.invitationUrl ? { name: name.trim(), email: email.trim(), url: res.invitationUrl } : null);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Unable to add this person.', 'error');
    } finally { setBusy(false); }
  }
  return (
    <Modal title="Give a colleague access" onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <label className="block"><span className="label">Full name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
        <label className="block"><span className="label">Work email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></label>
        <div className="grid sm:grid-cols-2 gap-2">
          {(Object.keys(ROLE) as Member['role'][]).map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)} className={cx('text-left rounded-2xl border px-3.5 py-3', role === r ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-ink-200 hover:border-ink-300')}>
              <span className="block text-[13px] font-bold text-ink-900">{ROLE[r].label}</span><span className="block text-[11px] text-ink-500 mt-0.5">{ROLE[r].hint}</span>
            </button>
          ))}
        </div>
        <p className="text-[12px] text-ink-400">No email is sent. You’ll get a one-time setup link to share with them (it expires in 72 hours).</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => void send()}>Add and get link</Button></div>
      </div>
    </Modal>
  );
}
