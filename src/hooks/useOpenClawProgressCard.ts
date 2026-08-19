import { useEffect } from 'react';
import {
  projectProgressCardEntry,
  useProgressCardStore,
  watchOpenClawProgressCard,
} from '@/stores/progressCardStore';
import { gateway } from '@/services/gateway';

export function useOpenClawProgressCard(sessionKey: string) {
  const entry = useProgressCardStore((state) => state.entries[sessionKey]);
  useEffect(() => watchOpenClawProgressCard(sessionKey), [sessionKey]);
  return projectProgressCardEntry(entry, gateway.captureConnectionId());
}
