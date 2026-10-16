import React from 'react';
import { PortalLoginScreen } from '../auth/PortalLoginScreen';

interface ClientLoginViewProps {
  onSwitchToStaff?: () => void;
}

export const ClientLoginView: React.FC<ClientLoginViewProps> = () => {
  return <PortalLoginScreen portal="client" />;
};
