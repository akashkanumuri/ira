import React, { type ReactNode } from 'react';

interface ClientAuthLayoutProps {
  children: ReactNode;
  tag: string;
  line: string;
  notice?: string;
}

export const ClientAuthLayout: React.FC<ClientAuthLayoutProps> = ({ children, tag, line, notice }) => {
  return (
    <div className="min-h-screen w-full flex flex-col lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] bg-[#f7f8fa] text-[#172033] font-['Inter',ui-sans-serif,system-ui,sans-serif]">
      {/* Left panel: IRA branding, client portal introduction, and supporting text (Desktop only) */}
      <div className="hidden lg:flex flex-col justify-between bg-[#243b64] text-white p-12 select-none">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-md bg-white text-[#243b64] grid place-items-center font-bold text-sm">I</span>
          <span className="text-lg font-semibold tracking-[0.08em]">IRA</span>
          <div className="h-5 w-px bg-white/25 mx-1" />
          <img
            src="/ira-hospitality-logo.png"
            alt="IRA Hospitality"
            className="h-8 w-auto max-w-[130px] object-contain object-left"
          />
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-white/60 mb-4">{tag}</div>
          <p className="text-[32px] leading-[40px] font-semibold tracking-[-0.02em] max-w-sm">{line}</p>
        </div>
        <div className="text-xs text-white/50 leading-relaxed max-w-xs">
          {notice || 'Accounts are created by your administrator. There is no public registration.'}
        </div>
      </div>

      {/* Right panel: centered, compact form on clean light background */}
      <div className="flex items-center justify-center px-4 py-8 sm:p-12 bg-[#f7f8fa] w-full min-w-0">
        <div className="w-full max-w-[380px] min-w-0">
          {/* Mobile branding */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8 select-none">
            <span className="w-8 h-8 rounded-md bg-[#243b64] text-white grid place-items-center font-bold text-sm">I</span>
            <span className="text-lg font-semibold tracking-[0.08em] text-[#172033]">IRA</span>
            <div className="h-5 w-px bg-[#172033]/20 mx-1" />
            <img
              src="/ira-hospitality-logo.png"
              alt="IRA Hospitality"
              className="h-7 w-auto max-w-[120px] object-contain object-left"
            />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
};
