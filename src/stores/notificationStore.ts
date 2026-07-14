import { create } from 'zustand';

// ═══════════════════════════════════════════════════════════
// Ephemeral toast state. Notification-center history is persisted by the
// native notification repository and exposed through usePersistentNotifications.
// ═══════════════════════════════════════════════════════════

export type NotificationType = 'message' | 'task_complete' | 'info' | 'error';

export interface Toast {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: string;
  /** Unix timestamp (ms) when this toast should auto-expire */
  expiresAt: number;
}

interface NotificationState {
  /** Ephemeral live toasts — max 3, FIFO, auto-expire after 5 s */
  toasts: Toast[];
  /** Push a new toast. Persistent notifications use the native repository. */
  addToast: (type: NotificationType, title: string, body: string) => void;
  /** Remove a toast by id (called on dismiss or auto-expire). */
  removeToast: (id: string) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  toasts: [],

  addToast: (type, title, body) => set((state) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const timestamp = new Date().toISOString();
    const toast: Toast = { id, type, title, body, timestamp, expiresAt: Date.now() + 5000 };
    // Keep max 3 toasts — drop the oldest if at capacity (FIFO)
    const currentToasts = state.toasts.length >= 3 ? state.toasts.slice(-2) : state.toasts;
    return { toasts: [...currentToasts, toast] };
  }),

  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id),
  })),
}));
