import React, { useState } from 'react';
import { WfhRequest, Employee } from '../../types/attendance';
import { StatusBadge } from '../common/StatusBadge';
import { Home, Calendar, Send, CheckCircle2, Clock } from 'lucide-react';
import { getKolkataDateString } from '../../lib/workingDays';

interface WfhRequestViewProps {
  currentUser: Employee;
  wfhRequests: WfhRequest[];
  onSubmitWfhRequest: (newReq: Omit<WfhRequest, 'id' | 'requestedOn' | 'status'>) => Promise<void>;
}

export const WfhRequestView: React.FC<WfhRequestViewProps> = ({
  currentUser,
  wfhRequests,
  onSubmitWfhRequest
}) => {
  const [date, setDate] = useState(() => getKolkataDateString());
  const [duration, setDuration] = useState<'full_day' | 'half_day'>('full_day');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [submittedToast, setSubmittedToast] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const myRequests = wfhRequests.filter((r) => r.employeeId === currentUser.id || r.employeeName === currentUser.name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || submitting) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      await onSubmitWfhRequest({
      employeeId: currentUser.id,
      employeeName: currentUser.name,
      department: currentUser.department,
      date,
      duration,
      reason,
      note
      });
    } catch (error: any) {
      setSubmitError(error?.message ?? 'Unable to submit WFH request. Please try again.');
      return;
    } finally {
      setSubmitting(false);
    }

    setReason('');
    setNote('');
    setSubmittedToast(true);
    setTimeout(() => setSubmittedToast(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">Work From Home</h2>
        <p className="text-xs text-slate-500">Request WFH authorization and view request history.</p>
      </div>

      {submitError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs font-semibold">{submitError}</div>
      )}

      {submittedToast && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>WFH Request submitted successfully! It is now pending admin approval.</span>
        </div>
      )}

      {/* Form Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6">
        <div className="flex items-center gap-2 pb-4 mb-4 border-b border-slate-100">
          <Home className="w-5 h-5 text-blue-600" />
          <h3 className="font-bold text-slate-900 text-sm">Request WFH</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Date</label>
              <div className="relative">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Duration</label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setDuration('full_day')}
                  className={`py-1.5 rounded-md text-xs font-semibold transition-all ${
                    duration === 'full_day'
                      ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Full Day
                </button>
                <button
                  type="button"
                  onClick={() => setDuration('half_day')}
                  className={`py-1.5 rounded-md text-xs font-semibold transition-all ${
                    duration === 'half_day'
                      ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Half Day
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Doctor appointment / Home maintenance / Travel"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Optional Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add additional context for your manager or admin..."
              rows={2}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-2"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'Submitting…' : 'Send Request'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* History Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-sm">WFH Request History</h3>
          <span className="text-xs text-slate-500 font-medium">{myRequests.length} total requests</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs responsive-data-table employee-wfh-table">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Duration</th>
                <th className="px-6 py-3">Reason</th>
                <th className="px-6 py-3">Requested On</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {myRequests.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                  <td data-label="Date" className="px-6 py-3.5 font-bold text-slate-900">{req.date}</td>
                  <td data-label="Duration" className="px-6 py-3.5 capitalize">{req.duration.replace('_', ' ')}</td>
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
