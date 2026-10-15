import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { AuthUser } from '../../contexts/AuthContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  Building2,
  Briefcase,
  Clock,
  User,
  LogOut,
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
  CheckCircle2,
  ArrowRight,
  GitPullRequest,
  ExternalLink,
  History,
  ShieldCheck,
  Mail,
  AlertTriangle,
  Check,
  UserCog,
  Lock,
  Search,
  Pencil,
  Info,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  cx,
  Button,
  Badge,
  Status,
  Card,
  CardHead,
  PageHeader,
  Stat,
  Avatar,
  Person,
  Progress,
  Alert,
  Empty,
  LinkRef,
  Field,
  Input,
  Select,
  Textarea,
  SearchField,
  Checkbox,
  Switch,
  Tabs,
  DataTable,
  FilterBar,
  Dialog,
  SidePanel,
  ToastProvider,
  useToast,
  Timeline,
  KV,
} from './ClientUI';

/* =========================================================================
   Types
========================================================================= */

export type ClientNavPage =
  | 'dashboard'
  | 'contracts'
  | 'deliverables'
  | 'progress'
  | 'payments'
  | 'settings'
  | 'notifications';

export interface ClientProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  stage: string;
  managerName: string;
  managerEmail: string | null;
  startDate: string;
  targetDate: string;
}

export interface ClientContractData {
  title: string;
  ref: string;
  version: string;
  url: string;
  assigned: string;
  status: 'Pending Review' | 'Accepted' | 'Declined';
  acceptedAt?: string;
  acceptedUrl?: string;
}

export interface ClientAcceptanceRecord {
  id: number;
  version: string;
  url: string;
  who: string;
  at: string;
  event: string;
  note?: string;
}

export interface ClientDeliverable {
  id: string;
  name: string;
  desc: string;
  qty: string;
  due: string;
  deps: string;
  ref: string;
  owner: string;
  status: 'Not Started' | 'In Progress' | 'Completed';
  updated: string;
}

export interface ClientChangeRequest {
  id: string;
  del: string;
  delName: string;
  field: string;
  prev: string;
  next: string;
  by: string;
  at: string;
  status: 'Pending Review' | 'Approved Change' | 'Change Declined';
  reason?: string;
  reviewer?: string;
  comment?: string;
}

export interface ClientInstallment {
  id: number;
  name: string;
  basis: string;
  amount: number;
  due: string;
  status: 'Paid' | 'Due' | 'Overdue' | 'Upcoming' | 'Pending Verification';
  ref?: string;
  paidOn?: string;
}

export interface ClientMilestone {
  id: number;
  name: string;
  date: string;
  state: 'Completed' | 'In Progress' | 'Upcoming';
}

export interface ClientProjectUpdate {
  id: number;
  title: string;
  meta: string;
  tone?: 'ok' | 'warn';
}

export interface ClientNotificationItem {
  id: string | number;
  title: string;
  body: string;
  when: string;
  ref: string;
  unread: boolean;
  email?: 'Sent' | 'Failed' | 'Not Sent';
  actionUrl?: string;
}

/* =========================================================================
   Helpers
========================================================================= */

export const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

const FIELD_KEYS: Record<string, keyof ClientDeliverable> = {
  Timeline: 'due',
  Quantity: 'qty',
  Name: 'name',
  'Description or scope': 'desc',
  Dependencies: 'deps',
  'Links or clarifications': 'ref',
};

function getStorageKey(userId: string, projectId: string) {
  return `ira_client_portal_state_${userId}_${projectId}`;
}

interface StoredProjectState {
  contract: ClientContractData | null;
  acceptance: ClientAcceptanceRecord[];
  deliverables: ClientDeliverable[];
  changes: ClientChangeRequest[];
  installments: ClientInstallment[];
  milestones: ClientMilestone[];
  updates: ClientProjectUpdate[];
}

function createInitialState(): StoredProjectState {
  return {
    contract: null,
    acceptance: [],
    deliverables: [],
    changes: [],
    installments: [],
    milestones: [],
    updates: [],
  };
}

/* =========================================================================
   Main ClientPortalView Component
========================================================================= */

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

