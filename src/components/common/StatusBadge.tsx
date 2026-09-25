import React from 'react';

type BadgeType =
  | 'present'
  | 'late'
  | 'absent'
  | 'wfh'
  | 'leave'
  | 'holiday'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'verified'

interface StatusBadgeProps {
  status: BadgeType | string;
  className?: string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '', size = 'md' }) => {
  const normalized = status.toLowerCase();

  let styles = 'bg-slate-100 text-slate-700 border-slate-200';
  let label = status;

  switch (normalized) {
    case 'present':
    case 'approved':
    case 'verified':
      styles = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      if (normalized === 'present') label = 'Present';
      if (normalized === 'approved') label = 'Approved';
      if (normalized === 'verified') label = 'Verified';
      break;

    case 'late':
    case 'pending':
      styles = 'bg-amber-50 text-amber-700 border-amber-200';
      if (normalized === 'late') label = 'Late';
      if (normalized === 'pending') label = 'Pending';
      break;

    case 'absent':
    case 'rejected':
      styles = 'bg-rose-50 text-rose-700 border-rose-200';
      if (normalized === 'absent') label = 'Absent';
      if (normalized === 'rejected') label = 'Rejected';
      break;

    case 'wfh':
      styles = 'bg-blue-50 text-blue-700 border-blue-200';
      label = 'WFH';
      break;

    case 'leave':
      styles = 'bg-purple-50 text-purple-700 border-purple-200';
      label = 'On Leave';
      break;

    case 'holiday':
      styles = 'bg-slate-100 text-slate-700 border-slate-300';
      label = 'Holiday';
      break;

    default:
      styles = 'bg-slate-100 text-slate-700 border-slate-200';
      break;
  }

  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-medium';

  return (
    <span className={`inline-flex items-center rounded-full border ${padding} ${styles} ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-current opacity-75" />
      {label}
    </span>
  );
};
