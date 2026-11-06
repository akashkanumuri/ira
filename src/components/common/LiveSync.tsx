import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { startLiveSync } from '../../lib/live';

/** Keeps every open screen up to date (see lib/live.ts). Renders nothing. */
export function LiveSync() {
  const { user } = useAuth();
  const id = user?.id ?? null;
  useEffect(() => (id ? startLiveSync(id) : undefined), [id]);
  return null;
}
