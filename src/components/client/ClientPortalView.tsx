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
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  LogOut,
  UserCog,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
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
  contracts: 'contracts',
  deliverables: 'deliverables',
  progress: 'progress',
  payments: 'payments',
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
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

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
      const ids = (projData ?? []).map((p: any) => p.id);
      const mgrMap: Record<string, string> = {};
      if (ids.length) {
        const { data: mgrData } = await db
          .from('project_managers')
          .select('project_id, employees:manager_id (name)')
          .in('project_id', ids);
        for (const m of mgrData ?? []) if (m.employees?.name) mgrMap[m.project_id] = m.employees.name;
      }
      const mapped: WorkspaceProject[] = (projData ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status === 'active' ? 'Active' : p.status === 'paused' ? 'On Hold' : p.status === 'completed' ? 'Completed' : p.status,
        managerName: mgrMap[p.id] || 'Project team',
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
     Navigation Definition
  ========================================================================= */

  type NavItem = {
    id: ClientNavPage;
    label: string;
    icon: typeof LayoutDashboard;
    badge?: number;
  };
  type NavGroup = {
    label?: string;
    items: NavItem[];
  };

  const navGroups: NavGroup[] = [
    {
      items: [{ id: 'dashboard' as ClientNavPage, label: 'Dashboard', icon: LayoutDashboard }],
    },
    {
      label: 'My Project',
      items: [
        { id: 'contracts' as ClientNavPage, label: 'Sign Contract', icon: FileSignature, badge: contractPending ? 1 : undefined },
        { id: 'deliverables' as ClientNavPage, label: 'Deliverables', icon: Package, badge: reviewCount || undefined },
        { id: 'progress' as ClientNavPage, label: 'Progress Tracker', icon: TrendingUp, badge: pendingDependencyCount || undefined },
        { id: 'payments' as ClientNavPage, label: 'Billing & Payment', icon: CreditCard, badge: paymentDueCount || undefined },
      ],
    },
    {
      label: 'Account',
      items: [{ id: 'notifications' as ClientNavPage, label: 'Notifications', icon: Bell, badge: unreadNotifCount || undefined }],
    },
  ];

  const pageTitleMap: Record<ClientNavPage, { title: string; section?: string }> = {
    dashboard: { title: 'Dashboard' },
    contracts: { title: 'Sign Contract', section: 'My Project' },
    deliverables: { title: 'Deliverables', section: 'My Project' },
    progress: { title: 'Progress Tracker', section: 'My Project' },
    payments: { title: 'Billing & Payment', section: 'My Project' },
    settings: { title: 'Profile & Organisation' },
    notifications: { title: 'Notifications' },
  };

  /* =========================================================================
     Render Sidebar
  ========================================================================= */

  const renderSidebar = (mobile?: boolean) => {
    const isCol = collapsed && !mobile;
    return (
      <div className="h-full flex flex-col bg-surface border-r border-line select-none">
        {/* Brand Header */}
        <div
          className={cx(
            'h-14 flex items-center border-b border-line shrink-0',
            isCol ? 'justify-center' : 'px-4 justify-between'
          )}
        >
          <button
            onClick={() => {
              setPage('dashboard');
              if (mobile) setDrawerOpen(false);
            }}
            className="flex items-center gap-2.5 outline-none"
            aria-label="IRA Client Portal"
          >
            <span className="w-7 h-7 rounded-md bg-primary text-white grid place-items-center text-[13px] font-bold tracking-tight shadow-xs">
              I
            </span>
            {!isCol && (
              <span className="leading-tight text-left">
                <span className="block text-[15px] font-semibold tracking-[0.06em] text-ink">IRA</span>
                <span className="block text-[10px] text-ink-3 uppercase font-medium tracking-wider">
                  Client Portal
                </span>
              </span>
            )}
          </button>
          {mobile && (
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="h-9 w-9 grid place-items-center text-ink-2 hover:bg-bg rounded-md"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Company & Role Indicator */}
        {!isCol && (
          <div className="px-4 pt-3 pb-1">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-primary truncate">
              {user.companyName || 'Authorized Client'}
            </span>
            <span className="block text-[11px] text-ink-3 truncate">
              {user.primaryContact || user.name}
            </span>
          </div>
        )}

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
          {navGroups.map((g, gi) => (
            <div key={g.label || gi}>
              {g.label && !isCol && (
                <div className="px-2.5 mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  {g.label}
                </div>
              )}
              {g.label && isCol && gi > 0 && <div className="h-px bg-line mx-2 mb-2" />}
              <div className="space-y-0.5">
                {g.items.map(it => {
                  const active = it.id === page;
                  return (
                    <button
                      key={it.id}
                      onClick={() => {
                        setPage(it.id);
                        if (mobile) setDrawerOpen(false);
                      }}
                      title={isCol ? it.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cx(
                        'relative w-full flex items-center gap-2.5 rounded-md text-[13px] transition-colors',
                        mobile ? 'h-11' : 'h-9',
                        isCol ? 'justify-center' : 'px-2.5',
                        active
                          ? 'bg-primary-soft text-primary font-semibold'
                          : 'text-ink-2 hover:bg-[#f1f3f7] hover:text-ink font-medium'
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-primary" />
                      )}
                      <it.icon size={16} strokeWidth={active ? 2.2 : 1.8} />
                      {!isCol && <span className="flex-1 text-left truncate">{it.label}</span>}
                      {!isCol && it.badge ? (
                        <span className="text-[11px] tnum px-1.5 py-0.5 rounded bg-primary text-white font-bold leading-none">
                          {it.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer Actions */}
        <div className="p-2 border-t border-line space-y-0.5 shrink-0">
          <button
            onClick={() => {
              setPage('settings');
              if (mobile) setDrawerOpen(false);
            }}
            className={cx(
              'w-full flex items-center gap-2.5 rounded-md text-[13px] font-medium h-9 transition-colors',
              isCol ? 'justify-center' : 'px-2.5',
              page === 'settings'
                ? 'bg-primary-soft text-primary font-semibold'
                : 'text-ink-2 hover:bg-[#f1f3f7] hover:text-ink'
            )}
            title={isCol ? 'Profile & Organisation' : undefined}
          >
            <Settings size={16} />
            {!isCol && 'Profile & Organisation'}
          </button>

          {!mobile && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cx(
                'w-full flex items-center gap-2.5 rounded-md text-[13px] font-medium h-9 text-ink-3 hover:bg-[#f1f3f7] hover:text-ink transition-colors',
                isCol ? 'justify-center' : 'px-2.5'
              )}
            >
              {isCol ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              {!isCol && 'Collapse'}
            </button>
          )}
        </div>
      </div>
    );
  };

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
    if (page === 'settings') return <ClientSettingsView user={user} changePassword={changePassword} />;

    if (loadingProjects) {
      return (
        <div className="py-24 text-center text-ink-3 text-xs flex flex-col items-center gap-3" role="status">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>Loading client workspace…</span>
        </div>
      );
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
      return (
        <div className="py-24 text-center text-ink-3 text-xs flex flex-col items-center gap-3" role="status">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>Loading {selectedProject.name}…</span>
        </div>
      );
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

  const { title, section } = pageTitleMap[page] || { title: 'Dashboard' };

  return (
    <div className="flex min-h-screen bg-bg text-ink">
      {/* Desktop Fixed Sidebar */}
      <div
        className={cx(
          'hidden lg:block shrink-0 sticky top-0 h-screen transition-[width] duration-200 z-20',
          collapsed ? 'w-[60px]' : 'w-[244px]'
        )}
      >
        {renderSidebar(false)}
      </div>

      {/* Mobile Drawer */}
      {drawerOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-[#172033]/40 anim-fade"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="w-[280px] h-full anim-slide"
            onClick={e => e.stopPropagation()}
          >
            {renderSidebar(true)}
          </div>
        </div>
      )}

      {/* Main Content Pane */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-30 h-14 bg-surface/95 backdrop-blur border-b border-line flex items-center gap-3 px-4 lg:px-8">
          <button
            className="lg:hidden h-10 w-10 -ml-2 grid place-items-center text-ink-2 hover:bg-bg rounded-md"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={19} />
          </button>

          {/* Breadcrumb Title */}
          <div className="min-w-0 flex items-center gap-1.5 text-[13px]">
            {section && <span className="text-ink-3 hidden sm:inline">{section} /</span>}
            <span className="font-semibold truncate">{title}</span>
          </div>

          <div className="flex-1" />

          {/* Project Switcher if multiple projects */}
          {projects.length > 1 && (
            <div className="hidden md:flex items-center gap-2 mr-2">
              <span className="text-xs text-ink-3">Project:</span>
              <Select
                value={selectedProjectId || ''}
                onChange={e => setSelectedProjectId(e.target.value)}
                className="w-48 h-8 text-xs font-semibold"
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Notifications Bell */}
          <button
            onClick={() => setPage('notifications')}
            aria-label="Notifications"
            className="relative h-9 w-9 grid place-items-center rounded-md text-ink-2 hover:bg-[#eef0f4] transition-colors"
          >
            <Bell size={17} />
            {unreadNotifCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-err border-2 border-surface" />
            )}
          </button>

          {/* User Profile Menu */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 h-10 pl-1 pr-1.5 rounded-md hover:bg-[#eef0f4] transition-colors outline-none"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              <Avatar name={user.primaryContact || user.name} size={28} />
              <span className="hidden sm:block text-left leading-tight">
                <span className="block text-[13px] font-medium truncate max-w-[140px]">
                  {user.primaryContact || user.name}
                </span>
                <span className="block text-[11px] text-ink-3 truncate max-w-[140px]">
                  {user.companyName || 'Client'}
                </span>
              </span>
              <ChevronDown size={13} className="text-ink-3 hidden sm:block" />
            </button>

            {userMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setUserMenuOpen(false)}
                />
                <div
                  role="menu"
                  className="absolute right-0 top-11 z-50 w-60 bg-surface border border-line rounded-lg shadow-[0_8px_30px_rgba(23,32,51,0.12)] py-1 anim-fade"
                >
                  <div className="px-3 py-2 border-b border-line">
                    <div className="text-[13px] font-semibold text-ink">
                      {user.companyName || user.name}
                    </div>
                    <div className="text-xs text-ink-3 truncate">{user.email}</div>
                  </div>

                  <button
                    role="menuitem"
                    onClick={() => {
                      setPage('settings');
                      setUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 h-9 text-[13px] text-ink-2 hover:text-ink hover:bg-bg transition-colors"
                  >
                    <UserCog size={14} className="text-ink-2" />
                    Profile & organisation
                  </button>

                  <button
                    role="menuitem"
                    onClick={() => {
                      setPage('notifications');
                      setUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 h-9 text-[13px] text-ink-2 hover:text-ink hover:bg-bg transition-colors"
                  >
                    <Bell size={14} className="text-ink-2" />
                    Notifications
                    {unreadNotifCount > 0 && (
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-white font-bold">
                        {unreadNotifCount}
                      </span>
                    )}
                  </button>

                  <div className="border-t border-line mt-1 pt-1">
                    <button
                      role="menuitem"
                      onClick={() => {
                        setUserMenuOpen(false);
                        void onLogout();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 h-9 text-[13px] text-err hover:bg-err-soft transition-colors font-medium"
                    >
                      <LogOut size={14} className="text-err" />
                      Sign out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Page Container */}
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8 w-full max-w-[1280px] mx-auto">
          {renderActivePage()}
        </main>
      </div>
    </div>
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
              <Field label="Login ID / Email" hint="Contact your account manager to change your email address.">
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

    </>
  );
}
