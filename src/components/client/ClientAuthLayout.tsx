import React, { type ReactNode } from 'react';
import { AuthLayout } from '../../ui/AuthLayout';

interface ClientAuthLayoutProps {
  children: ReactNode;
  tag: string;
  line: string;
  notice?: string;
}

/** Client invitation / password set-up screens share the SIGMA 1 sign-in layout (3D robot scene, form always visible). */
export const ClientAuthLayout: React.FC<ClientAuthLayoutProps> = ({ children, tag, line, notice }) => (
  <AuthLayout brand="sigma" eyebrow={`SIGMA 1 · ${tag}`} headline={line} notice={notice}>
    {children}
  </AuthLayout>
);
