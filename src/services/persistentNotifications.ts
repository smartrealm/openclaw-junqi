import {
  clearPersistentNotifications,
  getPersistentNotifications,
  markPersistentNotificationRead,
  markPersistentNotificationsRead,
  pushPersistentNotification,
  type PersistentNotificationInput,
  type PersistentNotificationItem,
  type PersistentNotificationResult,
} from '@/api/tauri-commands';

export type {
  PersistentNotificationInput,
  PersistentNotificationItem,
  PersistentNotificationResult,
};

export const PERSISTENT_NOTIFICATIONS_CHANGED_EVENT = 'junqi:notifications-changed';

export function notifyPersistentNotificationsChanged(): void {
  if (typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(PERSISTENT_NOTIFICATIONS_CHANGED_EVENT));
  }
}

/**
 * The sole renderer boundary for the persistent notification repository.
 * Presentation hooks and live notification delivery share these operations so
 * their IPC payloads cannot drift apart.
 */
export const persistentNotificationRepository = {
  list: getPersistentNotifications,
  push: pushPersistentNotification,
  markRead: markPersistentNotificationRead,
  markReadMany: markPersistentNotificationsRead,
  clear: clearPersistentNotifications,
};
