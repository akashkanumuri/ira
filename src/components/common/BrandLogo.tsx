import React from 'react';

interface BrandLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'light' | 'dark' | 'auto';
  showSubtitle?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  className = '',
  size = 'md',
  variant = 'auto',
  showSubtitle = true,
}) => {
  const width = { sm: 'w-24', md: 'w-32', lg: 'w-40' }[size];
  const textSize = { sm: 'text-[11px]', md: 'text-xs', lg: 'text-sm' }[size];
  const textColor = variant === 'dark' ? 'text-white' : 'text-slate-900';
  const subColor = variant === 'dark' ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`flex items-center gap-2.5 select-none min-w-0 ${className}`}>
      <img
        src="/ira-hospitality-logo.png"
        alt="IRA Hospitality"
        className={`${width} h-auto max-h-9 object-contain object-left shrink-0`}
      />
      <div className="leading-tight min-w-0">
        <div className={`${textSize} font-bold tracking-tight ${textColor} truncate`}>IRA Presence</div>
        {showSubtitle && (
          <div className={`text-[9px] uppercase tracking-[0.16em] font-semibold ${subColor}`}>Attendance</div>
        )}
      </div>
    </div>
  );
};
