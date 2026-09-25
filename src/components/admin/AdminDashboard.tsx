import React from 'react';
import type { AttendanceRecord, Employee, WfhRequest, LeaveRequest, CorrectionRequest } from '../../types/attendance';
import { Users, UserCheck, Home, Calendar, AlertCircle, Clock, ArrowRight } from 'lucide-react';
import { getKolkataDateString, classifyDay } from '../../lib/workingDays';

interface AdminDashboardProps {
  todayAttendance: AttendanceRecord[];
  employees: Employee[];
  wfhRequests: WfhRequest[];
  leaveRequests: LeaveRequest[];
  correctionRequests: CorrectionRequest[];
  holidays: { id: string; name: string; date: string; description: string; mandatory: boolean }[];
  onSelectTab: (tab: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ todayAttendance, employees, wfhRequests, leaveRequests, correctionRequests, holidays, onSelectTab }) => {
  const today = getKolkataDateString();
  const classification = classifyDay(today, holidays);
  const activeEmployees = employees.filter((employee) => employee.status !== 'inactive');
  const presentToday = todayAttendance.filter((record) => Boolean(record.checkIn)).length;
  const checkedOutToday = todayAttendance.filter((record) => Boolean(record.checkOut)).length;
  const wfhToday = todayAttendance.filter((record) => record.mode === 'wfh' && record.checkIn).length;
  const lateToday = todayAttendance.filter((record) => record.status === 'late').length;
  const pendingWfh = wfhRequests.filter((request) => request.status === 'pending');
  const pendingCorrections = correctionRequests.filter((request) => request.status === 'pending');

  const approvedLeaveToday = leaveRequests.filter((request) => request.status === 'approved' && request.startDate <= today && request.endDate >= today).length;
  const workingDay = classification.isWorkingDay;
  const absentToday = workingDay ? Math.max(0, activeEmployees.length - presentToday - approvedLeaveToday) : 0;
  const officeToday = Math.max(0, presentToday - wfhToday);
  const presencePercent = activeEmployees.length ? Math.round((presentToday / activeEmployees.length) * 100) : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Attendance Overview</h2>
          <p className="text-xs text-slate-500">Live attendance for {new Date(`${today}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button onClick={() => onSelectTab('admin-attendance')} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors">
          View Live Attendance
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Employees" value={activeEmployees.length} icon={<Users className="w-4 h-4" />} />
        <Kpi label="Present Today" value={presentToday} icon={<UserCheck className="w-4 h-4 text-emerald-600" />} />
        <Kpi label="WFH Today" value={wfhToday} icon={<Home className="w-4 h-4 text-blue-600" />} />
        <Kpi label="Checked Out" value={checkedOutToday} icon={<Clock className="w-4 h-4 text-slate-500" />} />
        <Kpi label="Absent" value={absentToday} icon={<AlertCircle className="w-4 h-4 text-rose-600" />} />
        <Kpi label="Late" value={lateToday} icon={<Clock className="w-4 h-4 text-amber-600" />} />
      </div>

      {(pendingWfh.length > 0 || pendingCorrections.length > 0) && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h4 className="font-bold text-slate-900 text-xs">Pending approvals</h4>
            <p className="text-xs text-slate-600 mt-0.5">{pendingWfh.length} WFH request(s) and {pendingCorrections.length} correction(s) need review.</p>
          </div>
          <button onClick={() => onSelectTab(pendingWfh.length ? 'admin-wfh' : 'admin-corrections')} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1">
            Review <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Today's attendance</h3>
              <p className="text-xs text-slate-500">Live records from the shared attendance database.</p>
            </div>
            <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">{presencePercent}% present</span>
          </div>

          <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden flex">
            <div className="h-full bg-emerald-500" style={{ width: `${activeEmployees.length ? (officeToday / activeEmployees.length) * 100 : 0}%` }} />
            <div className="h-full bg-blue-500" style={{ width: `${activeEmployees.length ? (wfhToday / activeEmployees.length) * 100 : 0}%` }} />
          </div>
          <div className="flex flex-wrap gap-4 text-[11px] font-medium text-slate-600">
            <span><b className="text-slate-900">{officeToday}</b> Office</span>
            <span><b className="text-slate-900">{wfhToday}</b> WFH</span>
            <span><b className="text-slate-900">{checkedOutToday}</b> Checked out</span>
            <span><b className="text-slate-900">{activeEmployees.length}</b> Active employees</span>
          </div>

          {todayAttendance.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
              No attendance has been recorded today.
            </div>
          ) : (
            <div className="space-y-2">
              {todayAttendance.map((record) => (
                <div key={record.id} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{record.employeeName}</p>
                    <p className="text-[11px] text-slate-500">{record.mode === 'wfh' ? 'WFH' : 'Office'} · {record.checkIn ?? '--:--'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold font-mono text-slate-900">{record.checkOut ?? 'Working'}</p>
                    <p className="text-[11px] text-slate-500">{record.workingHours ?? 'Live'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Calendar className="w-4 h-4 text-blue-600" />
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Today</h3>
              <p className="text-xs text-slate-500">{classification.label}</p>
            </div>
          </div>
          <div className="mt-5 space-y-3 text-xs">
            <Row label="Working day" value={workingDay ? 'Yes' : 'No'} />
            <Row label="Present" value={String(presentToday)} />
            <Row label="Office" value={String(officeToday)} />
            <Row label="WFH" value={String(wfhToday)} />
            <Row label="Checked out" value={String(checkedOutToday)} />
            <Row label="Absent" value={String(absentToday)} />
          </div>
        </div>
      </div>
    </div>
  );
};

function Kpi({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-2">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-xs font-semibold">{label}</span>
        {icon}
      </div>
      <span className="text-2xl font-bold text-slate-900">{value}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100"><span className="text-slate-500">{label}</span><b className="text-slate-900">{value}</b></div>;
}
