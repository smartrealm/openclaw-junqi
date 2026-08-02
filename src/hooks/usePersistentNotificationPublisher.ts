import { useCallback, useMemo } from 'react';
import {
  notifyPersistentNotificationsChanged,
  persistentNotificationRepository,
  type PersistentNotificationInput,
  type PersistentNotificationItem,
} from '@/services/persistentNotifications';

/** Publishes a durable record, then asks every mounted inbox to refresh. */
export function usePersistentNotificationPublisher() {
  const publish = useCallback(async (
    notification: PersistentNotificationInput,
  ): Promise<PersistentNotificationItem> => {
    const { item } = await persistentNotificationRepository.push(notification);
    notifyPersistentNotificationsChanged();
    return item;
  }, []);
  const markRead = useCallback(async (id: string): Promise<void> => {
    await persistentNotificationRepository.markRead(id);
    notifyPersistentNotificationsChanged();
  }, []);
  return useMemo(() => ({ publish, markRead }), [markRead, publish]);
}
