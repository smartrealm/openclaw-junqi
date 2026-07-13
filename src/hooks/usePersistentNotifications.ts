import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export const PERSISTENT_NOTIFICATIONS_CHANGED_EVENT = 'junqi:notifications-changed';

export interface PersistentNotificationItem {
  id: string;
  level: string;
  title: string;
  body: string;
  bodyZh: string | null;
  url: string | null;
  createdAt: string;
  isRead: boolean;
}

export interface PersistentNotificationResult {
  notifications: PersistentNotificationItem[];
  unreadCount: number;
}

export function withNotificationRead(
  result: PersistentNotificationResult | null,
  id: string,
): PersistentNotificationResult | null {
  if (!result) return null;
  const notifications = result.notifications.map((item) => (
    item.id === id ? { ...item, isRead: true } : item
  ));
  return {
    notifications,
    unreadCount: notifications.filter((item) => !item.isRead).length,
  };
}

export function withAllNotificationsRead(
  result: PersistentNotificationResult | null,
): PersistentNotificationResult | null {
  if (!result) return null;
  return {
    notifications: result.notifications.map((item) => (
      item.isRead ? item : { ...item, isRead: true }
    )),
    unreadCount: 0,
  };
}

function hasTauriRuntime(): boolean {
  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export function usePersistentNotifications(pollIntervalMs = 60_000) {
  const [result, setResult] = useState<PersistentNotificationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!hasTauriRuntime()) {
      if (mountedRef.current) {
        setResult({ notifications: [], unreadCount: 0 });
        setLoading(false);
        setError(null);
      }
      return;
    }
    const generation = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await invoke<PersistentNotificationResult>('get_notifications');
      if (mountedRef.current && generation === requestGenerationRef.current) setResult(next);
    } catch (cause) {
      if (mountedRef.current && generation === requestGenerationRef.current) setError(String(cause));
    } finally {
      if (mountedRef.current && generation === requestGenerationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = pollIntervalMs > 0 && hasTauriRuntime()
      ? window.setInterval(() => void refresh(), pollIntervalMs)
      : undefined;
    const handleChanged = () => void refresh();
    if (typeof window.addEventListener === 'function') {
      window.addEventListener(PERSISTENT_NOTIFICATIONS_CHANGED_EVENT, handleChanged);
    }
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      if (timer !== undefined) window.clearInterval(timer);
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener(PERSISTENT_NOTIFICATIONS_CHANGED_EVENT, handleChanged);
      }
    };
  }, [pollIntervalMs, refresh]);

  const markRead = useCallback(async (id: string) => {
    setResult((current) => withNotificationRead(current, id));
    try {
      await invoke('mark_notification_read', { id });
    } catch (cause) {
      if (mountedRef.current) {
        setError(String(cause));
        await refresh();
      }
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    setResult((current) => withAllNotificationsRead(current));
    try {
      await invoke('mark_all_notifications_read');
    } catch (cause) {
      if (mountedRef.current) {
        setError(String(cause));
        await refresh();
      }
    }
  }, [refresh]);

  const clear = useCallback(async () => {
    setResult({ notifications: [], unreadCount: 0 });
    try {
      await invoke('clear_notifications');
    } catch (cause) {
      if (mountedRef.current) {
        setError(String(cause));
        await refresh();
      }
    }
  }, [refresh]);

  return { result, loading, error, refresh, markRead, markAllRead, clear };
}
