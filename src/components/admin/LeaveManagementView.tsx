import React, { useState } from 'react';
import { LeaveRequest } from '../../types/attendance';
import { StatusBadge } from '../common/StatusBadge';
import { FileText, Check, X } from 'lucide-react';

interface LeaveManagementViewProps {
  leaveRequests: LeaveRequest[];
  onApproveLeave: (id: string) => void;
  onRejectLeave: (id: string) => void;
}

export const LeaveManagementView: React.FC<LeaveManagementViewProps> = ({
  leaveRequests,
  onApproveLeave,
  onRejectLeave
}) => {
  const [filterDept, setFilterDept] = useState('all');

  const filteredRequests = leaveRequests.filter((r) => {
    if (filterDept === 'all') return true;
    return r.department === filterDept;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Leave Requests</h2>
          <p className="text-xs text-slate-500">Manage employee leave applications and duration quotas.</p>
        </div>

        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs focus:outline-none"
        >
          <option value="all">All Departments</option>
          <option value="Marketing">Marketing</option>
          <option value="Design">Design</option>
          <option value="Engineering">Engineering</option>
          <option value="Product">Product</option>
          <option value="Sales">Sales</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs responsive-data-table admin-leave-table">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Employee</th>
                <th className="px-6 py-3.5">Leave Type</th>
                <th className="px-6 py-3.5">Start Date</th>
                <th className="px-6 py-3.5">End Date</th>
                <th className="px-6 py-3.5">Duration</th>
                <th className="px-6 py-3.5">Reason</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {filteredRequests.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                  <td data-label="Employee" className="px-6 py-3.5">
                    <span className="font-bold text-slate-900">{req.employeeName}</span>
                    <p className="text-[10px] text-slate-400">{req.department}</p>
                  </td>
                  <td data-label="Leave Type" className="px-6 py-3.5 capitalize font-semibold text-purple-700">{req.leaveType} Leave</td>
                  <td data-label="Start Date" className="px-6 py-3.5 font-mono text-slate-900 font-bold">{req.startDate}</td>
                  <td data-label="End Date" className="px-6 py-3.5 font-mono text-slate-900 font-bold">{req.endDate}</td>
                  <td data-label="Duration" className="px-6 py-3.5">{req.days} Day(s)</td>
                  <td data-label="Reason" className="px-6 py-3.5 max-w-xs truncate">{req.reason}</td>
                  <td data-label="Status" className="px-6 py-3.5">
                    <StatusBadge status={req.status} />
                  </td>
                  <td data-label="Actions" className="px-6 py-3.5 text-right">
                    {req.status === 'pending' ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => onApproveLeave(req.id)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold transition-all shadow-2xs flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => onRejectLeave(req.id)}
                          className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-md text-xs font-bold transition-all"
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-400 italic text-[11px]">Completed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
