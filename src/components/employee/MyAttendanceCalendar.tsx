import React, { useState } from 'react';
import type { AttendanceRecord, AuthSession, Employee, Holiday } from '../../types/attendance';
import { StatusPill } from '../common/StatusPill';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Building2,
  Home,
  X,
  Info,
  History,
} from 'lucide-react';
import { classifyDay, getMonthlyWorkingDaysCount, getKolkataDateString } from '../../lib/workingDays';
import { formatWorkingTime } from '../../lib/attendance';

interface MyAttendanceCalendarProps {
  currentUser: Employee;
  attendanceHistory: AttendanceRecord[];
  holidays: Holiday[];
  loginSessions: AuthSession[];
}

export const MyAttendanceCalendar: React.FC<MyAttendanceCalendarProps> = ({
  currentUser,
  attendanceHistory,
  holidays,
  loginSessions,
}) => {
  const now = new Date();
  const today = getKolkataDateString(now);
  const [currentYear, setCurrentYear] = useState(Number(today.slice(0, 4)));
  const [currentMonth, setCurrentMonth] = useState(Number(today.slice(5, 7)));
  const [view, setView] = useState<'attendance' | 'logins'>('attendance');
  const [selectedRecord, setSelectedRecord] = useState<{
    dateStr: string;
    dayNum: number;
    record?: AttendanceRecord;
    classification: ReturnType<typeof classifyDay>;
  } | null>(null);

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear((year) => year - 1);
    } else setCurrentMonth((month) => month - 1);
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear((year) => year + 1);
    } else setCurrentMonth((month) => month + 1);
  };

  const monthName = new Date(currentYear, currentMonth - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const monthlyMetrics = getMonthlyWorkingDaysCount(currentYear, currentMonth, holidays);
  const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
  const startDayOffset = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

  const calendarDays = Array.from({ length: daysInMonth }, (_, i) => {
    const dayNum = i + 1;
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const classification = classifyDay(dateStr, holidays);
    const record = attendanceHistory.find((r) => r.date === dateStr);
    return { dayNum, dateStr, classification, record };
  });

  const weekHeaders = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600" />
              <h2 className="text-xl font-bold text-slate-900">My Attendance</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">Your attendance history and previous application logins.</p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200 w-fit">
            <button
              type="button"
              onClick={() => setView('attendance')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${view === 'attendance' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Attendance
            </button>
            <button
              type="button"
              onClick={() => setView('logins')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${view === 'logins' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Previous Logins
            </button>
          </div>
        </div>
      </div>

      {view === 'logins' ? (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
          <div className="p-5 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">Previous Logins</h3>
            <p className="text-xs text-slate-500 mt-0.5">Real application sessions recorded for {currentUser.name}.</p>
          </div>
          {loginSessions.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">
              <History className="w-7 h-7 mx-auto text-slate-300 mb-2" />
              <p className="font-semibold text-slate-700">No previous login history available.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3.5 font-semibold">Date</th>
                    <th className="px-5 py-3.5 font-semibold">Login</th>
                    <th className="px-5 py-3.5 font-semibold">Logout</th>
                    <th className="px-5 py-3.5 font-semibold">Session</th>
                    <th className="px-5 py-3.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loginSessions.map((session) => {
                    const date = new Date(session.loginTime);
                    return (
                      <tr key={session.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-4 font-semibold text-slate-800">
                          {date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-5 py-4 font-mono text-slate-700">
                          {date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })}
                        </td>
                        <td className="px-5 py-4 font-mono text-slate-700">
                          {session.logoutTime
                            ? new Date(session.logoutTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
                            : 'Active'}
                        </td>
                        <td className="px-5 py-4 font-mono text-slate-700">{session.sessionDuration ?? 'Active'}</td>
                        <td className="px-5 py-4">
                          <StatusPill status={session.sessionStatus === 'active' ? 'active' : session.sessionStatus === 'expired' ? 'warning' : 'inactive'} label={session.sessionStatus} size="xs" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Attendance Calendar</h3>
              <p className="text-xs text-slate-500 mt-0.5">Monday-Saturday working days, Sunday weekly off, database holidays override.</p>
            </div>
            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl p-1 text-xs font-semibold">
              <button onClick={handlePrevMonth} className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Previous Month"><ChevronLeft className="w-4 h-4" /></button>
              <span className="px-3 min-w-[130px] text-center font-bold text-slate-900">{monthName}</span>
              <button onClick={handleNextMonth} className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Next Month"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Metric label="Total Days" value={`${monthlyMetrics.totalDays} Days`} />
            <Metric label="Working Days" value={`${monthlyMetrics.workingDays} Days`} tone="green" />
            <Metric label="Weekly Offs" value={`${monthlyMetrics.sundays} Days`} tone="purple" />
            <Metric label="Holidays" value={`${monthlyMetrics.holidayCount} Days`} tone="indigo" />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 sm:p-6">
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-center pb-3 border-b border-slate-100">
              {weekHeaders.map((day, idx) => (
                <div key={day} className={`text-[11px] font-bold tracking-wider ${idx === 6 ? 'text-purple-600' : idx === 5 ? 'text-emerald-700' : 'text-slate-500'}`}>
                  {day}
                  {idx === 5 && <span className="block text-[9px] font-medium text-slate-400">Work</span>}
                  {idx === 6 && <span className="block text-[9px] font-medium text-purple-400">Off</span>}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5 sm:gap-2 pt-3">
              {Array.from({ length: startDayOffset }).map((_, i) => <div key={`empty-${i}`} className="h-20 sm:h-24 rounded-xl bg-slate-50/50" />)}
              {calendarDays.map((d) => {
                const isSunday = d.classification.type === 'sunday_off';
                const isHoliday = d.classification.type === 'holiday';
                const isSaturday = d.classification.type === 'saturday_working';
                const isToday = d.dateStr === today;
                let badgeText = '';
                let badgeBg = '';
                if (d.record?.status === 'present' || d.record?.status === 'wfh') {
                  badgeText = d.record.mode === 'wfh' ? 'WFH' : 'Present';
                  badgeBg = d.record.mode === 'wfh' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800';
                } else if (d.record?.status === 'late') {
                  badgeText = 'Late';
                  badgeBg = 'bg-amber-100 text-amber-800';
                } else if (d.record?.status === 'leave') {
                  badgeText = 'Leave';
                  badgeBg = 'bg-purple-100 text-purple-800';
                } else if (isSunday) {
                  badgeText = 'OFF'; badgeBg = 'bg-purple-50 text-purple-700 border border-purple-200';
                } else if (isHoliday) {
                  badgeText = 'Holiday'; badgeBg = 'bg-indigo-50 text-indigo-700 border border-indigo-200';
                } else if (isSaturday) {
                  badgeText = 'Working'; badgeBg = 'bg-slate-100 text-slate-600';
                }

                return (
                  <button key={d.dateStr} onClick={() => setSelectedRecord(d)} className={`h-20 sm:h-24 p-2 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer ${isToday ? 'border-blue-500 bg-blue-50/20 ring-2 ring-blue-500/20' : isSunday ? 'border-purple-100 bg-purple-50/30 hover:border-purple-300' : isHoliday ? 'border-indigo-100 bg-indigo-50/30 hover:border-indigo-300' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold font-mono ${isToday ? 'text-blue-600' : isSunday ? 'text-purple-600' : isHoliday ? 'text-indigo-600' : 'text-slate-800'}`}>{d.dayNum}</span>
                      {isToday && <span className="text-[9px] font-bold px-1 rounded bg-blue-600 text-white">Today</span>}
                    </div>
                    <div className="truncate">
                      {badgeText && <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${badgeBg} truncate max-w-full`}>{badgeText}</span>}
                      {d.record?.workingHours && <span className="block text-[10px] font-mono text-slate-500 mt-0.5">{d.record.workingHours}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">Attendance Breakdown</h3>
                <p className="text-xs text-slate-500 mt-0.5">{new Date(`${selectedRecord.dateStr}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
              <button onClick={() => setSelectedRecord(null)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between">
              <span className="text-slate-500">Day:</span>
              <span className="font-bold text-slate-800">{selectedRecord.classification.label}</span>
            </div>

            {selectedRecord.record ? (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <InfoCard label="Mode" value={selectedRecord.record.mode === 'office' ? 'Office' : 'Work From Home'} icon={selectedRecord.record.mode === 'office' ? <Building2 className="w-4 h-4" /> : <Home className="w-4 h-4" />} />
                  <InfoCard label="Status" value={selectedRecord.record.status} />
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono">
                  <InfoCard label="Check-in" value={selectedRecord.record.checkIn || '--:--'} />
                  <InfoCard label="Check-out" value={selectedRecord.record.checkOut || '--:--'} />
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono">
                  <InfoCard label="Break" value={selectedRecord.record.breakDuration || formatWorkingTime(selectedRecord.record.breakSeconds || 0)} tone="amber" />
                  <InfoCard label="Actual Working" value={selectedRecord.record.workingHours || formatWorkingTime(selectedRecord.record.workingSeconds || 0)} tone="green" />
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500 space-y-1">
                <Info className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">No attendance record</p>
                <p>{selectedRecord.classification.type === 'sunday_off' ? 'Weekly Off (Sunday).' : selectedRecord.classification.type === 'holiday' ? `${selectedRecord.classification.holidayName ?? 'Holiday'} — Company Holiday.` : 'No check-in recorded for this working day.'}</p>
              </div>
            )}

            <div className="pt-2 text-right">
              <button onClick={() => setSelectedRecord(null)} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'green' | 'purple' | 'indigo' }) {
  const toneClass = tone === 'green' ? 'text-emerald-600' : tone === 'purple' ? 'text-purple-600' : tone === 'indigo' ? 'text-indigo-600' : 'text-slate-900';
  return <div className="p-3.5 bg-white rounded-xl border border-slate-200/90 shadow-2xs"><span className="text-slate-500 font-semibold block text-[11px]">{label}</span><span className={`text-xl font-bold font-mono mt-0.5 block ${toneClass}`}>{value}</span></div>;
}

function InfoCard({ label, value, icon, tone = 'default' }: { label: string; value: string; icon?: React.ReactNode; tone?: 'default' | 'amber' | 'green' }) {
  const classes = tone === 'amber' ? 'bg-amber-50 border-amber-200' : tone === 'green' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-100';
  return <div className={`p-3 rounded-xl border ${classes}`}><span className="text-slate-500 block text-[11px]">{label}</span><span className="font-bold text-slate-900 mt-0.5 block capitalize flex items-center gap-1.5">{icon}{value}</span></div>;
}
