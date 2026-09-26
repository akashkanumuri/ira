import React, { useEffect, useState } from 'react';
import type { UserRole, Employee } from '../../types/attendance';
import { BrandLogo } from './BrandLogo';
import { StatusPill } from './StatusPill';
import { LogOut, Clock } from 'lucide-react';

interface HeaderProps {
  currentUser: Employee;
  activeRole: UserRole;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentUser, activeRole, onLogout }) => {
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      setCurrentDate(now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <header className="bg-white border-b border-slate-200/90 px-4 sm:px-6 py-2.5 sticky top-0 z-30 flex items-center justify-between shadow-2xs">
      <div className="flex items-center gap-3.5 min-w-0">
        <BrandLogo size="sm" showSubtitle={false} />
        <div className="h-4 w-px bg-slate-200 hidden sm:block" />
        <div className="flex items-center gap-2 min-w-0">
          <StatusPill status={activeRole === 'admin' ? 'active' : 'wfh'} label={activeRole === 'admin' ? 'Admin Portal' : 'Employee Portal'} size="xs" />
          <span className="text-[11px] text-slate-500 hidden md:inline font-mono whitespace-nowrap">{currentDate}</span>
        </div>
      </div>

      <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700">
        <Clock className="w-3.5 h-3.5 text-blue-600" />
        <span>IST {currentTime || '--:--:--'}</span>
      </div>

      <div className="flex items-center gap-2.5 sm:gap-3">
        <div className="flex items-center gap-2.5 pl-2 sm:pl-3 border-l border-slate-200">
          {currentUser.avatar ? (
            <img src={currentUser.avatar} alt={currentUser.name} className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200/90" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold ring-1 ring-slate-200/90">
              {(currentUser.name || 'U').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="hidden md:block text-left text-xs">
            <p className="font-semibold text-slate-900 leading-tight truncate max-w-[130px]">{currentUser.name}</p>
          </div>
          <button onClick={onLogout} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors" title="Sign out">
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Sign Out</span>
          </button>
        </div>
      </div>
    </header>
  );
};
