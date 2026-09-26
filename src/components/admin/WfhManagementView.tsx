import React, { useState } from 'react';
import { WfhRequest } from '../../types/attendance';
import { StatusBadge } from '../common/StatusBadge';
import { Drawer } from '../common/Drawer';
import { Home, CheckCircle2, XCircle, Clock, Check, X, Eye } from 'lucide-react';

interface WfhManagementViewProps {
  wfhRequests: WfhRequest[];
  onApproveWfh: (id: string) => void;
  onRejectWfh: (id: string) => void;
}

export const WfhManagementView: React.FC<WfhManagementViewProps> = ({
  wfhRequests,
  onApproveWfh,
  onRejectWfh
}) => {
  const [selectedReq, setSelectedReq] = useState<WfhRequest | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const filteredRequests = wfhRequests.filter((r) => {
    if (activeTab === 'all') return true;
    return r.status === activeTab;
  });

  const handleOpenDetail = (req: WfhRequest) => {
    setSelectedReq(req);
    setIsDrawerOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Work From Home Requests</h2>
          <p className="text-xs text-slate-500">Review, approve, or reject employee remote work requests.</p>
        </div>

        {/* Tab Filters */}
        <div className="inline-flex p-1 bg-white border border-slate-200 rounded-lg shadow-2xs">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeTab === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({wfhRequests.length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeTab === 'pending' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Pending ({wfhRequests.filter((r) => r.status === 'pending').length})
          </button>
          <button
            onClick={() => setActiveTab('approved')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeTab === 'approved' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Approved ({wfhRequests.filter((r) => r.status === 'approved').length})
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs responsive-data-table admin-wfh-table">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Employee</th>
                <th className="px-6 py-3.5">Department</th>
                <th className="px-6 py-3.5">WFH Date</th>
                <th className="px-6 py-3.5">Duration</th>
                <th className="px-6 py-3.5">Reason</th>
                <th className="px-6 py-3.5">Requested On</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {filteredRequests.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                  <td data-label="Employee" className="px-6 py-3.5">
                    <span className="font-bold text-slate-900">{req.employeeName}</span>
                  </td>
                  <td data-label="Department" className="px-6 py-3.5">{req.department}</td>
                  <td data-label="WFH Date" className="px-6 py-3.5 font-bold text-blue-700 font-mono">{req.date}</td>
                  <td data-label="Duration" className="px-6 py-3.5 capitalize">{req.duration.replace('_', ' ')}</td>
                  <td data-label="Reason" className="px-6 py-3.5 max-w-xs truncate">{req.reason}</td>
                  <td data-label="Requested On" className="px-6 py-3.5 text-slate-500 text-[11px] font-mono">{req.requestedOn}</td>
                  <td data-label="Status" className="px-6 py-3.5">
                    <StatusBadge status={req.status} />
                  </td>
                  <td data-label="Actions" className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleOpenDetail(req)}
                        className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
                        title="View Full Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      {req.status === 'pending' && (
                        <>
                          <button
                            onClick={() => onApproveWfh(req.id)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold transition-all shadow-2xs flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" /> Approve
                          </button>
                          <button
                            onClick={() => onRejectWfh(req.id)}
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

      {/* Review Drawer */}
      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="WFH Request Approval Details"
        subtitle="Review submission reasons and history"
      >
        {selectedReq && (
          <div className="space-y-6">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 text-base">{selectedReq.employeeName}</h4>
                  <p className="text-xs text-slate-500">{selectedReq.department}</p>
                </div>
                <StatusBadge status={selectedReq.status} />
              </div>

              <div className="pt-2 border-t border-slate-200 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500 font-medium">Requested WFH Date:</span>
                  <p className="font-bold text-slate-900 mt-0.5">{selectedReq.date}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Duration:</span>
                  <p className="font-bold text-slate-900 mt-0.5 capitalize">{selectedReq.duration.replace('_', ' ')}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Reason</span>
                <p className="text-xs text-slate-900 font-medium p-3 bg-white border border-slate-200 rounded-lg mt-1">
                  "{selectedReq.reason}"
                </p>
              </div>

              {selectedReq.note && (
                <div>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Additional Note</span>
                  <p className="text-xs text-slate-700 p-3 bg-slate-50 border border-slate-200 rounded-lg mt-1 italic">
                    {selectedReq.note}
                  </p>
                </div>
              )}
            </div>

            {selectedReq.status === 'pending' ? (
              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    onRejectWfh(selectedReq.id);
                    setIsDrawerOpen(false);
                  }}
                  className="px-4 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg text-xs font-bold transition-all"
                >
                  Reject Request
                </button>
                <button
                  onClick={() => {
                    onApproveWfh(selectedReq.id);
                    setIsDrawerOpen(false);
                  }}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" /> Approve WFH
                </button>
              </div>
            ) : (
              <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-600 font-medium">
                Decision recorded on {selectedReq.reviewedAt || selectedReq.requestedOn} by Admin.
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
};
