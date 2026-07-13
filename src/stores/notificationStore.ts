import { create } from 'zustand';

// ═══════════════════════════════════════════════════════════
// Notification Store
// - `toasts`: ephemeral live popups (max 3, auto-expire after 5 s)
// - `history`: persistent-in-session notification center feed with read tracking
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

/** A notification as kept in the notification-center feed (with read state). */
export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
  url?: string | null;
}

/** Max items retained in the notification-center history. */
const HISTORY_CAP = 50;

interface NotificationState {
  /** Ephemeral live toasts — max 3, FIFO, auto-expire after 5 s */
  toasts: Toast[];
  /** Notification-center feed — newest first, capped at HISTORY_CAP */
  history: NotificationItem[];
  /** Push a new notification (shows a toast AND records it in history). */
  addToast: (type: NotificationType, title: string, body: string) => void;
  /** Remove a toast by id (called on dismiss or auto-expire). */
  removeToast: (id: string) => void;
  /** Mark a single history item read. */
  markRead: (id: string) => void;
  /** Mark every history item read. */
  markAllRead: () => void;
  /** Clear the entire notification-center feed. */
  clearHistory: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  toasts: [],
  history: [],

  addToast: (type, title, body) => set((state) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const timestamp = new Date().toISOString();
    const toast: Toast = { id, type, title, body, timestamp, expiresAt: Date.now() + 5000 };
    // Keep max 3 toasts — drop the oldest if at capacity (FIFO)
    const currentToasts = state.toasts.length >= 3 ? state.toasts.slice(-2) : state.toasts;
    // Record in history (newest first), capped.
    const item: NotificationItem = { id, type, title, body, timestamp, read: false };
    const history = [item, ...state.history].slice(0, HISTORY_CAP);
    return { toasts: [...currentToasts, toast], history };
  }),

  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id),
  })),

  markRead: (id) => set((state) => ({
    history: state.history.map((n) => (n.id === id ? { ...n, read: true } : n)),
  })),

  markAllRead: () => set((state) => ({
    history: state.history.map((n) => (n.read ? n : { ...n, read: true })),
  })),

  clearHistory: () => set({ history: [] }),
}));
