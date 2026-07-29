import { useEffect } from 'react';
import { notifications } from '@/services/notifications';
import { useSettingsStore } from '@/stores/settingsStore';
import { applyNotificationPreferences } from './notificationPreferences';

export default function NotificationPreferencesRuntime() {
  const enabled = useSettingsStore((state) => state.notificationsEnabled);
  const soundEnabled = useSettingsStore((state) => state.soundEnabled);
  const dndMode = useSettingsStore((state) => state.dndMode);

  useEffect(() => {
    applyNotificationPreferences(notifications, { enabled, soundEnabled, dndMode });
  }, [dndMode, enabled, soundEnabled]);

  return null;
}
