import React, { useState } from 'react';
import { CorrectionRequest } from '../../types/attendance';
import { StatusBadge } from '../common/StatusBadge';
import { Drawer } from '../common/Drawer';
import { FileEdit, Check, X, Eye, ArrowRight, AlertCircle } from 'lucide-react';

interface RegularizationViewProps {
  correctionRequests: CorrectionRequest[];
  onApproveCorrection: (id: string) => void;
  onRejectCorrection: (id: string) => void;
}

export const RegularizationView: React.FC<RegularizationViewProps> = ({
  correctionRequests,
  onApproveCorrection,
  onRejectCorrection
}) => {
  const [selectedReq, setSelectedReq] = useState<CorrectionRequest | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleOpenReview = (req: CorrectionRequest) => {
    setSelectedReq(req);
    setIsDrawerOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">Attendance Corrections</h2>
        <p className="text-xs text-slate-500">
          Review regularization requests submitted by employees for missed or corrected punch times.
        </p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs responsive-data-table admin-corrections-table">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Employee</th>
                <th className="px-6 py-3.5">Date</th>
                <th className="px-6 py-3.5">Original Check-In / Out</th>
                <th className="px-6 py-3.5">Requested Check-In / Out</th>
                <th className="px-6 py-3.5">Reason</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {correctionRequests.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                  <td data-label="Employee" className="px-6 py-3.5">
                    <span className="font-bold text-slate-900">{req.employeeName}</span>
                    <p className="text-[10px] text-slate-400">{req.department}</p>
                  </td>
                  <td data-label="Date" className="px-6 py-3.5 font-bold text-slate-900">{req.date}</td>
                  <td data-label="Original Punches" className="px-6 py-3.5 font-mono text-slate-500">
                    {req.originalCheckIn} → {req.originalCheckOut}
                  </td>
                  <td data-label="Requested Punches" className="px-6 py-3.5 font-mono text-blue-700 font-bold">
                    {req.requestedCheckIn} → {req.requestedCheckOut}
                  </td>
                  <td data-label="Reason" className="px-6 py-3.5 max-w-xs truncate">{req.reason}</td>
                  <td data-label="Status" className="px-6 py-3.5">
                    <StatusBadge status={req.status} />
                  </td>
                  <td data-label="Actions" className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleOpenReview(req)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md text-xs font-semibold transition-all flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" /> Review
                      </button>

                      {req.status === 'pending' && (
                        <>
                          <button
                            onClick={() => onApproveCorrection(req.id)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold transition-all shadow-2xs flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" /> Approve
                          </button>
                          <button
                            onClick={() => onRejectCorrection(req.id)}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-md text-xs font-bold transition-all"
                          >
                            <X className="w-3.5 h-3.5" /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review Drawer side-by-side comparison */}
      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Review Correction Request"
        subtitle="Side-by-side punch value comparison"
      >
        {selectedReq && (
          <div className="space-y-6">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">{selectedReq.employeeName}</h4>
                <p className="text-xs text-slate-500">{selectedReq.department} • Date: {selectedReq.date}</p>
              </div>
              <StatusBadge status={selectedReq.status} />
            </div>

            {/* Comparison Cards */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Punch Comparison</span>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-rose-50/50 border border-rose-200 rounded-xl space-y-2">
                  <p className="text-[11px] font-bold text-rose-800 uppercase tracking-wider">Original System Record</p>
                  <div>
                    <span className="text-xs text-slate-500">Check-in:</span>
                    <p className="font-mono text-sm font-bold text-slate-900">{selectedReq.originalCheckIn}</p>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Check-out:</span>
                    <p className="font-mono text-sm font-bold text-slate-900">{selectedReq.originalCheckOut}</p>
                  </div>
                </div>

                <div className="p-4 bg-emerald-50/50 border border-emerald-200 rounded-xl space-y-2">
                  <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Requested Correction</p>
                  <div>
                    <span className="text-xs text-slate-500">Check-in:</span>
                    <p className="font-mono text-sm font-bold text-emerald-700">{selectedReq.requestedCheckIn}</p>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Check-out:</span>
                    <p className="font-mono text-sm font-bold text-emerald-700">{selectedReq.requestedCheckOut}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Reason */}
            <div>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Employee Reason</span>
              <p className="text-xs text-slate-900 font-medium p-3 bg-white border border-slate-200 rounded-lg mt-1">
                "{selectedReq.reason}"
              </p>
            </div>

            {selectedReq.status === 'pending' && (
              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    onRejectCorrection(selectedReq.id);
                    setIsDrawerOpen(false);
                  }}
                  className="px-4 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg text-xs font-bold transition-all"
                >
                  Reject Correction
                </button>
                <button
                  onClick={() => {
                    onApproveCorrection(selectedReq.id);
                    setIsDrawerOpen(false);
                  }}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" /> Approve & Update Log
                </button>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
};
