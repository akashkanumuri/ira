import React, { useState } from 'react';
import { LeaveRequest, Employee } from '../../types/attendance';
import { StatusBadge } from '../common/StatusBadge';
import { FileText, Calendar, Send, CheckCircle2 } from 'lucide-react';
import { getKolkataDateString } from '../../lib/workingDays';

interface LeaveRequestViewProps {
  currentUser: Employee;
  leaveRequests: LeaveRequest[];
  onSubmitLeaveRequest: (newReq: Omit<LeaveRequest, 'id' | 'requestedOn' | 'status'>) => Promise<void>;
}

export const LeaveRequestView: React.FC<LeaveRequestViewProps> = ({
  currentUser,
  leaveRequests,
  onSubmitLeaveRequest
}) => {
  const [leaveType, setLeaveType] = useState<'casual' | 'sick' | 'earned' | 'unpaid'>('casual');
  const today = getKolkataDateString();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState('');
  const [submittedToast, setSubmittedToast] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const myRequests = leaveRequests.filter((r) => r.employeeId === currentUser.id || r.employeeName === currentUser.name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || submitting) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      await onSubmitLeaveRequest({
      employeeId: currentUser.id,
      employeeName: currentUser.name,
      department: currentUser.department,
      leaveType,
      duration: 'full',
      startDate,
      endDate,
      days: Math.max(1, Math.floor((new Date(`${endDate}T12:00:00`).getTime() - new Date(`${startDate}T12:00:00`).getTime()) / 86400000) + 1),
      reason
      });
    } catch (error: any) {
      setSubmitError(error?.message ?? 'Unable to submit leave request. Please try again.');
      return;
    } finally {
      setSubmitting(false);
    }

    setReason('');
    setSubmittedToast(true);
    setTimeout(() => setSubmittedToast(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">Leave Requests</h2>
        <p className="text-xs text-slate-500">Apply for leave and view leave balance status.</p>
      </div>

      {/* Live leave balance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs sm:col-span-1">
          <p className="text-xs font-semibold text-slate-500">Available Leave Balance</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">{currentUser.leaveBalance} Days</p>
          <p className="text-[11px] text-slate-400 mt-1">Live employee record</p>
        </div>
      </div>

      {submitError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs font-semibold">{submitError}</div>
      )}

      {submittedToast && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Leave request submitted successfully for approval.</span>
        </div>
      )}

      {/* Request Form */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6">
        <div className="flex items-center gap-2 pb-4 mb-4 border-b border-slate-100">
          <FileText className="w-5 h-5 text-purple-600" />
          <h3 className="font-bold text-slate-900 text-sm">Apply for Leave</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Leave Type</label>
              <select
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value as any)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="casual">Casual Leave</option>
                <option value="sick">Sick Leave</option>
                <option value="earned">Earned Leave</option>
                <option value="unpaid">Loss of Pay (Unpaid)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Leave</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Provide reason for leave request..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              required
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-2"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'Submitting…' : 'Submit Leave Request'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* History */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-sm">Leave History</h3>
          <span className="text-xs text-slate-500 font-medium">{myRequests.length} total entries</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs responsive-data-table employee-leave-table">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Duration</th>
                <th className="px-6 py-3">Reason</th>
                <th className="px-6 py-3">Requested On</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {myRequests.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                  <td data-label="Type" className="px-6 py-3.5 font-bold text-slate-900 capitalize">{req.leaveType} Leave</td>
                  <td data-label="Duration" className="px-6 py-3.5">
                    {req.startDate} to {req.endDate} ({req.days} days)
                  </td>
                  <td data-label="Reason" className="px-6 py-3.5 max-w-xs truncate">{req.reason}</td>
                  <td data-label="Requested On" className="px-6 py-3.5 text-slate-500 text-[11px] font-mono">{req.requestedOn}</td>
                  <td data-label="Status" className="px-6 py-3.5">
                    <StatusBadge status={req.status} />
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
