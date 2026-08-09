import { useEffect } from 'react';
import { notifications } from '@/runtime/notifications';
import { useSettingsStore } from '@/stores/settingsStore';
import { applyNotificationPreferences } from './notificationPreferences';
import { notifyPersistentNotificationsChanged } from '@/services/persistentNotifications';
import { subscribeTauriEvent } from '@/utils/tauriEvents';

interface PersistedNotificationCreatedEvent {
  item: {
    level: string;
    title: string;
    body: string;
  };
}

export default function NotificationPreferencesRuntime() {
  const enabled = useSettingsStore((state) => state.notificationsEnabled);
  const soundEnabled = useSettingsStore((state) => state.soundEnabled);
  const dndMode = useSettingsStore((state) => state.dndMode);

  useEffect(() => {
    applyNotificationPreferences(notifications, { enabled, soundEnabled, dndMode });
  }, [dndMode, enabled, soundEnabled]);

  useEffect(() => subscribeTauriEvent<PersistedNotificationCreatedEvent>(
    'junqi:notification-created',
    ({ payload }) => {
      notifyPersistentNotificationsChanged();
      notifications.presentPersisted(
        payload.item.level,
        payload.item.title,
        payload.item.body,
      );
    },
  ), []);

  return null;
}
