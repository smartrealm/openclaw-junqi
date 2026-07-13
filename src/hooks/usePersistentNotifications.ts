import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { NotificationOperationGate } from './notificationOperationGate';

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
  const operationGateRef = useRef(new NotificationOperationGate());
  const mutationErrorRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!hasTauriRuntime()) {
      if (mountedRef.current) {
        setResult({ notifications: [], unreadCount: 0 });
        setLoading(false);
        setError(null);
      }
      return;
    }
    const generation = operationGateRef.current.beginRefresh();
    if (generation === null) return;
    setLoading(true);
    setError(null);
    try {
      const next = await invoke<PersistentNotificationResult>('get_notifications');
      if (mountedRef.current && operationGateRef.current.canCommitRefresh(generation)) setResult(next);
    } catch (cause) {
      if (mountedRef.current && operationGateRef.current.canCommitRefresh(generation)) setError(String(cause));
    } finally {
      if (mountedRef.current && operationGateRef.current.canCommitRefresh(generation)) setLoading(false);
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
      operationGateRef.current.invalidate();
      if (timer !== undefined) window.clearInterval(timer);
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener(PERSISTENT_NOTIFICATIONS_CHANGED_EVENT, handleChanged);
      }
    };
  }, [pollIntervalMs, refresh]);

  const runMutation = useCallback(async (
    command: string,
    args: Record<string, unknown> | undefined,
    optimisticUpdate: () => void,
  ) => {
    operationGateRef.current.beginMutation();
    setLoading(false);
    setError(null);
    optimisticUpdate();
    let succeeded = false;
    try {
      await invoke(command, args);
      succeeded = true;
    } catch (cause) {
      mutationErrorRef.current = String(cause);
    } finally {
      const shouldRepair = operationGateRef.current.finishMutation(succeeded);
      if (shouldRepair && mountedRef.current) {
        const mutationError = mutationErrorRef.current;
        mutationErrorRef.current = null;
        await refresh();
        if (mountedRef.current && mutationError) setError(mutationError);
      }
    }
  }, [refresh]);

  const markRead = useCallback(async (id: string) => {
    await runMutation(
      'mark_notification_read',
      { id },
      () => setResult((current) => withNotificationRead(current, id)),
    );
  }, [runMutation]);

  const markAllRead = useCallback(async () => {
    await runMutation(
      'mark_all_notifications_read',
      undefined,
      () => setResult((current) => withAllNotificationsRead(current)),
    );
  }, [runMutation]);

  const clear = useCallback(async () => {
    await runMutation(
      'clear_notifications',
      undefined,
      () => setResult({ notifications: [], unreadCount: 0 }),
    );
  }, [runMutation]);

  return { result, loading, error, refresh, markRead, markAllRead, clear };
}
