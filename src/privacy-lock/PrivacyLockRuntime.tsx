import { useEffect } from 'react';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import { useNotificationStore } from '@/stores/notificationStore';
import { usePrivacyLockStore } from './store';

export function PrivacyLockRuntime() {
  const locked = usePrivacyLockStore((state) => state.snapshot?.locked === true);

  useEffect(() => {
    if (!locked) return;
    voiceRuntime.interruptAll();
    useNotificationStore.getState().clearToasts();
    window.dispatchEvent(new CustomEvent('junqi:privacy-lock-engaged'));
  }, [locked]);

  return null;
}
