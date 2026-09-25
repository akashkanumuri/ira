import React, { useEffect, useState } from 'react';
import { FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { exportMonthlyReport, fetchAttendanceData, exportToExcel, type ExportFilters, type ExportRow } from '../../lib/export';

function currentMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());
}

export const ExcelExportView: React.FC = () => {
  const [month, setMonth] = useState(currentMonth());
  const [previewRows, setPreviewRows] = useState<ExportRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshPreview = async (selectedMonth = month) => {
    setLoadingRows(true);
    setError(null);
    try {
      setPreviewRows(await fetchAttendanceData({ month: selectedMonth }));
    } catch (err: any) {
      setPreviewRows([]);
      setError(err?.message ?? 'Unable to load attendance records.');
    } finally {
      setLoadingRows(false);
    }
  };

  useEffect(() => {
    void refreshPreview(month);
  }, [month]);

  const handleExport = async () => {
    setLoading(true);
    setSuccess(null);
    setError(null);
    try {
      await exportMonthlyReport(null, month);
      setSuccess(`Attendance for ${month} downloaded successfully.`);
      await refreshPreview(month);
    } catch (err: any) {
      setError(err?.message ?? 'Export failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDateExport = async () => {
    setLoading(true);
    setSuccess(null);
    setError(null);
    try {
      const filters: ExportFilters = { month };
      await exportToExcel(filters, `attendance-${month}.xlsx`);
      setSuccess(`Attendance for ${month} downloaded successfully.`);
    } catch (err: any) {
      setError(err?.message ?? 'Export failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Monthly Excel Export</h2>
        <p className="text-xs text-slate-500">Download the real attendance records stored for your employees.</p>
      </div>

      {success && <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-emerald-900"><CheckCircle2 className="w-5 h-5 text-emerald-600" /><p className="font-bold text-xs">{success}</p></div>}
      {error && <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-3 text-rose-900"><AlertCircle className="w-5 h-5 text-rose-600" /><p className="text-xs">{error}</p></div>}

      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Month</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={handleExport} disabled={loading || loadingRows} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Download Monthly Excel
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Excel Output Preview</h3>
            <p className="text-[11px] text-slate-500">Preview is populated from the same real records used by the export.</p>
          </div>
          <span className="text-xs text-slate-500 font-medium">{previewRows.length} record(s)</span>
        </div>

        <div className="overflow-x-auto">
          {loadingRows ? (
            <div className="py-12 flex justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : previewRows.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">No real attendance records for this month.</div>
          ) : (
            <table className="w-full text-left text-xs responsive-data-table admin-export-table">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Day</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3">Check-in</th>
                  <th className="px-4 py-3">Break</th>
                  <th className="px-4 py-3">Check-out</th>
                  <th className="px-4 py-3">Working</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {previewRows.map((row, index) => (
                  <tr key={`${row['Employee Name']}-${row.Date}-${index}`} className="hover:bg-slate-50/80">
                    <td data-label="Employee" className="px-4 py-3 font-bold text-slate-900">{row['Employee Name']}</td>
                    <td data-label="Date" className="px-4 py-3 font-mono">{row.Date}</td>
                    <td data-label="Day" className="px-4 py-3">{row.Day}</td>
                    <td data-label="Mode" className="px-4 py-3 font-semibold">{row['Attendance Mode']}</td>
                    <td data-label="Check-in" className="px-4 py-3 font-mono">{row['Check-in Time']}</td>
                    <td data-label="Break" className="px-4 py-3 font-mono">{row['Break Duration']}</td>
                    <td data-label="Check-out" className="px-4 py-3 font-mono">{row['Check-out Time']}</td>
                    <td data-label="Working" className="px-4 py-3 font-bold text-blue-600 font-mono">{row['Working Hours']}</td>
                    <td data-label="Status" className="px-4 py-3 font-bold text-emerald-700">{row['Attendance Status']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
