import React, { useEffect, useState } from 'react';
import type { AttendanceMode, AttendanceRecord, AttendanceState } from '../../types/attendance';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Coffee,
  Home,
  Loader2,
  LogOut,
  Play,
} from 'lucide-react';
import { formatLiveTimer, formatWorkingTime } from '../../lib/attendance';
import { formatKolkataTime } from '../../lib/workingDays';

interface TodayAttendanceCardProps {
  todayRecord: AttendanceRecord | null;
  onCheckIn: (mode: AttendanceMode) => Promise<{ success: boolean; error?: string; attendanceRecord?: AttendanceRecord }>;
  onStartBreak: () => Promise<{ success: boolean; error?: string; attendanceRecord?: AttendanceRecord }>;
  onResumeWork: () => Promise<{ success: boolean; error?: string; attendanceRecord?: AttendanceRecord }>;
  onCheckOut: () => Promise<{ success: boolean; error?: string; attendanceRecord?: AttendanceRecord }>;
}

export const TodayAttendanceCard: React.FC<TodayAttendanceCardProps> = ({
  todayRecord,
  onCheckIn,
  onStartBreak,
  onResumeWork,
  onCheckOut,
}) => {
  const currentState: AttendanceState =
    todayRecord?.attendanceState ??
    (todayRecord?.checkOut ? 'completed' : todayRecord?.checkIn ? 'working' : 'not_checked_in');

  // The employee must explicitly choose Office or WFH before check-in.
  const [selectedMode, setSelectedMode] = useState<AttendanceMode | null>(
    todayRecord?.mode ?? null
  );
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [liveWorkingSeconds, setLiveWorkingSeconds] = useState(0);
  const [liveBreakSeconds, setLiveBreakSeconds] = useState(0);

  useEffect(() => {
    if (todayRecord?.mode) setSelectedMode(todayRecord.mode);
  }, [todayRecord?.mode]);

  useEffect(() => {
    if (!todayRecord?.checkInIso || currentState === 'not_checked_in') {
      setLiveWorkingSeconds(0);
      setLiveBreakSeconds(0);
      return;
    }

    if (currentState === 'completed') {
      setLiveWorkingSeconds(todayRecord.workingSeconds ?? 0);
      setLiveBreakSeconds(todayRecord.breakSeconds ?? 0);
      return;
    }

    const tick = () => {
      const nowMs = Date.now();
      const checkInMs = new Date(todayRecord.checkInIso as string).getTime();
      const accumulatedBreak = todayRecord.breakSeconds ?? 0;

      if (currentState === 'on_break' && todayRecord.activeBreakStartIso) {
        const breakStartMs = new Date(todayRecord.activeBreakStartIso).getTime();
        const currentBreak = Math.max(0, Math.floor((nowMs - breakStartMs) / 1000));
        const workingBeforeBreak = Math.max(
          0,
          Math.floor((breakStartMs - checkInMs) / 1000) - accumulatedBreak
        );
        setLiveBreakSeconds(currentBreak);
        setLiveWorkingSeconds(workingBeforeBreak);
        return;
      }

      const elapsed = Math.max(0, Math.floor((nowMs - checkInMs) / 1000));
      setLiveBreakSeconds(accumulatedBreak);
      setLiveWorkingSeconds(Math.max(0, elapsed - accumulatedBreak));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [todayRecord?.checkInIso, todayRecord?.breakSeconds, todayRecord?.activeBreakStartIso, currentState]);

  const runAction = async (
    action: () => Promise<{ success: boolean; error?: string; attendanceRecord?: AttendanceRecord }>,
    fallbackMessage: string
  ) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await action();
      if (!result.success) setActionError(result.error ?? fallbackMessage);
    } catch (error: any) {
      setActionError(error?.message ?? fallbackMessage);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckIn = () => {
    if (!selectedMode) {
      setActionError('Please select Office or WFH before checking in.');
      return;
    }
    void runAction(() => onCheckIn(selectedMode), 'Check-in failed. Please try again.');
  };

  const handleCheckOut = () => {
    if (currentState === 'on_break') {
      const confirmed = window.confirm('You are currently on break. Check out and close this break now?');
      if (!confirmed) return;
    }
    void runAction(onCheckOut, 'Check-out failed. Please try again.');
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-600" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Today's Attendance Action
          </span>
        </div>
        {currentState !== 'not_checked_in' && todayRecord?.mode && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700">
            {todayRecord.mode === 'office' ? 'Office' : 'WFH'}
          </span>
        )}
      </div>

      {actionError && (
        <div className="mx-5 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {currentState === 'not_checked_in' && (
        <div className="p-6 sm:p-8 space-y-6">
          <div>
            <div className="flex items-center gap-2 text-emerald-700">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
              <span className="text-xs font-bold uppercase tracking-wider">Ready to check in</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
              START YOUR DAY
            </h2>
            <p className="text-sm text-slate-500 mt-2">
              Choose where you are working today, then check in.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelectedMode('office')}
              className={`p-4 rounded-xl border text-left transition-all ${
                selectedMode === 'office'
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/10'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </span>
                <div>
                  <div className="font-bold text-slate-900">Office</div>
                  <div className="text-xs text-slate-500">Working from the office</div>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedMode('wfh')}
              className={`p-4 rounded-xl border text-left transition-all ${
                selectedMode === 'wfh'
                  ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-500/10'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center">
                  <Home className="w-5 h-5 text-sky-600" />
                </span>
                <div>
                  <div className="font-bold text-slate-900">WFH</div>
                  <div className="text-xs text-slate-500">Working from home</div>
                </div>
              </div>
            </button>
          </div>

          <button
            type="button"
            onClick={handleCheckIn}
            disabled={actionLoading || !selectedMode}
            className="w-full py-4 sm:py-5 px-6 rounded-2xl font-bold text-base sm:text-lg transition-all shadow-md flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
          >
            {actionLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Clock className="w-6 h-6" />}
            <span>{actionLoading ? 'CHECKING IN…' : 'CHECK IN'}</span>
          </button>
        </div>
      )}

      {currentState === 'working' && (
        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2 text-emerald-700">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-wider">Active shift</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
                WORKING
              </h2>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="text-[10px] text-slate-500 uppercase font-bold">Checked in at</div>
              <div className="font-bold font-mono text-slate-900 text-sm mt-0.5">{todayRecord?.checkIn ?? '--:--'}</div>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-emerald-50/60 border border-emerald-200/90 text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-800">Live working time</div>
            <div className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-emerald-950 mt-2">
              {formatLiveTimer(liveWorkingSeconds)}
            </div>
            <p className="text-xs text-emerald-700 mt-1">Break time is deducted automatically.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Total break</span>
                <Coffee className="w-4 h-4 text-amber-600" />
              </div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-2">
                {formatWorkingTime(liveBreakSeconds)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void runAction(onStartBreak, 'Unable to start break.')}
                disabled={actionLoading}
                className="py-4 px-4 rounded-xl font-bold text-sm bg-amber-500 hover:bg-amber-600 text-white disabled:bg-slate-300 transition-colors flex items-center justify-center gap-2"
              >
                <Coffee className="w-5 h-5" />
                START BREAK
              </button>
              <button
                type="button"
                onClick={handleCheckOut}
                disabled={actionLoading}
                className="py-4 px-4 rounded-xl font-bold text-sm bg-slate-900 hover:bg-slate-800 text-white disabled:bg-slate-300 transition-colors flex items-center justify-center gap-2"
              >
                <LogOut className="w-5 h-5" />
                CHECK OUT
              </button>
            </div>
          </div>
        </div>
      )}

      {currentState === 'on_break' && (
        <div className="p-6 sm:p-8 space-y-6">
          <div>
            <div className="flex items-center gap-2 text-amber-700">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider">Break in progress</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">ON BREAK</h2>
          </div>

          <div className="p-6 rounded-2xl bg-amber-50/70 border border-amber-200 text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-800">Current break</div>
            <div className="text-4xl sm:text-5xl font-black font-mono text-amber-950 mt-2">
              {formatLiveTimer(liveBreakSeconds)}
            </div>
            <p className="text-xs text-amber-800 mt-2">
              Started {todayRecord?.activeBreakStartIso ? formatKolkataTime(new Date(todayRecord.activeBreakStartIso)) : '--:--'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void runAction(onResumeWork, 'Unable to resume work.')}
            disabled={actionLoading}
            className="w-full py-4 sm:py-5 px-6 rounded-2xl font-bold text-base sm:text-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-slate-300 transition-colors flex items-center justify-center gap-3"
          >
            {actionLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Play className="w-6 h-6 fill-current" />}
            <span>{actionLoading ? 'RESUMING…' : 'RESUME WORK'}</span>
          </button>
        </div>
      )}

      {currentState === 'completed' && (
        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between gap-4 pb-5 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="w-5 h-5" />
                <span className="text-xs font-bold uppercase tracking-wider">Shift concluded</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">ATTENDANCE COMPLETE</h2>
            </div>
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
              Present
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Summary label="Check-in" value={todayRecord?.checkIn ?? '--:--'} />
            <Summary label="Break" value={formatWorkingTime(todayRecord?.breakSeconds ?? 0)} tone="amber" />
            <Summary label="Check-out" value={todayRecord?.checkOut ?? '--:--'} />
            <Summary label="Final working" value={formatWorkingTime(todayRecord?.workingSeconds ?? 0)} tone="green" />
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>This attendance record is final for today. The working timer has stopped.</span>
          </div>
        </div>
      )}
    </div>
  );
};

function Summary({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' | 'green' }) {
  const toneClass = tone === 'amber'
    ? 'bg-amber-50 border-amber-200'
    : tone === 'green'
    ? 'bg-emerald-50 border-emerald-200'
    : 'bg-slate-50 border-slate-200';
  return (
    <div className={`p-4 rounded-xl border ${toneClass}`}>
      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{label}</div>
      <div className="text-base font-bold font-mono text-slate-900 mt-1">{value}</div>
    </div>
  );
}
