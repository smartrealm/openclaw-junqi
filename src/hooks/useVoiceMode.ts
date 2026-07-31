import { useSyncExternalStore } from 'react';
import { voiceModeCoordinator } from '@/services/voice/VoiceModeCoordinator';

export function useVoiceMode() {
  return useSyncExternalStore(
    voiceModeCoordinator.subscribe,
    voiceModeCoordinator.getSnapshot,
    voiceModeCoordinator.getSnapshot,
  );
}
