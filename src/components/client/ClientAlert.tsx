import React, { type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

export type AlertTone = 'err' | 'warn' | 'ok' | 'info';

interface ClientAlertProps {
  tone?: AlertTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export const ClientAlert: React.FC<ClientAlertProps> = ({
  tone = 'err',
  title,
  children,
  action,
  className = '',
}) => {
  const toneClasses = {
    err: 'bg-[#fdecec] border-[#f0c4c4]',
    warn: 'bg-[#fdf4e3] border-[#efdcb3]',
    ok: 'bg-[#eaf8f1] border-[#bfe0d0]',
    info: 'bg-[#f3f0fe] border-[#c5daf4]',
  }[tone];

  const iconClasses = {
    err: 'text-[#d13f45]',
    warn: 'text-[#b7791f]',
    ok: 'text-[#22895f]',
    info: 'text-[#5b35e8]',
  }[tone];

  const IconComponent =
    tone === 'ok' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : tone === 'info' ? Info : AlertCircle;

  return (
    <div
      className={`flex gap-3 rounded-lg border p-3.5 ${toneClasses} ${className}`}
      role="alert"
    >
      <IconComponent size={16} className={`mt-0.5 shrink-0 ${iconColors(tone)}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[#14112b]">{title}</div>
        {children && (
          <div className="text-xs text-[#5e5a80] mt-0.5 leading-relaxed">{children}</div>
        )}
      </div>
      {action}
    </div>
  );
};

function iconColors(tone: AlertTone) {
  switch (tone) {
    case 'ok':
      return 'text-[#22895f]';
    case 'warn':
      return 'text-[#b7791f]';
    case 'info':
      return 'text-[#5b35e8]';
    case 'err':
    default:
      return 'text-[#d13f45]';
  }
}
