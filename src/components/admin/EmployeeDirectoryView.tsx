import React, { useMemo, useState } from 'react';
import type { Employee } from '../../types/attendance';
import { Search, Users } from 'lucide-react';

interface EmployeeDirectoryViewProps {
  employees: Employee[];
}

export const EmployeeDirectoryView: React.FC<EmployeeDirectoryViewProps> = ({ employees }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');

  const departments = useMemo(
    () => Array.from(new Set(employees.map((employee) => employee.department).filter(Boolean))) as string[],
    [employees]
  );

  const filtered = employees.filter((employee) => {
    const search = searchTerm.trim().toLowerCase();
    const matchesSearch = !search || employee.name.toLowerCase().includes(search) || employee.email.toLowerCase().includes(search);
    const matchesDept = deptFilter === 'all' || employee.department === deptFilter;
    return matchesSearch && matchesDept;
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl font-bold text-slate-900">Employees</h2>
        </div>
        <p className="text-xs text-slate-500 mt-1">The live employee directory connected to the authentication records.</p>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none"
        >
          <option value="all">All departments</option>
          {departments.map((department) => <option key={department} value={department}>{department}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs responsive-data-table employee-directory-table">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Employee</th>
                <th className="px-6 py-3.5">Email</th>
                <th className="px-6 py-3.5">Department</th>
                <th className="px-6 py-3.5">Designation</th>
                <th className="px-6 py-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-500">No real employee records found.</td></tr>
              ) : filtered.map((employee) => (
                <tr key={employee.id} className="hover:bg-slate-50/80">
                  <td data-label="Employee" className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {employee.avatar ? <img src={employee.avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" /> : <div className="w-8 h-8 rounded-full bg-slate-100 grid place-items-center text-slate-400">{employee.name.charAt(0)}</div>}
                      <span className="font-bold text-slate-900">{employee.name}</span>
                    </div>
                  </td>
                  <td data-label="Email" className="px-6 py-4">{employee.email || '—'}</td>
                  <td data-label="Department" className="px-6 py-4">{employee.department || '—'}</td>
                  <td data-label="Designation" className="px-6 py-4">{employee.designation || '—'}</td>
                  <td data-label="Status" className="px-6 py-4"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${employee.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{employee.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
