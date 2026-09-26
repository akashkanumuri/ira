import React from 'react';
import type { Employee, AttendanceRecord, AttendanceMode } from '../../types/attendance';
import { TodayAttendanceCard } from './TodayAttendanceCard';
import { StatusPill } from '../common/StatusPill';
import { CalendarCheck, Clock } from 'lucide-react';
import { getKolkataDateString } from '../../lib/workingDays';
import { formatWorkingTime } from '../../lib/attendance';

interface EmployeeDashboardProps {
  currentUser: Employee;
  todayRecord: AttendanceRecord | null;
  onCheckIn: (mode: AttendanceMode) => Promise<{ success: boolean; error?: string; attendanceRecord?: AttendanceRecord }>;
  onStartBreak: () => Promise<{ success: boolean; error?: string; attendanceRecord?: AttendanceRecord }>;
  onResumeWork: () => Promise<{ success: boolean; error?: string; attendanceRecord?: AttendanceRecord }>;
  onCheckOut: () => Promise<{ success: boolean; error?: string; attendanceRecord?: AttendanceRecord }>;
}

export const EmployeeDashboard: React.FC<EmployeeDashboardProps> = ({
  currentUser,
  todayRecord,
  onCheckIn,
  onStartBreak,
  onResumeWork,
  onCheckOut,
}) => {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const todayDateFormatted = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const currentState =
    todayRecord?.attendanceState ??
    (todayRecord?.checkOut ? 'completed' : todayRecord?.checkIn ? 'working' : 'not_checked_in');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              {greeting}, {currentUser.name.split(' ')[0]}
            </h1>
            <span className="text-xl">👋</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">{todayDateFormatted}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill
            status={currentState === 'completed' ? 'active' : currentState === 'working' ? 'active' : currentState === 'on_break' ? 'pending' : 'pending'}
            label={
              currentState === 'completed'
                ? 'Attendance Complete'
                : currentState === 'working'
                ? 'Working'
                : currentState === 'on_break'
                ? 'On Break'
                : 'Ready to Check In'
            }
            size="xs"
          />
        </div>
      </div>

      <section aria-label="Today's Attendance">
        <TodayAttendanceCard
          todayRecord={todayRecord}
          onCheckIn={onCheckIn}
          onStartBreak={onStartBreak}
          onResumeWork={onResumeWork}
          onCheckOut={onCheckOut}
        />
      </section>

      <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Today's Attendance Summary</h3>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">Live</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <Metric label="Check-in" value={todayRecord?.checkIn || '--:--'} />
          <Metric label="Break" value={formatWorkingTime(todayRecord?.breakSeconds || 0)} tone="amber" />
          <Metric label="Check-out" value={todayRecord?.checkOut || '--:--'} />
          <Metric
            label="Working"
            value={todayRecord?.workingHours || formatWorkingTime(todayRecord?.workingSeconds || 0)}
            tone="green"
          />
        </div>
      </div>

      {todayRecord && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-blue-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">Today's Activity</h3>
              <p className="text-[11px] text-slate-500">Actual attendance actions recorded for {getKolkataDateString()}.</p>
            </div>
          </div>

          <div className="space-y-3 pl-2 border-l-2 border-slate-200 text-xs">
            {todayRecord.checkIn && (
              <TimelineItem title="Attendance Check-in" time={todayRecord.checkIn} tone="emerald" />
            )}
            {(todayRecord.breaks || []).map((b, idx) => (
              <React.Fragment key={b.id}>
                <TimelineItem
                  title={`Break ${idx + 1} Started`}
                  time={new Date(b.breakStart).toLocaleTimeString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })}
                  tone="amber"
                />
                {b.breakEnd && (
                  <TimelineItem
                    title="Work Resumed"
                    time={new Date(b.breakEnd).toLocaleTimeString('en-IN', {
                      timeZone: 'Asia/Kolkata',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                    tone="emerald"
                    description={`Break duration: ${Math.round((b.durationSeconds || 0) / 60)} min`}
                  />
                )}
              </React.Fragment>
            ))}
            {todayRecord.checkOut && (
              <TimelineItem
                title="Attendance Check-out"
                time={todayRecord.checkOut}
                tone="dark"
                description={`Final working time: ${todayRecord.workingHours || formatWorkingTime(todayRecord.workingSeconds || 0)}`}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' | 'green' }) {
  const toneClass = tone === 'amber' ? 'bg-amber-50 border-amber-200' : tone === 'green' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200';
  return (
    <div className={`p-3 rounded-xl border ${toneClass}`}>
      <span className="text-[10px] text-slate-500 font-bold uppercase block">{label}</span>
      <span className="text-sm font-bold font-mono text-slate-900 mt-1 block">{value}</span>
    </div>
  );
}

function TimelineItem({ title, time, tone, description }: { title: string; time: string; tone: 'emerald' | 'amber' | 'dark'; description?: string }) {
  const dot = tone === 'emerald' ? 'bg-emerald-600' : tone === 'amber' ? 'bg-amber-500' : 'bg-slate-900';
  return (
    <div className="relative pl-5">
      <span className={`absolute -left-[11px] top-1 w-3 h-3 rounded-full ${dot} border-2 border-white`} />
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-bold text-slate-800">{title}</span>
        <span className="font-mono text-slate-500 text-[11px]">{time}</span>
      </div>
      {description && <p className="text-slate-500 text-[11px]">{description}</p>}
    </div>
  );
}
