import { useTranslation } from 'react-i18next';
import { MessageSquare, CheckCircle2, Info, AlertCircle, BellOff, CheckCheck, Trash2 } from 'lucide-react';
import clsx from 'clsx';

import type { NotificationItem, NotificationType } from '@/stores/notificationStore';
import { formatNotificationTime } from '@/utils/notificationTime';

interface NotificationPanelProps {
  items: NotificationItem[];
  dndMode: boolean;
  onToggleDnd: () => void;
  onMarkAllRead: () => void;
  onClear: () => void;
  onItemClick: (item: NotificationItem) => void;
}

const TYPE_ICON: Record<NotificationType, typeof Info> = {
  message: MessageSquare,
  task_complete: CheckCircle2,
  info: Info,
  error: AlertCircle,
};

const TYPE_COLOR: Record<NotificationType, string> = {
  message: 'text-aegis-primary',
  task_complete: 'text-aegis-success',
  info: 'text-aegis-text-muted',
  error: 'text-aegis-danger',
};

/**
 * Notification center dropdown — rendered by TopBar under the bell icon.
 * Presentational: all state/handlers come from props.
 */
export function NotificationPanel({
  items,
  dndMode,
  onToggleDnd,
  onMarkAllRead,
  onClear,
  onItemClick,
}: NotificationPanelProps) {
  const { t, i18n } = useTranslation();
  const hasItems = items.length > 0;
  const hasUnread = items.some((n) => !n.read);

  return (
    <div
      className="absolute end-0 top-[calc(100%+6px)] w-[320px] max-h-[420px] flex flex-col rounded-xl border border-aegis-border bg-aegis-elevated shadow-glass-lg overflow-hidden z-50"
      role="dialog"
      aria-label={t('notifications.title', 'Notifications')}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-aegis-border shrink-0">
        <span className="text-[12px] font-semibold text-aegis-text">{t('notifications.title', 'Notifications')}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleDnd}
            title={t('notifications.dnd', 'Do Not Disturb')}
            aria-pressed={dndMode}
            className={clsx(
              'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] transition-colors',
              dndMode
                ? 'text-aegis-warning bg-aegis-warning/[0.1]'
                : 'text-aegis-text-muted hover:text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.06)]',
            )}
          >
            <BellOff size={12} />
            {t('notifications.dnd', 'Do Not Disturb')}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!hasItems ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-aegis-text-dim">
            <BellOff size={20} className="opacity-50" />
            <span className="text-[11px]">{t('notifications.empty', 'No notifications')}</span>
          </div>
        ) : (
          items.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Info;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onItemClick(n)}
                className={clsx(
                  'w-full flex items-start gap-2.5 px-3 py-2 text-start transition-colors border-b border-aegis-border/50 last:border-b-0',
                  'hover:bg-[rgb(var(--aegis-overlay)/0.04)]',
                  !n.read && 'bg-aegis-primary/[0.04]',
                )}
              >
                <Icon size={15} className={clsx('mt-0.5 shrink-0', TYPE_COLOR[n.type])} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-medium text-aegis-text truncate">{n.title}</span>
                    {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-aegis-primary shrink-0" />}
                  </div>
                  {n.body && <p className="text-[11px] text-aegis-text-muted line-clamp-2 mt-0.5">{n.body}</p>}
                  <span className="text-[9px] text-aegis-text-dim">
                    {formatNotificationTime(n.timestamp, i18n.resolvedLanguage ?? i18n.language)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer actions */}
      {hasItems && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-aegis-border shrink-0">
          <button
            type="button"
            onClick={onMarkAllRead}
            disabled={!hasUnread}
            className="flex items-center gap-1 text-[10px] text-aegis-text-muted hover:text-aegis-text-secondary disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            <CheckCheck size={12} />
            {t('notifications.markAllRead', 'Mark all read')}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="ml-auto flex items-center gap-1 text-[10px] text-aegis-text-muted hover:text-aegis-danger transition-colors"
          >
            <Trash2 size={12} />
            {t('notifications.clearAll', 'Clear all')}
          </button>
        </div>
      )}
    </div>
  );
}
