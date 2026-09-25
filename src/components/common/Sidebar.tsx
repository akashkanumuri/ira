import React from 'react';
import type { UserRole, Employee } from '../../types/attendance';
import { BrandLogo } from './BrandLogo';
import {
  LayoutDashboard,
  Clock,
  Home,
  FileText,
  FileEdit,
  Users,
  FileSpreadsheet,
  Palmtree,
  LogOut,
} from 'lucide-react';

interface SidebarProps {
  activeRole: UserRole;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  currentUser: Employee;
  onLogout: () => void;
  pendingWfhCount?: number;
  pendingLeaveCount?: number;
  pendingCorrectionCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeRole,
  activeTab,
  onSelectTab,
  currentUser,
  onLogout,
  pendingWfhCount = 0,
  pendingLeaveCount = 0,
  pendingCorrectionCount = 0,
}) => {
  type NavItem = {
    id: string;
    label: string;
    icon: React.ElementType;
    badge?: number;
    badgeColor?: string;
  };

  const employeeNav: NavItem[] = [
    { id: 'emp-dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'emp-attendance', label: 'My Attendance', icon: Clock },
    { id: 'emp-wfh', label: 'WFH Requests', icon: Home, badge: pendingWfhCount > 0 ? pendingWfhCount : undefined },
    { id: 'emp-leave', label: 'Leave Requests', icon: FileText },
    { id: 'emp-corrections', label: 'Corrections', icon: FileEdit },
    { id: 'emp-holidays', label: 'Holidays', icon: Palmtree },
  ];

  const adminNav: NavItem[] = [
    { id: 'admin-dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'admin-attendance', label: 'Attendance', icon: Clock },
    { id: 'admin-employees', label: 'Employees', icon: Users },
    { id: 'admin-wfh', label: 'WFH Requests', icon: Home, badge: pendingWfhCount > 0 ? pendingWfhCount : undefined, badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
    { id: 'admin-leave', label: 'Leave Requests', icon: FileText, badge: pendingLeaveCount > 0 ? pendingLeaveCount : undefined, badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
    { id: 'admin-corrections', label: 'Corrections', icon: FileEdit, badge: pendingCorrectionCount > 0 ? pendingCorrectionCount : undefined, badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    { id: 'admin-export', label: 'Excel Export', icon: FileSpreadsheet },
    { id: 'admin-holidays', label: 'Holidays', icon: Palmtree },
  ];

  const navItems = activeRole === 'admin' ? adminNav : employeeNav;

  return (
    <aside className="hidden lg:flex w-64 bg-slate-900 text-slate-300 flex-col justify-between h-[calc(100vh-53px)] sticky top-[53px] border-r border-slate-800/90 shrink-0">
      <div className="p-3.5 overflow-y-auto space-y-5">
        <div className="px-2 py-1.5 flex items-center justify-between">
          <BrandLogo variant="dark" size="sm" />
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">v2.4</span>
        </div>
        <nav className="space-y-0.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 pb-1.5">
            {activeRole === 'admin' ? 'Workforce Management' : 'Employee Workspace'}
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${isActive ? 'bg-blue-600 text-white font-semibold shadow-xs' : 'text-slate-400 hover:text-white hover:bg-slate-800/70'}`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${item.badgeColor || (isActive ? 'bg-white text-blue-700' : 'bg-slate-800 text-slate-200 border-slate-700')}`}>{item.badge}</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-3 border-t border-slate-800/90 bg-slate-950/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {currentUser.avatar ? (
              <img src={currentUser.avatar} alt={currentUser.name} className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-700 shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-bold ring-1 ring-slate-700 shrink-0">
                {(currentUser.name || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{currentUser.name}</p>
              <p className="text-[10px] text-slate-400 truncate">{activeRole === 'admin' ? 'Administrator' : 'Employee'}</p>
            </div>
          </div>
          <button onClick={onLogout} title="Sign out" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
