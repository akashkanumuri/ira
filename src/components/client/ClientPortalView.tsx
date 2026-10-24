import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { AuthUser } from '../../contexts/AuthContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  RefreshCw,
  FolderKanban,
  LayoutDashboard,
  FileSignature,
  Package,
  TrendingUp,
  CreditCard,
  Settings,
  Bell,
  AlertTriangle,
  LifeBuoy,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { AppShell, type NavGroup as ShellNavGroup } from '../../ui/AppShell';
import { SkeletonPage } from '../../ui';
import { ClientSupport } from './ClientSupport';
import { ClientTeam } from './ClientTeam';
import {
  cx,
  Button,
  Card,
  CardHead,
  PageHeader,
  Avatar,
  Person,
  Empty,
  Field,
  Input,
  Select,
  Tabs,
  ToastProvider,
  useToast,
} from './ClientUI';
import {
  ClientContracts,
  ClientDashboard,
  ClientDeliverables,
  ClientPayments,
  ClientProgress,
  type ClientPage,
  type WorkspaceProject,
} from './ClientWorkspaceViews';
import { AWAITING_CLIENT_CONTRACT, errorMessage, loadProjectWorkspace, type ProjectWorkspace } from '../../lib/sigma';

export type ClientNavPage = ClientPage;

export interface ClientNotificationItem {
  id: string;
  title: string;
  body: string;
  when: string;
  unread: boolean;
  page: ClientNavPage | null;
}

const ACTION_PAGES: Record<string, ClientNavPage> = {
  '/client/contracts': 'contracts',
  '/client/deliverables': 'deliverables',
  '/client/progress': 'progress',
  '/client/payments': 'payments',
  '/client/support': 'support',
  contracts: 'contracts',
  deliverables: 'deliverables',
  progress: 'progress',
  payments: 'payments',
  support: 'support',
};

interface Props {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

export const ClientPortalView: React.FC<Props> = ({ user, onLogout }) => {
  return (
    <ToastProvider>
      <ClientPortalInternal user={user} onLogout={onLogout} />
    </ToastProvider>
  );
};

const fmtWhen = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));

