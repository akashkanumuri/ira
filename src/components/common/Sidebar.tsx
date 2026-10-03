import React from 'react';
import type { AuthUser } from '../../contexts/AuthContext';
import { LayoutDashboard, Clock3, Users, BriefcaseBusiness, CalendarDays, Home, WalletCards, FileClock, Settings2, UserRound, FileSpreadsheet } from 'lucide-react';

interface Props {
  activeRole: 'admin' | 'employee';
  activeTab: string;
  onSelectTab: (tab: string) => void;
  currentUser: AuthUser;
  pendingTaskCount?: number;
  pendingTaskCount?: number;
  pendingWfhCount?: number;
  pendingLeaveCount?: number;
  pendingCorrectionCount?: number;
}

export const Sidebar: React.FC<Props> = ({ activeRole, activeTab, onSelectTab, currentUser, pendingTaskCount = 0, pendingWfhCount = 0, pendingLeaveCount = 0, pendingCorrectionCount = 0 }) => {
  const employeeItems = [
    ['emp-dashboard', 'Dashboard', LayoutDashboard],
    ['emp-attendance', 'My Attendance', Clock3],
    ['emp-tasks', 'Work & Assignments', BriefcaseBusiness, pendingTaskCount],
    ['emp-leave', 'Leave Requests', CalendarDays, pendingLeaveCount],
    ['emp-wfh', 'WFH Requests', Home, pendingWfhCount],
    ['emp-corrections', 'Corrections', FileClock, pendingCorrectionCount],
    ['emp-holidays', 'Holidays', CalendarDays],
    ['emp-profile', 'Profile', UserRound],
  ] as const;

  const adminItems = [
    ['admin-dashboard', 'Dashboard', LayoutDashboard],
    ['admin-employees', 'Employees / HR', Users],
    ['admin-attendance', 'Attendance', Clock3],
    ['admin-tasks', 'Work & Assignments', BriefcaseBusiness, pendingTaskCount],
    ['admin-requests', 'Requests', FileClock, pendingWfhCount + pendingLeaveCount + pendingCorrectionCount],
    ['admin-payroll', 'Payroll', WalletCards],
    ['admin-holidays', 'Holidays', CalendarDays],
    ['admin-export', 'Reports / Excel', FileSpreadsheet],
    ['admin-settings', 'Settings', Settings2],
  ] as const;

  const items = activeRole === 'admin' ? adminItems : employeeItems;

  return (
    <aside className="hidden lg:flex w-64 bg-slate-950/92 text-slate-300 flex-col shrink-0 sticky top-0 h-screen border-r border-white/10 shadow-[12px_0_50px_rgba(15,23,42,.12)] backdrop-blur-2xl">
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white/95 p-1.5 shadow-[0_10px_30px_rgba(255,255,255,.08)] ring-1 ring-white/10 overflow-hidden"><img src="/ira-hospitality-logo.png" alt="IRA Hospitality" className="w-full h-full object-contain" /></div>
          <div>
            <p className="text-sm font-bold text-white">IRA Hospitality</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{activeRole === 'admin' ? 'Admin Console' : 'Employee Portal'}</p>
          </div>
        </div>
      </div>

      <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
        {items.map(([id, label, Icon, badge]) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onSelectTab(id)}
              className={`w-full flex items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-sm transition-all duration-200 ${active ? 'bg-gradient-to-r from-blue-600/95 to-indigo-600/95 text-white shadow-[0_12px_30px_rgba(37,99,235,.22)]' : 'text-slate-400 hover:text-white hover:bg-white/5 hover:translate-x-0.5'}`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon className="w-4.5 h-4.5 shrink-0" />
                <span className="truncate">{label}</span>
              </span>
              {typeof badge === 'number' && badge > 0 && (
                <span className={`min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center ${active ? 'bg-white text-blue-700' : 'bg-white/10 text-slate-200'}`}>{badge > 99 ? '99+' : badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/10">
        <div className="rounded-2xl bg-white/[.06] border border-white/10 p-3 flex items-center gap-3 shadow-[inset_0_1px_0_rgba(255,255,255,.05)]">
          {currentUser.avatar ? (
            <img src={currentUser.avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center text-sm font-bold ring-1 ring-white/10">{currentUser.name.slice(0,1).toUpperCase()}</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white truncate">{currentUser.name}</p>
            <p className="text-[10px] text-slate-500 truncate">{currentUser.designation ?? (activeRole === 'admin' ? 'Administrator' : currentUser.loginId)}</p>
          </div>
        </div>
      </div>
    </aside>
  );
};
