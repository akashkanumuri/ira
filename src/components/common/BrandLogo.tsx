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
  showSubtitle = false,
}) => {
  const width = { sm: 'w-44', md: 'w-56', lg: 'w-72' }[size];

  return (
    <div className={`flex items-center select-none min-w-0 ${className}`}>
      <img
        src="/ira-hospitality-logo.png"
        alt="IRA Hospitality"
        className={`${width} h-auto max-h-16 object-contain object-left shrink-0`}
      />
      {showSubtitle && (
        <div className="sr-only">Attendance</div>
      )}
    </div>
  );
};
