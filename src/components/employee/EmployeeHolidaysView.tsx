import React from 'react';
import { CalendarDays, Palmtree } from 'lucide-react';
import type { Holiday } from '../../types/attendance';

interface EmployeeHolidaysViewProps {
  holidays: Holiday[];
}

export const EmployeeHolidaysView: React.FC<EmployeeHolidaysViewProps> = ({ holidays }) => {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Holidays</h2>
        <p className="text-xs text-slate-500 mt-1">Company holidays published by your administrator.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        {holidays.length === 0 ? (
          <div className="p-10 text-center">
            <Palmtree className="w-6 h-6 mx-auto text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">No holidays have been published.</p>
            <p className="mt-1 text-xs text-slate-400">Your administrator's published holidays will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {holidays.map((holiday) => (
              <div key={holiday.id} className="p-4 sm:p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <CalendarDays className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{holiday.name}</p>
                    {holiday.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{holiday.description}</p>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-slate-900">{new Date(`${holiday.date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                  <p className="text-[11px] text-slate-400">{holiday.dayOfWeek}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
