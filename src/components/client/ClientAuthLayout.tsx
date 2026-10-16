import React, { type ReactNode } from 'react';

interface ClientAuthLayoutProps {
  children: ReactNode;
  tag: string;
  line: string;
}

export const ClientAuthLayout: React.FC<ClientAuthLayoutProps> = ({ children, tag, line }) => {
  return (
    <div className="min-h-screen w-full flex flex-col lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] bg-[#f7f8fa] text-[#172033]">
      {/* Left panel: IRA branding, client portal introduction, and supporting text (Desktop only) */}
      <div className="hidden lg:flex flex-col justify-between bg-[#243b64] text-white p-12 select-none">
        <div className="flex items-center gap-3">
          <img
            src="/ira-hospitality-logo.png"
            alt="IRA Hospitality"
            className="h-16 w-auto max-w-[220px] object-contain object-left"
          />
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-white/60 mb-4 font-semibold">{tag}</div>
          <p className="text-[32px] leading-[40px] font-semibold tracking-[-0.02em] max-w-sm">{line}</p>
        </div>
        <div className="text-xs text-white/50 leading-relaxed max-w-xs">
          Accounts are created by your administrator. There is no public registration.
        </div>
      </div>

      {/* Right panel: centered, compact form on clean light background */}
      <div className="flex items-center justify-center px-4 py-8 sm:px-6 sm:py-12 bg-[#f7f8fa] w-full min-w-0">
        <div className="w-full max-w-[380px] min-w-0">
          {/* Mobile branding */}
          <div className="lg:hidden flex items-center mb-6 select-none">
            <img
              src="/ira-hospitality-logo.png"
              alt="IRA Hospitality"
              className="h-10 sm:h-12 w-auto max-w-[160px] object-contain object-left"
            />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
};
