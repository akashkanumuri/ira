import React, { useMemo, useState } from 'react';
import type { AttendanceRecord } from '../../types/attendance';
import { StatusBadge } from '../common/StatusBadge';
import { Search, Building2, Home, ChevronLeft, ChevronRight } from 'lucide-react';
import { getKolkataDateString } from '../../lib/workingDays';

interface AdminAttendanceTableProps { records: AttendanceRecord[]; }

export const AdminAttendanceTable: React.FC<AdminAttendanceTableProps> = ({ records }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [modeFilter, setModeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState(getKolkataDateString());

  const filteredRecords = useMemo(() => records.filter((record) => {
    const matchesDate = !dateFilter || record.date === dateFilter;
    const haystack = `${record.employeeName} ${record.employeeEmpId} ${record.department}`.toLowerCase();
    const matchesSearch = haystack.includes(searchTerm.toLowerCase());
    const matchesMode = modeFilter === 'all' || record.mode === modeFilter;
    const matchesStatus = statusFilter === 'all' || record.status === statusFilter;
    return matchesDate && matchesSearch && matchesMode && matchesStatus;
  }), [records, searchTerm, modeFilter, statusFilter, dateFilter]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Attendance</h2>
          <p className="text-xs text-slate-500">Real attendance records shared with the employee portal.</p>
        </div>
        <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-2xs focus:ring-2 focus:ring-blue-500 focus:outline-none" />
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search by employee name..." className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700">
          <option value="all">All Modes</option><option value="office">Office</option><option value="wfh">WFH</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700">
          <option value="all">All Statuses</option><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option><option value="leave">Leave</option><option value="holiday">Holiday</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs responsive-data-table admin-attendance-table">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Employee</th>
                <th className="px-6 py-3.5">Mode</th>
                <th className="px-6 py-3.5">Check-in</th>
                <th className="px-6 py-3.5">Break</th>
                <th className="px-6 py-3.5">Check-out</th>
                <th className="px-6 py-3.5">Working Hours</th>
                <th className="px-6 py-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {filteredRecords.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-10 text-center text-slate-400">No real attendance records found for this date.</td></tr>
              ) : filteredRecords.map((record) => (
                <tr key={record.id} className="hover:bg-slate-50/80 transition-colors">
                  <td data-label="Employee" className="px-6 py-3.5"><div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center">{record.employeeName.charAt(0)}</div><div><span className="font-bold text-slate-900 block">{record.employeeName}</span><span className="text-[11px] text-slate-400">{record.employeeEmpId}</span></div></div></td>
                  <td data-label="Mode" className="px-6 py-3.5"><span className="inline-flex items-center gap-1 font-semibold text-slate-900">{record.mode === 'office' ? <Building2 className="w-3.5 h-3.5 text-blue-600" /> : <Home className="w-3.5 h-3.5 text-blue-600" />}{record.mode === 'office' ? 'Office' : 'WFH'}</span></td>
                  <td data-label="Check-in" className="px-6 py-3.5 font-mono font-bold text-slate-900">{record.checkIn || '--:--'}</td>
                  <td data-label="Break" className="px-6 py-3.5 font-mono text-slate-600">{record.breakDuration || '00h 00m'}</td>
                  <td data-label="Check-out" className="px-6 py-3.5 font-mono text-slate-600">{record.checkOut || '--:--'}</td>
                  <td data-label="Working Hours" className="px-6 py-3.5 font-bold text-blue-600 font-mono">{record.workingHours || 'Live'}</td>
                  <td data-label="Status" className="px-6 py-3.5"><StatusBadge status={record.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 font-medium">
          <span>Showing {filteredRecords.length} of {records.length} records</span>
          <div className="flex items-center gap-2"><button disabled className="p-1 rounded border border-slate-200 text-slate-400 cursor-not-allowed"><ChevronLeft className="w-4 h-4" /></button><span className="px-2 font-bold text-slate-900">Page 1</span><button disabled className="p-1 rounded border border-slate-200 text-slate-400 cursor-not-allowed"><ChevronRight className="w-4 h-4" /></button></div>
        </div>
      </div>
    </div>
  );
};
