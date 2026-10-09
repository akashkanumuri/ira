import React, { useState } from 'react';
import { LayoutDashboard, Clock, Home, FileText, FileEdit, MoreHorizontal, Palmtree, FileSpreadsheet, Users } from 'lucide-react';
import type { UserRole } from '../../types/attendance';

type MobileNavItem = { id: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number };

interface MobileNavBarProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  isCheckedIn: boolean;
  pendingRequestsCount?: number;
  role?: UserRole;
}

export const MobileNavBar: React.FC<MobileNavBarProps> = ({ activeTab, onSelectTab, isCheckedIn, pendingRequestsCount = 0, role = 'employee' }) => {
  const [moreOpen, setMoreOpen] = useState(false);

  const employeePrimary: MobileNavItem[] = [
    { id: 'emp-dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'emp-attendance', label: 'Attendance', icon: Clock },
    { id: 'emp-wfh', label: 'WFH', icon: Home, badge: pendingRequestsCount },
    { id: 'emp-leave', label: 'Leave', icon: FileText },
  ];

  const adminPrimary: MobileNavItem[] = [
    { id: 'admin-dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'admin-attendance', label: 'Attendance', icon: Clock },
    { id: 'admin-employees', label: 'Employees', icon: Users },
    { id: 'admin-wfh', label: 'WFH', icon: Home },
  ];

  const moreItems: MobileNavItem[] = role === 'admin'
    ? [
        { id: 'admin-leave', label: 'Leave Requests', icon: FileText },
        { id: 'admin-export', label: 'Excel Export', icon: FileSpreadsheet },
        { id: 'admin-holidays', label: 'Holidays', icon: Palmtree },
      ]
    : [
        { id: 'emp-holidays', label: 'Holidays', icon: Palmtree },
      ];

  const primary = role === 'admin' ? adminPrimary : employeePrimary;

  const handleSelect = (id: string) => {
    onSelectTab(id);
    setMoreOpen(false);
  };

  return (
    <>
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-50" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-[1px]" />
          <div className="absolute left-3 right-3 bottom-[72px] rounded-2xl bg-white border border-slate-200 shadow-xl p-2" onClick={(event) => event.stopPropagation()}>
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">More</div>
            <div className="grid grid-cols-2 gap-2">
              {moreItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left text-xs font-semibold transition ${activeTab === item.id ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-lg px-1.5 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-5 items-center">
          {primary.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => handleSelect(tab.id)} className={`flex flex-col items-center justify-center min-h-12 px-1 rounded-xl transition-all relative ${isActive ? 'text-blue-600 font-semibold' : 'text-slate-500'}`}>
                <div className="relative">
                  <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.2]' : 'stroke-[1.8]'}`} />
                  {role === 'employee' && tab.id === 'emp-dashboard' && isCheckedIn && <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white animate-pulse" />}
                  {'badge' in tab && tab.badge && tab.badge > 0 ? <span className="absolute -top-1 -right-2 text-[9px] font-bold px-1 rounded-full bg-amber-500 text-white">{tab.badge}</span> : null}
                </div>
                <span className="text-[10px] mt-0.5 tracking-tight">{tab.label}</span>
              </button>
            );
          })}

          <button onClick={() => setMoreOpen((value) => !value)} className={`flex flex-col items-center justify-center min-h-12 px-1 rounded-xl transition-all ${moreOpen || (!primary.some((tab) => tab.id === activeTab)) ? 'text-blue-600 font-semibold' : 'text-slate-500'}`}>
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] mt-0.5">More</span>
          </button>
        </div>
      </nav>
    </>
  );
};
