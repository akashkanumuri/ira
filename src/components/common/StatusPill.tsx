import React from 'react';

export type StatusPillType =
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
  | 'active'
  | 'inactive'
  | 'ended';

interface StatusPillProps {
  status: StatusPillType | string;
  label?: string;
  size?: 'xs' | 'sm' | 'md';
  pulse?: boolean;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  status,
  label,
  size = 'sm',
  pulse = false,
}) => {
  const normalized = (status || '').toLowerCase();

  let bg = 'bg-slate-100 text-slate-700 border-slate-200';
  let dot = 'bg-slate-400';
  let text = label || status;

  switch (normalized) {
    case 'present':
    case 'approved':
    case 'verified':
    case 'active':
      bg = 'bg-emerald-50/80 text-emerald-800 border-emerald-200/80';
      dot = 'bg-emerald-500';
      text = label || (normalized === 'present' ? 'Present' : normalized === 'verified' ? 'Verified' : 'Active');
      break;

    case 'late':
    case 'pending':
      bg = 'bg-amber-50/80 text-amber-800 border-amber-200/80';
      dot = 'bg-amber-500';
      text = label || (normalized === 'late' ? 'Late Arrival' : 'Pending Review');
      break;

    case 'absent':
    case 'rejected':
    case 'inactive':
      bg = 'bg-rose-50/80 text-rose-800 border-rose-200/80';
      dot = 'bg-rose-500';
      text = label || (normalized === 'absent' ? 'Absent' : 'Rejected');
      break;

    case 'wfh':
      bg = 'bg-sky-50/80 text-sky-800 border-sky-200/80';
      dot = 'bg-sky-500';
      text = label || 'Work From Home';
      break;

    case 'leave':
      bg = 'bg-purple-50/80 text-purple-800 border-purple-200/80';
      dot = 'bg-purple-500';
      text = label || 'On Leave';
      break;

    case 'holiday':
      bg = 'bg-indigo-50/80 text-indigo-800 border-indigo-200/80';
      dot = 'bg-indigo-500';
      text = label || 'Holiday';
      break;

    case 'ended':
      bg = 'bg-slate-100 text-slate-600 border-slate-200';
      dot = 'bg-slate-400';
      text = label || 'Ended';
      break;

    default:
      bg = 'bg-slate-100 text-slate-700 border-slate-200';
      dot = 'bg-slate-400';
      text = label || status;
  }

  const sizeClasses = {
    xs: 'px-1.5 py-0.5 text-[11px] gap-1 font-medium',
    sm: 'px-2 py-0.5 text-xs gap-1.5 font-medium',
    md: 'px-2.5 py-1 text-xs gap-1.5 font-semibold',
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border tracking-tight ${sizeClasses[size]} ${bg}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${dot} shrink-0 ${pulse ? 'animate-pulse' : ''}`}
      />
      <span className="capitalize">{text}</span>
    </span>
  );
};
