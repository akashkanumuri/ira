import React, { useState } from 'react';
import { CorrectionRequest, Employee } from '../../types/attendance';
import { StatusBadge } from '../common/StatusBadge';
import { FileEdit, Clock, Send, CheckCircle2 } from 'lucide-react';
import { getKolkataDateString } from '../../lib/workingDays';

interface CorrectionsViewProps {
  currentUser: Employee;
  correctionRequests: CorrectionRequest[];
  onSubmitCorrection: (newReq: Omit<CorrectionRequest, 'id' | 'requestedOn' | 'status'>) => Promise<void>;
}

export const CorrectionsView: React.FC<CorrectionsViewProps> = ({
  currentUser,
  correctionRequests,
  onSubmitCorrection
}) => {
  const [date, setDate] = useState(() => getKolkataDateString());
  const [origCheckIn, setOrigCheckIn] = useState('');
  const [origCheckOut, setOrigCheckOut] = useState('');
  const [reqCheckIn, setReqCheckIn] = useState('');
  const [reqCheckOut, setReqCheckOut] = useState('');
  const [reason, setReason] = useState('');
  const [submittedToast, setSubmittedToast] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const myRequests = correctionRequests.filter(
    (r) => r.employeeId === currentUser.id || r.employeeName === currentUser.name
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || submitting) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      await onSubmitCorrection({
      employeeId: currentUser.id,
      employeeName: currentUser.name,
      department: currentUser.department,
      date,
      originalCheckIn: origCheckIn,
      originalCheckOut: origCheckOut,
      requestedCheckIn: reqCheckIn,
      requestedCheckOut: reqCheckOut,
      reason
      });
    } catch (error: any) {
      setSubmitError(error?.message ?? 'Unable to submit correction request. Please try again.');
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
        <h2 className="text-xl font-bold text-slate-900">Attendance Corrections</h2>
        <p className="text-xs text-slate-500">
          Request regularization if you forgot to check in/out or experienced device issues.
        </p>
      </div>

      {submitError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs font-semibold">{submitError}</div>
      )}

      {submittedToast && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Correction request submitted for Admin review.</span>
        </div>
      )}

      {/* Form */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6">
        <div className="flex items-center gap-2 pb-4 mb-4 border-b border-slate-100">
          <FileEdit className="w-5 h-5 text-amber-600" />
          <h3 className="font-bold text-slate-900 text-sm">Submit Regularization Request</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Target Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Corrected Check-in Time</label>
              <input
                type="text"
                value={reqCheckIn}
                onChange={(e) => setReqCheckIn(e.target.value)}
                placeholder="09:30 AM"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Corrected Check-out Time</label>
              <input
                type="text"
                value={reqCheckOut}
                onChange={(e) => setReqCheckOut(e.target.value)}
                placeholder="06:15 PM"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Missed Punch / Discrepancy</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Forgot to check in / Incorrect check-out time / System error"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              required
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-2"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'Submitting…' : 'Submit Correction Request'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* History */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-sm">Correction Requests History</h3>
          <span className="text-xs text-slate-500 font-medium">{myRequests.length} total entries</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs responsive-data-table employee-corrections-table">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Original Punches</th>
                <th className="px-6 py-3">Requested Punches</th>
                <th className="px-6 py-3">Reason</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {myRequests.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                  <td data-label="Date" className="px-6 py-3.5 font-bold text-slate-900">{req.date}</td>
                  <td data-label="Original Punches" className="px-6 py-3.5 font-mono text-slate-500 text-[11px]">
                    {req.originalCheckIn} → {req.originalCheckOut}
                  </td>
                  <td data-label="Requested Punches" className="px-6 py-3.5 font-mono text-blue-700 font-bold text-[11px]">
                    {req.requestedCheckIn} → {req.requestedCheckOut}
                  </td>
                  <td data-label="Reason" className="px-6 py-3.5 max-w-xs truncate">{req.reason}</td>
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
