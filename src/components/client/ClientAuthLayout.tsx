import React, { type ReactNode } from 'react';
import { AuthLayout } from '../../ui/AuthLayout';

interface ClientAuthLayoutProps {
  children: ReactNode;
  tag: string;
  line: string;
  notice?: string;
}

/** Client invitation / password set-up screens share the main sign-in layout. */
export const ClientAuthLayout: React.FC<ClientAuthLayoutProps> = ({ children, tag, line, notice }) => (
  <AuthLayout eyebrow={tag} headline={line} notice={notice}>
    {children}
  </AuthLayout>
);
