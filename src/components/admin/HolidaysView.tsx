import React, { useState } from 'react';
import { Holiday } from '../../types/attendance';
import { Modal } from '../common/Modal';
import { Palmtree, Plus, Calendar } from 'lucide-react';

interface HolidaysViewProps {
  holidays: Holiday[];
  onAddHoliday: (hol: Omit<Holiday, 'id'>) => void;
}

export const HolidaysView: React.FC<HolidaysViewProps> = ({ holidays, onAddHoliday }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !date) return;

    const dayOfWeek = new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long' });
    onAddHoliday({ name, date, dayOfWeek, description, mandatory: true });

    setName('');
    setDescription('');
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Company Holidays</h2>
          <p className="text-xs text-slate-500">Official company holiday calendar and non-working days.</p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-2xs flex items-center gap-2 self-start sm:self-center"
        >
          <Plus className="w-4 h-4" />
          <span>+ Add Holiday</span>
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs responsive-data-table admin-holidays-table">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Holiday</th>
                <th className="px-6 py-3.5">Date</th>
                <th className="px-6 py-3.5">Day of Week</th>
                <th className="px-6 py-3.5">Description</th>
                <th className="px-6 py-3.5">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {holidays.map((h) => (
                <tr key={h.id} className="hover:bg-slate-50/80 transition-colors">
                  <td data-label="Holiday" className="px-6 py-3.5 font-bold text-slate-900 flex items-center gap-2">
                    <Palmtree className="w-4 h-4 text-emerald-600" />
                    <span>{h.name}</span>
                  </td>
                  <td data-label="Date" className="px-6 py-3.5 font-mono text-slate-900 font-bold">{h.date}</td>
                  <td data-label="Day of Week" className="px-6 py-3.5">{h.dayOfWeek}</td>
                  <td data-label="Description" className="px-6 py-3.5 text-slate-500">{h.description}</td>
                  <td data-label="Type" className="px-6 py-3.5">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold border border-slate-200">
                      Mandatory
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add Company Holiday"
        subtitle="Schedule a company-wide non-working holiday"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Holiday Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Christmas Day"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Day of Week</label>
              <div className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600">
                {date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long' }) : 'Select a date'}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs"
            >
              Add Holiday
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
