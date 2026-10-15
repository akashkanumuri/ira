import React, { type ReactNode } from 'react';

interface ClientAuthLayoutProps {
  children: ReactNode;
  tag: string;
  line: string;
}

export const ClientAuthLayout: React.FC<ClientAuthLayoutProps> = ({ children, tag, line }) => {
  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] bg-[#f7f8fa] text-[#172033]">
      {/* Left panel: IRA branding, client portal introduction, and supporting text (Desktop only) */}
      <div className="hidden lg:flex flex-col justify-between bg-[#243b64] text-white p-12 select-none">
        <div className="flex items-center gap-3">
          <img
            src="/ira-hospitality-logo.png"
            alt="IRA Hospitality"
            className="h-10 w-auto max-w-[200px] object-contain object-left brightness-0 invert"
          />
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-white/60 mb-4 font-medium">{tag}</div>
          <p className="text-[32px] leading-[40px] font-semibold tracking-[-0.02em] max-w-sm">{line}</p>
        </div>
        <div className="text-xs text-white/50 leading-relaxed max-w-xs">
          Accounts are created by your administrator. There is no public registration.
        </div>
      </div>

      {/* Right panel: centered, compact form on clean light background */}
      <div className="flex items-center justify-center p-6 sm:p-12 bg-[#f7f8fa]">
        <div className="w-full max-w-[380px]">
          {/* Mobile branding */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8 select-none">
            <img
              src="/ira-hospitality-logo.png"
              alt="IRA Hospitality"
              className="h-9 w-auto max-w-[170px] object-contain object-left"
            />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
};