const ClientPortalInternal: React.FC<Props> = ({ user, onLogout }) => {
  const toast = useToast();
  const { changePassword } = useAuth();

  const [page, setPage] = useState<ClientNavPage>('dashboard');

  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<ClientNotificationItem[]>([]);
  const [ws, setWs] = useState<ProjectWorkspace | null>(null);

  /* ---------- Projects (RLS limits rows to this client organisation) ---------- */
  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setLoadError(null);
    try {
      const db = supabase as any;
      const { data: projData, error: projErr } = await db
        .from('projects')
        .select('id, name, description, status, start_date, target_date, created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (projErr) throw projErr;
      // Clients deal with “IRA team” only — individual staff names are never loaded here.
      const mapped: WorkspaceProject[] = (projData ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status === 'active' ? 'Active' : p.status === 'paused' ? 'On Hold' : p.status === 'completed' ? 'Completed' : p.status,
        managerName: 'IRA team',
        startDate: p.start_date ?? p.created_at?.slice(0, 10) ?? null,
        targetDate: p.target_date ?? null,
      }));
      setProjects(mapped);
      setSelectedProjectId(prev => (prev && mapped.some(p => p.id === prev) ? prev : mapped[0]?.id ?? null));
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  /* ---------- Notifications ---------- */
  const loadNotifications = useCallback(async () => {
    if (!user.id) return;
    const { data, error } = await (supabase as any)
      .from('notifications')
      .select('id, title, message, action_url, read_at, created_at')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return;
    setNotifications(
      (data ?? []).map((n: any) => ({
        id: n.id,
        title: n.title,
        body: n.message,
        when: fmtWhen(n.created_at),
        unread: !n.read_at,
        page: n.action_url ? ACTION_PAGES[n.action_url] ?? null : null,
      })),
    );
  }, [user.id]);

  useEffect(() => {
    void loadProjects();
    void loadNotifications();
  }, [loadProjects, loadNotifications]);

  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId) || projects[0] || null,
    [projects, selectedProjectId],
  );

  /* ---------- Project workspace ---------- */
  const loadWorkspace = useCallback(async (projectId: string) => {
    try {
      setWs(await loadProjectWorkspace(projectId));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    setWs(null);
    if (selectedProject?.id) void loadWorkspace(selectedProject.id);
  }, [selectedProject?.id, loadWorkspace]);

  const reload = useCallback(async () => {
    if (selectedProject?.id) await loadWorkspace(selectedProject.id);
    void loadNotifications();
  }, [selectedProject?.id, loadWorkspace, loadNotifications]);

  const markNotificationRead = async (id: string) => {
    const { error } = await (supabase as any)
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast(errorMessage(error), 'err');
      return;
    }
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, unread: false } : n)));
  };

  const markAllNotificationsRead = async () => {
    const { error } = await (supabase as any)
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', user.id)
      .is('read_at', null);
    if (error) {
      toast(errorMessage(error), 'err');
      return;
    }
    setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
    toast('All notifications marked as read', 'info');
  };

  const unreadNotifCount = notifications.filter(n => n.unread).length;
  const contractPending = Boolean(ws?.contracts[0] && AWAITING_CLIENT_CONTRACT.includes(ws.contracts[0].status));
  const paymentDueCount =
    ws?.installments.filter(i => ['Due', 'Overdue', 'Partially Paid'].includes(i.status)).length || 0;
  const pendingDependencyCount =
    ws?.dependencies.filter(d => ['Requested', 'Pending', 'Rejected', 'Resubmission Required'].includes(d.status)).length || 0;
  const reviewCount = ws?.deliverables.filter(d => d.status === 'Awaiting Client Review').length || 0;

  /* =========================================================================
     Navigation
  ========================================================================= */

  const navGroups: ShellNavGroup[] = [
    { items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
    {
      label: 'My project',
      items: [
        { id: 'contracts', label: 'Sign Contract', icon: FileSignature, badge: contractPending ? 1 : undefined },
        { id: 'deliverables', label: 'Deliverables', icon: Package, badge: reviewCount || undefined },
        { id: 'progress', label: 'Progress Tracker', icon: TrendingUp, badge: pendingDependencyCount || undefined },
        { id: 'payments', label: 'Billing & Payment', icon: CreditCard, badge: paymentDueCount || undefined },
      ],
    },
    {
      label: 'Account',
      items: [
        { id: 'support', label: 'Help & support', icon: LifeBuoy },
        { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadNotifCount || undefined },
        { id: 'settings', label: 'Profile & Organisation', icon: Settings },
      ],
    },
  ];

  /* =========================================================================
     View Renderer
  ========================================================================= */

  const renderActivePage = () => {
    if (page === 'notifications') {
      return (
        <ClientNotificationsView
          items={notifications}
          onMarkRead={markNotificationRead}
          onMarkAllRead={markAllNotificationsRead}
          onNavigate={setPage}
        />
      );
    }
    if (page === 'support') return <ClientSupport projects={projects.map(p => ({ id: p.id, name: p.name }))} />;
    if (page === 'settings') return <ClientSettingsView user={user} changePassword={changePassword} />;

    if (loadingProjects) {
      return <SkeletonPage />;
    }

    if (loadError) {
      return (
        <Card pad={false}>
          <Empty
            icon={AlertTriangle}
            title="We couldn’t load your workspace"
            desc={loadError}
            action={<Button icon={RefreshCw} onClick={() => { void loadProjects(); if (selectedProject) void loadWorkspace(selectedProject.id); }}>Try again</Button>}
          />
        </Card>
      );
    }

    if (!selectedProject) {
      return (
        <Card pad={false}>
          <Empty
            icon={FolderKanban}
            title="No active projects"
            desc="Your account is active. Projects appear here once IRA assigns them to your organisation."
            action={<Button icon={RefreshCw} onClick={() => void loadProjects()}>Refresh</Button>}
          />
        </Card>
      );
    }

    if (!ws) {
      return <SkeletonPage />;
    }

    const props = { user, project: selectedProject, ws, reload, go: setPage };
    switch (page) {
      case 'dashboard':
        return <ClientDashboard {...props} />;
      case 'contracts':
        return <ClientContracts {...props} />;
      case 'deliverables':
        return <ClientDeliverables {...props} />;
      case 'progress':
        return <ClientProgress {...props} />;
      case 'payments':
        return <ClientPayments {...props} />;
      default:
        return null;
    }
  };

  return (
    <AppShell
      brand="ira"
      groups={navGroups}
      active={page}
      onNavigate={id => setPage(id as ClientNavPage)}
      mobilePrimary={['dashboard', 'deliverables', 'progress', 'payments']}
      user={{
        name: user.primaryContact || user.name,
        subtitle: user.companyName || 'Client',
        avatar: user.avatar || null,
      }}
      onSignOut={() => void onLogout()}
      topRight={
        <>
          {projects.length > 1 && (
            <select
              value={selectedProjectId || ''}
              onChange={e => setSelectedProjectId(e.target.value)}
              aria-label="Project"
              className="input !w-auto !min-h-[40px] !rounded-full !py-1.5 !pl-4 !pr-8 !text-[13px] font-semibold max-w-[220px]"
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setPage('notifications')}
            aria-label={unreadNotifCount ? `${unreadNotifCount} unread notifications` : 'Notifications'}
            className="icon-btn icon-btn-surface relative"
          >
            <Bell className="w-[18px] h-[18px]" />
            {unreadNotifCount > 0 && (
              <span className="absolute -right-1 -top-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-[var(--app-bg)] tnum">
                {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
              </span>
            )}
          </button>
        </>
      }
    >
      <div key={page} className="ira-section-transition mx-auto w-full max-w-[1320px]">
        {renderActivePage()}
      </div>
    </AppShell>
  );
};

/* =========================================================================
   SUB-VIEW 6: Notifications View
========================================================================= */

function ClientNotificationsView({
  items,
  onMarkRead,
  onMarkAllRead,
  onNavigate,
}: {
  items: ClientNotificationItem[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onNavigate: (p: ClientNavPage) => void;
}) {
  const [tab, setTab] = useState('all');
  const filtered = tab === 'all' ? items : items.filter(n => n.unread);

  return (
    <>
      <PageHeader
        title="Notifications"
        desc="Contract, delivery, dependency and billing updates for your organisation."
        actions={
          <Button onClick={onMarkAllRead} disabled={!items.some(n => n.unread)}>
            Mark all read
          </Button>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'all', label: 'All', count: items.length },
          { id: 'unread', label: 'Unread', count: items.filter(n => n.unread).length },
        ]}
      />

      {filtered.length === 0 ? (
        <Card pad={false}>
          <Empty
            icon={Bell}
            title="You’re all caught up"
            desc="No notifications to show in this view."
          />
        </Card>
      ) : (
        <Card pad={false} className="divide-y divide-line overflow-hidden">
          {filtered.map(n => (
            <div
              key={n.id}
              className={cx(
                'flex gap-3 p-4 sm:px-5 transition-colors',
                n.unread ? 'bg-[#fafbfe]' : 'hover:bg-bg'
              )}
            >
              <span
                className={cx(
                  'w-2 h-2 rounded-full mt-2 shrink-0',
                  n.unread ? 'bg-info' : 'bg-transparent border border-line'
                )}
                aria-label={n.unread ? 'Unread' : 'Read'}
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cx(
                      'text-[13px]',
                      n.unread ? 'font-semibold text-ink' : 'font-medium text-ink-2'
                    )}
                  >
                    {n.title}
                  </span>
                </div>
                <p className="text-[13px] text-ink-2 mt-0.5 leading-relaxed">{n.body}</p>
                <div className="text-xs text-ink-3 mt-1">{n.when}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-start">
                {n.unread && (
                  <button
                    className="text-xs text-info hover:underline font-medium"
                    onClick={() => onMarkRead(n.id)}
                  >
                    Mark read
                  </button>
                )}
                {n.page && (
                  <button
                    className="text-xs text-ink-2 hover:text-ink font-medium underline"
                    onClick={() => {
                      if (n.unread) onMarkRead(n.id);
                      onNavigate(n.page!);
                    }}
                  >
                    Open
                  </button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

/* =========================================================================
   SUB-VIEW 7: Settings View
========================================================================= */

function ClientSettingsView({
  user,
  changePassword,
}: {
  user: AuthUser;
  changePassword: (newPass: string) => Promise<{ error: string | null }>;
}) {
  const toast = useToast();

  // Password fields
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPass, setChangingPass] = useState(false);

  const handleUpdatePassword = async () => {
    if (newPassword.length < 12) {
      toast('Password must be at least 12 characters long', 'warn');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('Passwords do not match', 'warn');
      return;
    }

    setChangingPass(true);
    try {
      const res = await changePassword(newPassword);
      if (res.error) {
        toast(res.error, 'err');
      } else {
        toast('Password updated successfully');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (e) {
      toast('Failed to update password', 'err');
    } finally {
      setChangingPass(false);
    }
  };

  return (
    <>
      <PageHeader title="Profile & Organisation" />


      {(
        <div className="grid lg:grid-cols-2 gap-5">
          {/* Profile Card */}
          <Card>
            <CardHead title="Profile" />
            <div className="space-y-4">
              <Person
                name={user.primaryContact || user.name}
                sub={user.companyName || 'IRA Client'}
              />
              <Field label="Primary Contact">
                <Input defaultValue={user.primaryContact || user.name} disabled />
              </Field>
              <Field label="Company Name">
                <Input defaultValue={user.companyName || '—'} disabled />
              </Field>
              <Field label="Login ID / Email" hint="Contact the IRA team to change your email address.">
                <Input defaultValue={user.email} disabled />
              </Field>
              <Field label="Portal role">
                <Input defaultValue={user.clientRole === 'client_user' ? 'Client user (view and upload)' : 'Client admin (full access)'} disabled />
              </Field>
            </div>
          </Card>

          {/* Password Update Card */}
          <Card>
            <CardHead
              title="Password"
              desc="Set a secure password for your client portal account. Minimum 12 characters."
            />
            <div className="space-y-4">
              <Field label="New password">
                <Input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                />
              </Field>
              <Field label="Confirm new password">
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                />
              </Field>
              <Button
                variant="primary"
                loading={changingPass}
                disabled={!newPassword || !confirmPassword}
                onClick={handleUpdatePassword}
              >
                Update password
              </Button>
            </div>
          </Card>
        </div>
      )}

      {user.clientId && (
        <Card className="mt-5">
          <CardHead title={`People at ${user.companyName || 'your organisation'}`} desc="Everyone here can sign in to this portal and see your projects." />
          <ClientTeam clientId={user.clientId} mode="client" canManage={user.clientRole === 'client_admin'} currentUserId={user.id} />
        </Card>
      )}
    </>
  );
}