const ClientPortalInternal: React.FC<Props> = ({ user, onLogout }) => {
  const toast = useToast();
  const { changePassword } = useAuth();

  const [page, setPage] = useState<ClientNavPage>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const [projects, setProjects] = useState<ClientProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Notifications from Supabase
  const [notifications, setNotifications] = useState<ClientNotificationItem[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(false);

  // Scoped project state (Deliverables, Contract, Changes, Installments, Milestones, Updates)
  const [state, setState] = useState<StoredProjectState | null>(null);

  /* ---------- Load Client Projects from Supabase ---------- */
  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      // 1. Fetch projects authorized for this client user
      const { data: projData, error: projErr } = await (supabase as any)
        .from('projects')
        .select(`
          id,
          name,
          description,
          status,
          created_at,
          updated_at
        `)
        .order('created_at', { ascending: false });

      if (projErr) {
        console.error('[ClientPortal] Failed to load projects:', projErr);
      }

      if (projData && projData.length > 0) {
        // Fetch manager names for these projects
        const projIds = projData.map((p: any) => p.id);
        const { data: mgrData } = await (supabase as any)
          .from('project_managers')
          .select(`
            project_id,
            manager_id,
            employees:manager_id (id, name, work_email)
          `)
          .in('project_id', projIds);

        const mgrMap: Record<string, { name: string; email: string | null }> = {};
        if (mgrData) {
          for (const item of mgrData) {
            if (item.employees) {
              mgrMap[item.project_id] = {
                name: item.employees.name,
                email: item.employees.work_email,
              };
            }
          }
        }

        const mapped: ClientProject[] = projData.map((p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status === 'active' ? 'Active' : p.status || 'Active',
          stage: p.status === 'active' ? 'Active' : p.status || '—',
          managerName: mgrMap[p.id]?.name || 'Unassigned',
          managerEmail: mgrMap[p.id]?.email || null,
          startDate: p.created_at
            ? new Intl.DateTimeFormat('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }).format(new Date(p.created_at))
            : '—',
          targetDate: '—',
        }));

        setProjects(mapped);
        setSelectedProjectId(prev => (prev && mapped.some(p => p.id === prev) ? prev : mapped[0].id));
      } else {
        setProjects([]);
        setSelectedProjectId(null);
      }
    } catch (err) {
      console.error('[ClientPortal] Error loading projects:', err);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  /* ---------- Load Notifications from Supabase ---------- */
  const loadNotifications = useCallback(async () => {
    if (!user.id) return;
    setNotifsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('notifications')
        .select('id, recipient_id, type, title, message, action_url, read_at, created_at')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        const mapped: ClientNotificationItem[] = data.map((n: any) => ({
          id: n.id,
          title: n.title,
          body: n.message,
          when: new Intl.DateTimeFormat('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }).format(new Date(n.created_at)),
          ref: n.action_url || 'Client Portal',
          unread: !n.read_at,
          email: 'Sent',
          actionUrl: n.action_url,
        }));
        setNotifications(mapped);
      } else {
        setNotifications([]);
      }
    } catch (err) {
      console.error('[ClientPortal] Failed to load notifications:', err);
    } finally {
      setNotifsLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void loadProjects();
    void loadNotifications();
  }, [loadProjects, loadNotifications]);

  const selectedProject = useMemo(() => {
    return projects.find(p => p.id === selectedProjectId) || projects[0] || null;
  }, [projects, selectedProjectId]);

  /* ---------- Sync Project State with LocalStorage ---------- */
  useEffect(() => {
    if (!selectedProject || !user.id) return;
    const storageKey = getStorageKey(user.id, selectedProject.id);
    const existing = localStorage.getItem(storageKey);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        // Clean out any legacy dummy/seed data cached in browser storage
        const hasDummyContract =
          parsed.contract?.url?.includes('sample') || parsed.contract?.ref?.includes('2026-001');
        const hasDummyDeliverables = parsed.deliverables?.some(
          (d: any) => d.id === 'D-001' && d.name?.includes('Discovery & Architecture')
        );
        const hasDummyInstallments = parsed.installments?.some(
          (i: any) => i.ref === 'NEFT-882194' || i.name?.includes('Advance on contract')
        );

        if (hasDummyContract || hasDummyDeliverables || hasDummyInstallments) {
          localStorage.removeItem(storageKey);
          setState(createInitialState());
          return;
        }

        setState(parsed);
        return;
      } catch (e) {
        console.error('[ClientPortal] Error parsing stored state:', e);
      }
    }

    // Initialize fresh empty state with zero dummy data
    const initial = createInitialState();
    localStorage.setItem(storageKey, JSON.stringify(initial));
    setState(initial);
  }, [selectedProject?.id, user.id]);

  const updateState = useCallback(
    (updater: (prev: StoredProjectState) => StoredProjectState) => {
      if (!selectedProject || !user.id) return;
      setState(current => {
        if (!current) return current;
        const next = updater(current);
        const storageKey = getStorageKey(user.id, selectedProject.id);
        localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    },
    [selectedProject?.id, user.id]
  );

  const markNotificationRead = async (id: string | number) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, unread: false } : n)));
    if (typeof id === 'string' && id.includes('-')) {
      // Supabase UUID
      await (supabase as any)
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);
    }
  };

  const markAllNotificationsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
    toast('All notifications marked as read', 'info');
    if (user.id) {
      await (supabase as any)
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_id', user.id)
        .is('read_at', null);
    }
  };

  const unreadNotifCount = notifications.filter(n => n.unread).length;
  const contractPending = Boolean(state?.contract && state.contract.status === 'Pending Review');
  const paymentDueCount =
    state?.installments?.filter(i => ['Due', 'Overdue'].includes(i.status)).length || 0;

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
        {
          id: 'contracts' as ClientNavPage,
          label: 'Contracts',
          icon: FileSignature,
          badge: contractPending ? 1 : undefined,
        },
        {
          id: 'deliverables' as ClientNavPage,
          label: 'Deliverables',
          icon: Package,
        },
        {
          id: 'progress' as ClientNavPage,
          label: 'Project Progress',
          icon: TrendingUp,
        },
        {
          id: 'payments' as ClientNavPage,
          label: 'Payments',
          icon: CreditCard,
          badge: paymentDueCount > 0 ? paymentDueCount : undefined,
        },
      ],
    },
  ];

  const pageTitleMap: Record<ClientNavPage, { title: string; section?: string }> = {
    dashboard: { title: 'Dashboard' },
    contracts: { title: 'Contracts', section: 'My Project' },
    deliverables: { title: 'Deliverables', section: 'My Project' },
    progress: { title: 'Project Progress', section: 'My Project' },
    payments: { title: 'Payments', section: 'My Project' },
    settings: { title: 'Account Settings' },
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
            title={isCol ? 'Account Settings' : undefined}
          >
            <Settings size={16} />
            {!isCol && 'Account Settings'}
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
    if (loadingProjects) {
      return (
        <div className="py-24 text-center text-ink-3 text-xs flex flex-col items-center gap-3">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>Loading client workspace…</span>
        </div>
      );
    }

    if (!selectedProject || !state) {
      return (
        <Card pad={false}>
          <Empty
            icon={FolderKanban}
            title="No Active Projects"
            desc="Your client account is active. When the administrator assigns an active project to your company profile, it will appear here."
            action={
              <Button icon={RefreshCw} onClick={() => void loadProjects()}>
                Refresh Projects
              </Button>
            }
          />
        </Card>
      );
    }

    switch (page) {
      case 'dashboard':
        return (
          <ClientDashboardView
            user={user}
            project={selectedProject}
            state={state}
            notifications={notifications}
            go={setPage}
          />
        );

      case 'contracts':
        return (
          <ClientContractsView
            user={user}
            project={selectedProject}
            state={state}
            updateState={updateState}
          />
        );

      case 'deliverables':
        return (
          <ClientDeliverablesView
            user={user}
            project={selectedProject}
            state={state}
            updateState={updateState}
          />
        );

      case 'progress':
        return (
          <ClientProgressView
            user={user}
            project={selectedProject}
            state={state}
            go={setPage}
          />
        );

      case 'payments':
        return (
          <ClientPaymentsView
            user={user}
            project={selectedProject}
            state={state}
            updateState={updateState}
          />
        );

      case 'notifications':
        return (
          <ClientNotificationsView
            items={notifications}
            onMarkRead={markNotificationRead}
            onMarkAllRead={markAllNotificationsRead}
            onNavigate={setPage}
          />
        );

      case 'settings':
        return <ClientSettingsView user={user} changePassword={changePassword} />;

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
                    Account settings
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
   SUB-VIEW 1: Client Dashboard
========================================================================= */

function ClientDashboardView({
  user,
  project,
  state,
  notifications,
  go,
}: {
  user: AuthUser;
  project: ClientProject;
  state: StoredProjectState;
  notifications: ClientNotificationItem[];
  go: (p: ClientNavPage) => void;
}) {
  const { contract, deliverables, changes, installments, milestones, updates } = state;

  const done = deliverables.filter(d => d.status === 'Completed').length;
  const inprog = deliverables.filter(d => d.status === 'In Progress').length;
  const upcoming = deliverables.length - done - inprog;

  const pendChanges = changes.filter(c => c.status === 'Pending Review');
  const dueInstallment = installments.find(i => ['Due', 'Overdue'].includes(i.status));
  const nextUp = installments.find(i => i.status === 'Upcoming');

  const actionItems: {
    icon: typeof CreditCard;
    title: string;
    desc: string;
    to: ClientNavPage;
    cta: string;
  }[] = [];

  if (contract && contract.status === 'Pending Review') {
    actionItems.push({
      icon: FileSignature,
      title: `Review and accept contract ${contract.version}`,
      desc: `Assigned ${contract.assigned} · ${contract.ref}`,
      to: 'contracts',
      cta: 'Review',
    });
  }

  if (dueInstallment) {
    actionItems.push({
      icon: CreditCard,
      title: `Installment ${dueInstallment.id} of ${installments.length} is due ${dueInstallment.due}`,
      desc: `${inr(dueInstallment.amount)} · ${dueInstallment.name}`,
      to: 'payments',
      cta: 'View',
    });
  }

  const todayStr = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const progressPct = deliverables.length > 0 ? Math.round((done / deliverables.length) * 100) : 0;
  const activeMilestones = milestones.filter(m => m.state !== 'Completed');

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.primaryContact || user.name}`}
        desc={`${todayStr} · ${user.companyName || 'IRA Presence Client Workspace'}`}
      />

      {/* Needs Your Attention Card */}
      <Card className="mb-5 !p-0 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-line flex items-center justify-between bg-surface">
          <h2 className="text-[13px] font-semibold text-ink">Needs your attention</h2>
          <Badge tone={actionItems.length ? 'primary' : 'ok'} icon={false}>
            {actionItems.length
              ? `${actionItems.length} item${actionItems.length > 1 ? 's' : ''}`
              : 'All clear'}
          </Badge>
        </div>

        {actionItems.length === 0 ? (
          <div className="p-5 flex items-center gap-2 text-[13px] text-ink-2">
            <CheckCircle2 size={16} className="text-ok shrink-0" />
            <span>Nothing needs your action right now. All milestones are on schedule.</span>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {actionItems.map(a => (
              <li key={a.to} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#fafbfe]">
                <div className="w-8 h-8 rounded-md bg-primary-soft text-primary grid place-items-center shrink-0">
                  <a.icon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-ink truncate">{a.title}</div>
                  <div className="text-xs text-ink-2 truncate">{a.desc}</div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => go(a.to)}>
                  {a.cta}
                  <ArrowRight size={13} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Main 2-Column Grid */}
      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        {/* Left Column: Project Overview, Milestones, Updates */}
        <div className="space-y-5">
          <Card>
            <CardHead
              title={project.name}
              desc={`Managed by ${project.managerName}`}
              action={<Status s={project.status} />}
            />
            <KV
              cols={3}
              items={[
                ['Current stage', project.stage],
                ['Target completion', project.targetDate],
                [
                  'Contract',
                  contract ? (
                    <Status key="c" s={contract.status} />
                  ) : (
                    <span className="text-xs text-ink-3 font-medium">Not Assigned</span>
                  ),
                ],
              ]}
            />
            <div className="mt-5 pt-5 border-t border-line">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-ink-2">Deliverables completed</span>
                <span className="tnum font-medium text-ink">
                  {done} of {deliverables.length}
                </span>
              </div>
              <Progress value={progressPct} label="Deliverables completed" />
            </div>

            <div className="grid grid-cols-3 gap-3 mt-5">
              <Stat label="Completed" value={done} />
              <Stat label="In progress" value={inprog} />
              <Stat label="Upcoming" value={upcoming} />
            </div>

            <button
              onClick={() => go('deliverables')}
              className="mt-4 text-[13px] text-info hover:underline inline-flex items-center gap-1 font-medium"
            >
              View all deliverables
              <ArrowRight size={13} />
            </button>
          </Card>

          {/* Upcoming Milestones */}
          <Card>
            <CardHead
              title="Upcoming milestones"
              action={
                <button
                  onClick={() => go('progress')}
                  className="text-xs text-info hover:underline font-medium"
                >
                  Full progress
                </button>
              }
            />
            {activeMilestones.length === 0 ? (
              <p className="text-[13px] text-ink-3">No upcoming milestones scheduled.</p>
            ) : (
              <Timeline
                items={activeMilestones.map(m => ({
                  tone: m.state === 'In Progress' ? 'warn' : undefined,
                  title: (
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-ink">{m.name}</span>
                      <Status s={m.state} />
                    </span>
                  ),
                  meta: m.date,
                }))}
              />
            )}
          </Card>

          {/* Recent Project Updates */}
          <Card>
            <CardHead title="Recent project updates" />
            {updates.length === 0 ? (
              <p className="text-[13px] text-ink-3">No recent updates posted.</p>
            ) : (
              <Timeline
                items={updates.map(u => ({
                  title: u.title,
                  meta: u.meta,
                  tone: u.tone,
                }))}
              />
            )}
          </Card>
        </div>

        {/* Right Column: Next Payment, Change Requests, Recent Notifications */}
        <div className="space-y-5">
          {/* Next Payment */}
          <Card>
            <CardHead
              title="Next payment"
              action={
                <button
                  onClick={() => go('payments')}
                  className="text-xs text-info hover:underline font-medium"
                >
                  Schedule
                </button>
              }
            />
            {dueInstallment || nextUp ? (
              <div>
                <div className="text-[26px] font-semibold tracking-[-0.02em] tnum text-ink">
                  {inr((dueInstallment ?? nextUp)!.amount)}
                </div>
                <div className="text-[13px] text-ink-2 mt-0.5">
                  {(dueInstallment ?? nextUp)!.name}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Status s={(dueInstallment ?? nextUp)!.status} />
                  <span className="text-xs text-ink-2">
                    Due {(dueInstallment ?? nextUp)!.due}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-ink-3">No upcoming installments scheduled.</p>
            )}
          </Card>

          {/* Change Requests */}
          <Card>
            <CardHead
              title="Change requests"
              action={<GitPullRequest size={15} className="text-ink-3" />}
            />
            {pendChanges.length === 0 ? (
              <p className="text-[13px] text-ink-3">No pending change requests.</p>
            ) : (
              <ul className="space-y-3">
                {pendChanges.map(c => (
                  <li key={c.id} className="text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink truncate">
                        {c.del} · {c.field}
                      </span>
                      <Status s="Pending Review" />
                    </div>
                    <div className="text-xs text-ink-3 mt-0.5">
                      Submitted {c.at.split(',')[0]}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Notifications summary card */}
          <Card>
            <CardHead
              title="Recent notifications"
              action={
                <button
                  onClick={() => go('notifications')}
                  className="text-xs text-info hover:underline font-medium"
                >
                  View all
                </button>
              }
            />
            {notifications.length === 0 ? (
              <p className="text-[13px] text-ink-3">No recent notifications.</p>
            ) : (
              <ul className="space-y-3 text-[13px]">
                {notifications.slice(0, 3).map(n => (
                  <li key={n.id}>
                    <div className="font-medium text-ink truncate">{n.title}</div>
                    <div className="text-xs text-ink-3">{n.when}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/* =========================================================================
   SUB-VIEW 2: Contracts View
========================================================================= */

function ClientContractsView({
  user,
  project,
  state,
  updateState,
}: {
  user: AuthUser;
  project: ClientProject;
  state: StoredProjectState;
  updateState: (updater: (prev: StoredProjectState) => StoredProjectState) => void;
}) {
  const toast = useToast();
  const { contract, acceptance } = state;
  const [agree, setAgree] = useState(false);
  const [dlg, setDlg] = useState<'accept' | 'decline' | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  if (!contract) {
    return (
      <>
        <PageHeader
          title="Contracts"
          desc="Review and confirm acceptance of contracts and scope agreements."
        />
        <Card pad={false}>
          <Empty
            icon={FileSignature}
            title="No contract assigned"
            desc="Your project team has not attached a contract document for this project yet. Contracts will appear here once assigned by IRA management."
          />
        </Card>
      </>
    );
  }

  const accepted = contract.status === 'Accepted';

  const handleConfirmAcceptance = () => {
    const nowStr = new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date());

    updateState(prev => {
      if (!prev.contract) return prev;
      return {
        ...prev,
        contract: {
          ...prev.contract,
          status: 'Accepted',
          acceptedAt: nowStr,
          acceptedUrl: prev.contract.url,
        },
        acceptance: [
          {
            id: Date.now(),
            version: prev.contract.version,
            url: prev.contract.url,
            who: user.primaryContact || user.name,
            at: nowStr,
            event: 'Accepted',
            note: `Officially accepted and signed off by ${user.companyName || user.name}.`,
          },
          ...prev.acceptance,
        ],
      };
    });

    setDlg(null);
    toast('Contract accepted and recorded successfully');
  };

  const handleConfirmDecline = () => {
    updateState(prev => {
      if (!prev.contract) return prev;
      return {
        ...prev,
        contract: {
          ...prev.contract,
          status: 'Declined',
        },
      };
    });
    setDlg(null);
    toast('Your response has been sent to the project team', 'info');
  };

  return (
    <>
      <PageHeader
        title="Contracts"
        desc="Review the linked contract, then confirm your acceptance. The exact link and version you accept are recorded."
      />

      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5">
          {/* Current Contract Card */}
          <Card>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="flex gap-3 min-w-0">
                <div className="w-10 h-10 rounded-md bg-primary-soft text-primary grid place-items-center shrink-0">
                  <FileSignature size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink truncate">
                    {contract.title}
                  </h2>
                  <p className="text-xs text-ink-2 mt-0.5">
                    {project.name} · {contract.ref} · {contract.version}
                  </p>
                </div>
              </div>
              <Status s={contract.status} />
            </div>

            <KV
              cols={3}
              items={[
                ['Project', project.name],
                ['Date assigned', contract.assigned],
                ['Version', contract.version],
                [
                  'Contract link',
                  <LinkRef key="l" url={contract.url} label="Document link" />,
                ],
                ['Status', contract.status],
                ['Accepted on', accepted ? contract.acceptedAt || 'Accepted' : 'Not yet accepted'],
              ]}
            />

            <div className="mt-5">
              <a
                href={contract.url}
                target="_blank"
                rel="noreferrer"
              >
                <Button icon={ExternalLink}>Open contract</Button>
              </a>
            </div>
          </Card>

          {/* Acceptance Box or Accepted Banner */}
          {accepted ? (
            <Alert tone="ok" title="Contract accepted" action={<Badge tone="ok">Accepted</Badge>}>
              Recorded on {contract.acceptedAt} by {user.primaryContact || user.name} against{' '}
              {contract.version} ({contract.ref}). If the contract is later amended by IRA, you will be
              asked to review the new version and these accepted terms remain permanently on record.
            </Alert>
          ) : contract.status === 'Declined' ? (
            <Alert tone="err" title="Contract declined">
              You marked this contract as declined. Your project manager ({project.managerName}) has
              been notified and will contact you with an amended version.
            </Alert>
          ) : (
            <Card>
              <CardHead
                title="Accept this contract"
                desc="Open and read the contract document first. Acceptance is permanently recorded."
              />
              <ol className="text-[13px] text-ink-2 space-y-1.5 mb-4 list-decimal pl-4">
                <li>Open the contract using the button above.</li>
                <li>Read it fully, including any attached milestones and payment schedules.</li>
                <li>Return here and confirm below.</li>
              </ol>

              <Checkbox
                checked={agree}
                onChange={setAgree}
                label="I confirm I have reviewed the linked contract document and agree to its terms on behalf of my company."
              />

              <div className="flex flex-wrap gap-2 mt-4">
                <Button
                  variant="primary"
                  disabled={!agree}
                  icon={CheckCircle2}
                  onClick={() => setDlg('accept')}
                >
                  Accept Contract
                </Button>
                <Button variant="ghost" onClick={() => setDlg('decline')}>
                  Decline or ask a question
                </Button>
              </div>
            </Card>
          )}
        </div>

        {/* Acceptance History */}
        <Card>
          <CardHead
            title="Acceptance history"
            desc="Every acceptance keeps its exact link and version on record."
          />
          {acceptance.length === 0 && !accepted ? (
            <p className="text-[13px] text-ink-3">No acceptance history on record.</p>
          ) : (
            <Timeline
              items={[
                ...(accepted
                  ? [
                      {
                        tone: 'ok' as const,
                        title: `${contract.version} accepted`,
                        meta: `${user.primaryContact || user.name} · ${contract.acceptedAt}`,
                        body: <span className="break-all text-xs">{contract.acceptedUrl}</span>,
                      },
                    ]
                  : []),
                ...(contract.status === 'Declined'
                  ? [
                      {
                        tone: 'err' as const,
                        title: `${contract.version} declined`,
                        meta: `${user.primaryContact || user.name} · Response sent`,
                      },
                    ]
                  : []),
                ...acceptance.map(a => ({
                  tone: 'ok' as const,
                  title: `${a.version} ${a.event.toLowerCase()}`,
                  meta: `${a.who} · ${a.at}`,
                  body: (
                    <div className="text-xs">
                      <span className="break-all block text-ink-3">{a.url}</span>
                      {a.note && <span className="block mt-1 text-ink-2">{a.note}</span>}
                    </div>
                  ),
                })),
              ]}
            />
          )}
        </Card>
      </div>

      {/* Confirmation Dialog */}
      <Dialog
        open={dlg === 'accept'}
        onClose={() => setDlg(null)}
        title="Accept this contract?"
        desc={`You are accepting ${contract.ref} (${contract.version}). Your name (${user.primaryContact || user.name}), current time, and the exact contract URL will be permanently recorded.`}
        footer={
          <>
            <Button onClick={() => setDlg(null)}>Review again</Button>
            <Button variant="primary" onClick={handleConfirmAcceptance}>
              Confirm acceptance
            </Button>
          </>
        }
      />

      {/* Decline Dialog */}
      <Dialog
        open={dlg === 'decline'}
        onClose={() => setDlg(null)}
        tone="danger"
        title="Decline or request amendment?"
        desc={`Your assigned manager (${project.managerName}) will be notified and will prepare a revised version.`}
        footer={
          <>
            <Button onClick={() => setDlg(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleConfirmDecline}>
              Submit feedback
            </Button>
          </>
        }
      >
        <Field label="Reason or feedback (optional)">
          <Textarea
            value={declineReason}
            onChange={e => setDeclineReason(e.target.value)}
            placeholder="Describe any terms or milestones requiring revision…"
          />
        </Field>
      </Dialog>
    </>
  );
}

/* =========================================================================
   SUB-VIEW 3: Deliverables View
========================================================================= */

function ClientDeliverablesView({
  user,
  project,
  state,
  updateState,
}: {
  user: AuthUser;
  project: ClientProject;
  state: StoredProjectState;
  updateState: (updater: (prev: StoredProjectState) => StoredProjectState) => void;
}) {
  const toast = useToast();
  const { deliverables, changes } = state;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requestDrawerOpen, setRequestDrawerOpen] = useState(false);

  const [reqField, setReqField] = useState('Timeline');
  const [reqValue, setReqValue] = useState('');
  const [reqReason, setReqReason] = useState('');

  const activeDeliverable = deliverables.find(d => d.id === selectedId);
  const pendingChange = (delId: string) =>
    changes.find(c => c.del === delId && c.status === 'Pending Review');

  const filteredRows = deliverables.filter(d => {
    const matchesStatus = statusFilter === 'All' || d.status === statusFilter;
    const matchesSearch =
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.id.toLowerCase().includes(search.toLowerCase()) ||
      d.desc.toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const currentValue = activeDeliverable
    ? (activeDeliverable as any)[FIELD_KEYS[reqField]] || ''
    : '';

  const handleSubmitChangeRequest = () => {
    if (!activeDeliverable || !reqValue.trim()) return;

    const nowStr = new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date());

    const newChange: ClientChangeRequest = {
      id: `CR-00${changes.length + 1}`,
      del: activeDeliverable.id,
      delName: activeDeliverable.name,
      field: reqField,
      prev: currentValue,
      next: reqValue.trim(),
      by: user.primaryContact || user.name,
      at: nowStr,
      status: 'Pending Review',
      reason: reqReason.trim(),
      reviewer: '',
      comment: '',
    };

    updateState(prev => ({
      ...prev,
      changes: [newChange, ...prev.changes],
    }));

    setRequestDrawerOpen(false);
    setReqValue('');
    setReqReason('');
    toast('Change request submitted. Your project team will review it.');
  };

  if (deliverables.length === 0) {
    return (
      <>
        <PageHeader
          title="Deliverables"
          desc="Everything included in your project scope. Approved changes update the deliverable and are preserved in history."
        />
        <Card pad={false}>
          <Empty
            icon={Package}
            title="No deliverables configured"
            desc="No deliverables have been configured for this project yet. Deliverables will appear here once assigned by your project manager."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Deliverables"
        desc="Everything included in your project scope. You can request a change to any item; approved changes update the deliverable and are permanently preserved in its history."
      />

      <FilterBar>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search deliverables"
          className="w-full sm:w-64"
        />
        <Select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="w-full sm:w-44"
          aria-label="Filter by status"
        >
          {['All', 'Not Started', 'In Progress', 'Completed'].map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        rows={filteredRows}
        onRow={r => setSelectedId(r.id)}
        empty={
          <Empty
            icon={Package}
            title="No matching deliverables"
            desc="Try adjusting your search query or status filter."
            action={
              <Button
                onClick={() => {
                  setSearch('');
                  setStatusFilter('All');
                }}
              >
                Clear filters
              </Button>
            }
          />
        }
        cols={[
          {
            key: 'id',
            head: 'No.',
            w: '84px',
            render: r => <span className="font-mono text-xs text-ink-2">{r.id}</span>,
            mobile: 'hide',
          },
          {
            key: 'name',
            head: 'Deliverable',
            mobile: 'title',
            render: r => (
              <div className="py-1">
                <div className="font-medium text-ink">
                  <span className="font-mono text-xs text-ink-3 md:hidden mr-1.5">{r.id}</span>
                  {r.name}
                </div>
                <div className="text-xs text-ink-3 hidden md:block truncate max-w-[340px]">
                  {r.desc}
                </div>
              </div>
            ),
          },
          {
            key: 'qty',
            head: 'Qty',
            w: '60px',
            render: r => <span className="tnum font-medium">{r.qty}</span>,
          },
          {
            key: 'due',
            head: 'Timeline',
            render: r => <span className="text-ink-2 text-xs">{r.due}</span>,
          },
          {
            key: 'deps',
            head: 'Depends on',
            render: r => <span className="text-ink-2 text-xs">{r.deps}</span>,
          },
          {
            key: 'status',
            head: 'Status',
            render: r => <Status s={r.status} />,
          },
          {
            key: 'chg',
            head: 'Change',
            render: r =>
              pendingChange(r.id) ? (
                <Badge tone="warn">Pending Review</Badge>
              ) : (
                <span className="text-ink-3">—</span>
              ),
          },
        ]}
      />

      {/* Deliverable Details SidePanel */}
      <SidePanel
        open={!!activeDeliverable && !requestDrawerOpen}
        onClose={() => setSelectedId(null)}
        title={activeDeliverable ? `${activeDeliverable.id} · ${activeDeliverable.name}` : ''}
        sub={activeDeliverable && `Last updated ${activeDeliverable.updated}`}
        footer={
          activeDeliverable && (
            <Button
              variant="primary"
              icon={GitPullRequest}
              onClick={() => setRequestDrawerOpen(true)}
              disabled={!!pendingChange(activeDeliverable.id)}
            >
              {pendingChange(activeDeliverable.id)
                ? 'Change request pending'
                : 'Request a change'}
            </Button>
          )
        }
      >
        {activeDeliverable && (
          <div className="space-y-6">
            <div className="flex gap-2 items-center">
              <Status s={activeDeliverable.status} />
              {pendingChange(activeDeliverable.id) && (
                <Badge tone="warn">Change pending review</Badge>
              )}
            </div>

            <p className="text-[13px] text-ink-2 leading-relaxed">{activeDeliverable.desc}</p>

            <KV
              cols={2}
              items={[
                ['Quantity', activeDeliverable.qty],
                ['Timeline', activeDeliverable.due],
                ['Depends on', activeDeliverable.deps],
                ['Lead Owner', activeDeliverable.owner],
                [
                  'Reference link',
                  activeDeliverable.ref === '—' ? (
                    '—'
                  ) : (
                    <LinkRef url={activeDeliverable.ref} />
                  ),
                ],
              ]}
            />

            <div>
              <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5 text-ink">
                <History size={14} />
                Change history
              </h3>
              {changes.filter(c => c.del === activeDeliverable.id).length === 0 ? (
                <p className="text-xs text-ink-3">
                  No changes have been requested for this deliverable.
                </p>
              ) : (
                <Timeline
                  items={changes
                    .filter(c => c.del === activeDeliverable.id)
                    .map(c => ({
                      tone:
                        c.status === 'Approved Change'
                          ? 'ok'
                          : c.status === 'Change Declined'
                          ? 'err'
                          : 'warn',
                      title: (
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-ink">{c.field}</span>
                          <Status s={c.status} />
                        </span>
                      ),
                      meta: `${c.by} · ${c.at}`,
                      body: (
                        <div className="space-y-1.5 text-xs">
                          <div className="grid grid-cols-[64px_1fr] gap-x-2">
                            <span className="text-ink-3">Previous</span>
                            <span className="line-through decoration-ink-3/50 text-ink-3">
                              {c.prev}
                            </span>
                            <span className="text-ink-3">Requested</span>
                            <span className="font-medium text-ink">{c.next}</span>
                          </div>
                          {c.reason && <div className="text-ink-2">“{c.reason}”</div>}
                          {c.reviewer && (
                            <div className="pt-1.5 border-t border-line text-ink-3">
                              Decision by {c.reviewer}: {c.comment}
                            </div>
                          )}
                        </div>
                      ),
                    }))}
                />
              )}
            </div>
          </div>
        )}
      </SidePanel>

      {/* Request a Change Drawer */}
      <SidePanel
        open={requestDrawerOpen && !!activeDeliverable}
        onClose={() => setRequestDrawerOpen(false)}
        title="Request a change"
        sub={activeDeliverable && `${activeDeliverable.id} · ${activeDeliverable.name}`}
        footer={
          <>
            <Button onClick={() => setRequestDrawerOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!reqValue.trim()}
              onClick={handleSubmitChangeRequest}
            >
              Submit request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert title="Your request does not change the deliverable directly">
            It is recorded as pending and reviewed by your assigned project team. You will be
            notified as soon as a decision is recorded.
          </Alert>

          <Field label="What would you like to change?" required>
            <Select value={reqField} onChange={e => setReqField(e.target.value)}>
              {Object.keys(FIELD_KEYS).map(f => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Current value">
            <Input value={currentValue} disabled readOnly />
          </Field>

          <Field label="Requested value" required>
            <Textarea
              value={reqValue}
              onChange={e => setReqValue(e.target.value)}
              placeholder="Describe the requested adjustment..."
            />
          </Field>

          <Field
            label="Reason or clarification"
            hint="Helps the project management team review and decide faster."
          >
            <Textarea
              value={reqReason}
              onChange={e => setReqReason(e.target.value)}
              placeholder="e.g. Operational schedule changes or scope adjustment..."
            />
          </Field>
        </div>
      </SidePanel>
    </>
  );
}

/* =========================================================================
   SUB-VIEW 4: Project Progress View
========================================================================= */

function ClientProgressView({
  user,
  project,
  state,
  go,
}: {
  user: AuthUser;
  project: ClientProject;
  state: StoredProjectState;
  go: (p: ClientNavPage) => void;
}) {
  const { deliverables, changes, contract, installments, milestones, updates } = state;

  const done = deliverables.filter(d => d.status === 'Completed').length;
  const inprog = deliverables.filter(d => d.status === 'In Progress').length;
  const upcoming = deliverables.length - done - inprog;
  const pendChangesCount = changes.filter(c => c.status === 'Pending Review').length;
  const dueInstallment = installments.find(i => ['Due', 'Overdue'].includes(i.status));

  const pct = deliverables.length > 0 ? Math.round((done / deliverables.length) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Project Progress"
        desc={project.name}
        actions={<Status s={project.status} />}
      />

      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        {/* Left Column: Overview, Stats, Milestones */}
        <div className="space-y-5">
          <Card>
            <CardHead title="Overview" />
            <KV
              cols={3}
              items={[
                ['Current stage', project.stage],
                ['Start date', project.startDate],
                ['Target completion', project.targetDate],
                ['Assigned manager', project.managerName],
                ['Overall status', <Status key="s" s={project.status} />],
              ]}
            />
            <div className="mt-5 pt-5 border-t border-line">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-ink-2">Deliverables completed</span>
                <span className="tnum font-medium text-ink">
                  {done} of {deliverables.length}
                </span>
              </div>
              <Progress value={pct} label="Deliverables completed" />
              <p className="text-[11px] text-ink-3 mt-2">
                Calculated as completed deliverables ÷ total deliverables.
              </p>
            </div>
          </Card>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Completed" value={done} />
            <Stat label="In progress" value={inprog} />
            <Stat label="Not started" value={upcoming} />
          </div>

          <Card>
            <CardHead title="Milestones" />
            {milestones.length === 0 ? (
              <p className="text-[13px] text-ink-3">No milestones scheduled yet.</p>
            ) : (
              <Timeline
                items={milestones.map(m => ({
                  tone:
                    m.state === 'Completed'
                      ? 'ok'
                      : m.state === 'In Progress'
                      ? 'warn'
                      : undefined,
                  title: (
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-ink">{m.name}</span>
                      <Status s={m.state} />
                    </span>
                  ),
                  meta: m.date,
                }))}
              />
            )}
          </Card>
        </div>

        {/* Right Column: Needs attention, Recent updates */}
        <div className="space-y-5">
          <Card>
            <CardHead title="Needs your attention" />
            <ul className="space-y-3 text-[13px]">
              {contract && contract.status === 'Pending Review' && (
                <li className="flex justify-between gap-2">
                  <span>Contract {contract.version} to review</span>
                  <button
                    className="text-info hover:underline font-medium"
                    onClick={() => go('contracts')}
                  >
                    Open
                  </button>
                </li>
              )}
              {pendChangesCount > 0 && (
                <li className="flex justify-between gap-2">
                  <span>
                    {pendChangesCount} change request{pendChangesCount > 1 ? 's' : ''} awaiting team
                    review
                  </span>
                  <button
                    className="text-info hover:underline font-medium"
                    onClick={() => go('deliverables')}
                  >
                    View
                  </button>
                </li>
              )}
              {dueInstallment && (
                <li className="flex justify-between gap-2">
                  <span>
                    Installment {dueInstallment.id} due {dueInstallment.due}
                  </span>
                  <button
                    className="text-info hover:underline font-medium"
                    onClick={() => go('payments')}
                  >
                    View
                  </button>
                </li>
              )}
              {!(contract && contract.status === 'Pending Review') &&
                pendChangesCount === 0 &&
                !dueInstallment && (
                  <li className="text-ink-3">Nothing pending. You are completely up to date.</li>
                )}
            </ul>
          </Card>

          <Card>
            <CardHead title="Recent updates" />
            {updates.length === 0 ? (
              <p className="text-[13px] text-ink-3">No recent updates posted.</p>
            ) : (
              <Timeline
                items={updates.map(u => ({
                  title: u.title,
                  meta: u.meta,
                  tone: u.tone,
                }))}
              />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/* =========================================================================
   SUB-VIEW 5: Payments View
========================================================================= */

function ClientPaymentsView({
  user,
  project,
  state,
  updateState,
}: {
  user: AuthUser;
  project: ClientProject;
  state: StoredProjectState;
  updateState: (updater: (prev: StoredProjectState) => StoredProjectState) => void;
}) {
  const toast = useToast();
  const { installments } = state;

  const total = installments.reduce((acc, i) => acc + i.amount, 0);
  const paid = installments
    .filter(i => i.status === 'Paid')
    .reduce((acc, i) => acc + i.amount, 0);

  const nextDue =
    installments.find(i => ['Due', 'Overdue', 'Pending Verification'].includes(i.status)) ??
    installments.find(i => i.status === 'Upcoming');

  const [selectedInstallmentId, setSelectedInstallmentId] = useState<number | null>(null);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [refInput, setRefInput] = useState('');

  const activeInstallment = installments.find(i => i.id === selectedInstallmentId);

  const handleSubmitReference = () => {
    if (!activeInstallment || !refInput.trim()) return;

    updateState(prev => ({
      ...prev,
      installments: prev.installments.map(item =>
        item.id === activeInstallment.id
          ? {
              ...item,
              status: 'Pending Verification',
              ref: refInput.trim(),
            }
          : item
      ),
    }));

    setSubmitDialogOpen(false);
    setSelectedInstallmentId(null);
    setRefInput('');
    toast('Payment reference submitted for verification by the IRA finance team');
  };

  const hasPendingVerification = installments.some(i => i.status === 'Pending Verification');

  if (installments.length === 0) {
    return (
      <>
        <PageHeader
          title="Payments"
          desc={`${project.name} — your agreed installment schedule. An installment is marked Paid after verified bank receipt.`}
        />
        <Card pad={false}>
          <Empty
            icon={CreditCard}
            title="No payment schedule configured"
            desc="No payment installments have been scheduled for this project yet. Installments will appear here once configured by the finance department."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Payments"
        desc={`${project.name} — your agreed installment schedule. An installment is marked Paid after verified bank receipt.`}
      />

      {/* 4 Financial Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat
          label="Total project amount"
          value={inr(total)}
          sub={`${installments.length} installments`}
        />
        <Stat label="Paid" value={inr(paid)} sub="Verified bank payments" />
        <Stat label="Remaining balance" value={inr(total - paid)} />
        <Stat
          label={
            nextDue?.status === 'Pending Verification'
              ? 'Awaiting verification'
              : 'Next installment'
          }
          value={nextDue ? inr(nextDue.amount) : '—'}
          sub={nextDue ? `${nextDue.name} · ${nextDue.due}` : ''}
          tone={nextDue?.status === 'Overdue' ? 'err' : undefined}
        />
      </div>

      {hasPendingVerification && (
        <div className="mb-4">
          <Alert tone="info" title="Payment reference under verification">
            Your submitted payment reference is being verified against our bank statement. The
            installment status will update to Paid as soon as confirmed.
          </Alert>
        </div>
      )}

      {/* Installments Table */}
      <DataTable
        rows={installments}
        onRow={x => setSelectedInstallmentId(x.id)}
        pageSize={10}
        cols={[
          {
            key: 'n',
            head: '#',
            w: '48px',
            render: x => <span className="tnum text-ink-2 font-mono">{x.id}</span>,
            mobile: 'hide',
          },
          {
            key: 'nm',
            head: 'Installment',
            mobile: 'title',
            render: x => (
              <div>
                <div className="font-medium text-ink">{x.name}</div>
                <div className="text-xs text-ink-3">{x.basis} of project amount</div>
              </div>
            ),
          },
          {
            key: 'a',
            head: 'Amount',
            align: 'right',
            render: x => <span className="font-semibold text-ink">{inr(x.amount)}</span>,
          },
          {
            key: 'd',
            head: 'Due',
            render: x => <span className="text-xs text-ink-2">{x.due}</span>,
          },
          {
            key: 's',
            head: 'Status',
            render: x => <Status s={x.status} />,
          },
          {
            key: 'r',
            head: 'Reference',
            render: x => (
              <span className="font-mono text-xs text-ink-2">{x.ref || '—'}</span>
            ),
          },
        ]}
        actions={x =>
          ['Due', 'Overdue'].includes(x.status) ? (
            <Button
              size="sm"
              onClick={() => {
                setSelectedInstallmentId(x.id);
                setSubmitDialogOpen(true);
              }}
            >
              Pay
            </Button>
          ) : null
        }
      />

      <p className="text-xs text-ink-3 mt-4 flex items-center gap-1.5">
        <ShieldCheck size={14} className="text-ink-3 shrink-0" />
        Online card/UPI direct payment gateway will be enabled in an upcoming release; bank
        transfer references can be recorded above.
      </p>

      {/* Installment Detail SidePanel */}
      <SidePanel
        open={!!activeInstallment && !submitDialogOpen}
        onClose={() => setSelectedInstallmentId(null)}
        title={activeInstallment?.name ?? ''}
        sub={activeInstallment && `Installment ${activeInstallment.id} of ${installments.length}`}
        footer={
          activeInstallment && ['Due', 'Overdue'].includes(activeInstallment.status) ? (
            <>
              <Button disabled title="Online payment processing will be added in a later release">
                Pay online
              </Button>
              <Button
                variant="primary"
                onClick={() => setSubmitDialogOpen(true)}
              >
                I’ve paid — add reference
              </Button>
            </>
          ) : undefined
        }
      >
        {activeInstallment && (
          <div className="space-y-5">
            <Status s={activeInstallment.status} />
            <KV
              items={[
                ['Amount', inr(activeInstallment.amount)],
                ['Share', activeInstallment.basis],
                ['Due date', activeInstallment.due],
                ['Paid on', activeInstallment.paidOn || '—'],
                ['Payment reference', activeInstallment.ref || '—'],
              ]}
            />
            {activeInstallment.status === 'Paid' && (
              <Alert tone="ok" title="Verified receipt">
                This installment has been received and verified by the finance department.
              </Alert>
            )}
          </div>
        )}
      </SidePanel>

      {/* Add Payment Reference Dialog */}
      <Dialog
        open={submitDialogOpen}
        onClose={() => setSubmitDialogOpen(false)}
        title="Add payment reference"
        desc="After you make your payment via NEFT, RTGS, IMPS, or bank transfer, enter the transaction reference number below. Your team will verify it against the bank statement before marking it as Paid."
        footer={
          <>
            <Button onClick={() => setSubmitDialogOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!refInput.trim()}
              onClick={handleSubmitReference}
            >
              Submit for verification
            </Button>
          </>
        }
      >
        <Field label="Bank transaction reference / UTR number" required>
          <Input
            value={refInput}
            onChange={e => setRefInput(e.target.value)}
            placeholder="e.g. NEFT-93021884 or UTR-20261015"
          />
        </Field>
      </Dialog>
    </>
  );
}

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
  onMarkRead: (id: string | number) => void;
  onMarkAllRead: () => void;
  onNavigate: (p: ClientNavPage) => void;
}) {
  const [tab, setTab] = useState('all');
  const filtered = tab === 'all' ? items : items.filter(n => n.unread);

  return (
    <>
      <PageHeader
        title="Notifications"
        desc="Real-time alerts, project updates, and email delivery confirmations."
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
                  {n.email === 'Sent' && <Badge tone="ok">Email sent</Badge>}
                  {n.email === 'Failed' && <Badge tone="err">Email delivery failed</Badge>}
                  {n.email === 'Not Sent' && <Badge>Email not sent</Badge>}
                </div>
                <p className="text-[13px] text-ink-2 mt-0.5 leading-relaxed">{n.body}</p>
                <div className="text-xs text-ink-3 mt-1">
                  {n.when} · {n.ref}
                </div>
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
                {n.actionUrl && (
                  <button
                    className="text-xs text-ink-2 hover:text-ink font-medium underline"
                    onClick={() => {
                      onMarkRead(n.id);
                      if (['contracts', 'deliverables', 'progress', 'payments'].includes(n.actionUrl!)) {
                        onNavigate(n.actionUrl as ClientNavPage);
                      }
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
  const [tab, setTab] = useState('account');

  // Notification switches
  const [prefs, setPrefs] = useState({
    contract: true,
    progress: true,
    payment: true,
    changes: true,
  });

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

  const clientPrefList: { key: keyof typeof prefs; title: string; desc: string }[] = [
    {
      key: 'contract',
      title: 'Contract notifications',
      desc: 'Email notifications when contracts are assigned or updated.',
    },
    {
      key: 'progress',
      title: 'Project progress updates',
      desc: 'Email digest when milestones or deliverable stages change.',
    },
    {
      key: 'payment',
      title: 'Payment reminders',
      desc: 'Email reminders before and on installment due dates.',
    },
    {
      key: 'changes',
      title: 'Change request decisions',
      desc: 'Email notifications when change requests are reviewed or decided.',
    },
  ];

  return (
    <>
      <PageHeader title="Account Settings" />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'account', label: 'Account' },
          { id: 'notifications', label: 'Notifications' },
        ]}
      />

      {tab === 'account' && (
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
              <Field label="Login ID / Email" hint="Contact your administrator to change your email address.">
                <Input defaultValue={user.email} disabled />
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

      {tab === 'notifications' && (
        <Card>
          <CardHead
            title="Email notifications"
            desc="Control which project updates are automatically dispatched to your email address."
          />
          <div className="divide-y divide-line">
            {clientPrefList.map(item => (
              <div
                key={item.key}
                className="flex items-center justify-between gap-4 py-3.5"
              >
                <div>
                  <div className="text-[13px] font-medium text-ink">{item.title}</div>
                  <div className="text-xs text-ink-2">{item.desc}</div>
                </div>
                <Switch
                  checked={prefs[item.key]}
                  onChange={v => setPrefs({ ...prefs, [item.key]: v })}
                  label={item.title}
                />
              </div>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-line">
            <Button variant="primary" onClick={() => toast('Notification preferences saved')}>
              Save preferences
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
