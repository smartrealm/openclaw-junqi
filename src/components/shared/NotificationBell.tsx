import { useCallback, useState } from 'react';
import {
  Bell, X, Check, CheckCheck, Info, AlertTriangle, AlertCircle, ExternalLink,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  usePersistentNotifications,
  type PersistentNotificationItem,
} from '@/hooks/usePersistentNotifications';
import { resolveNotificationTarget } from '@/utils/notificationTarget';
import { formatNotificationTime } from '@/utils/notificationTime';

function LevelIcon({ level }: { level: string }) {
  switch (level) {
    case 'warning': return <AlertTriangle size={14} className="text-aegis-warning shrink-0" />;
    case 'error': return <AlertCircle size={14} className="text-aegis-danger shrink-0" />;
    default: return <Info size={14} className="text-aegis-primary shrink-0" />;
  }
}

interface NotificationEntryProps {
  item: PersistentNotificationItem;
  onMarkRead: (id: string) => void;
  onOpenUrl: (url: string) => void;
}

function NotificationEntry({ item, onMarkRead, onOpenUrl }: NotificationEntryProps) {
  const { t } = useTranslation();
  const language = useSettingsStore((state) => state.language);
  const [hov, setHov] = useState(false);
  const body = language === 'zh' && item.bodyZh ? item.bodyZh : item.body;

  const handleClick = () => {
    if (!item.isRead) onMarkRead(item.id);
    if (item.url) onOpenUrl(item.url);
  };

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className={`px-3 py-2.5 border-b flex items-start gap-2.5 transition-colors ${item.url ? 'cursor-pointer' : 'cursor-default'}`}
      style={{
        borderColor: 'rgb(var(--aegis-overlay) / 0.06)',
        background: hov ? 'rgb(var(--aegis-overlay) / 0.04)' : item.isRead ? 'transparent' : 'rgb(var(--aegis-primary) / 0.06)',
      }}
    >
      <LevelIcon level={item.level} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="text-[12.5px] truncate"
            style={{
              fontWeight: item.isRead ? 500 : 600,
              color: 'rgb(var(--aegis-text))',
            }}
          >
            {item.title}
          </span>
          {item.url && (
            <ExternalLink size={11} className="text-aegis-text-dim shrink-0" />
          )}
        </div>
        <div
          className="text-[11.5px] text-aegis-text-muted leading-snug overflow-hidden"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 5,
            WebkitBoxOrient: 'vertical',
            whiteSpace: 'pre-line',
            lineHeight: 1.5,
          }}
        >
          {body}
        </div>
        <div className="text-[10.5px] text-aegis-text-dim mt-1">
          {formatNotificationTime(item.createdAt, language)}
        </div>
      </div>
      {!item.isRead && (
        <button
          title={t('notification.markAsRead', 'Mark as read')}
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead(item.id);
          }}
          className="p-0.5 rounded hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-dim shrink-0 mt-0.5"
        >
          <Check size={12} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

export interface NotificationBellHandle {
  refresh: () => void;
}

interface NotificationBellProps {
  /** Polling interval in ms; default 60s. Set to 0 to disable. */
  pollIntervalMs?: number;
}

export function NotificationBell({ pollIntervalMs = 60_000 }: NotificationBellProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { result, loading, error, refresh, markRead, markAllRead } = usePersistentNotifications(pollIntervalMs);

  const handleOpenUrl = useCallback((url: string) => {
    const target = resolveNotificationTarget(url);
    if (!target) return;
    setOpen(false);
    if (target.kind === 'internal') {
      navigate(target.value);
    } else {
      try {
        window.open(target.value, '_blank', 'noopener,noreferrer');
      } catch {
        // Keep the notification dialog usable if the WebView blocks popups.
      }
    }
  }, [navigate]);

  const unreadCount = result?.unreadCount ?? 0;
  const bellColor = error
    ? 'rgb(var(--aegis-danger))'
    : unreadCount > 0
      ? 'rgb(var(--aegis-primary))'
      : 'rgb(var(--aegis-text-dim))';

  const items = result?.notifications ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => {
          const next = !value;
          if (next) void refresh();
          return next;
        })}
        title={t('notification.title', 'Notifications')}
        aria-label={t('notification.title', 'Notifications')}
        className="relative w-[28px] h-[28px] flex items-center justify-center rounded-[5px] transition-colors"
        style={{
          background: open ? 'rgb(var(--aegis-overlay) / 0.12)' : 'transparent',
          color: 'rgb(var(--aegis-text-secondary))',
        }}
      >
        <Bell size={14} style={{ color: bellColor }} />
        {unreadCount > 0 && (
          <span
            className="absolute top-0 right-0 min-w-[12px] h-[12px] px-[2px] flex items-center justify-center rounded-full text-white text-[8px] font-bold leading-none"
            style={{ background: 'rgb(var(--aegis-danger))' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[2147481000] flex items-start justify-center pt-[10vh]"
          style={{ background: 'rgb(0 0 0 / 0.4)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-[min(920px,calc(100vw-48px),calc((100vh-96px)*4/3))] max-h-[calc(100vh-96px)] flex flex-col rounded-[14px] overflow-hidden"
            style={{
              background: 'rgb(var(--aegis-card))',
              border: '1px solid rgb(var(--aegis-border))',
              boxShadow: '0 24px 48px rgb(0 0 0 / 0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'rgb(var(--aegis-overlay) / 0.08)' }}>
              <span className="text-[14px] font-bold text-aegis-text flex-1">
                {t('notification.title', 'Notifications')}
                {unreadCount > 0 && (
                  <span className="ml-1.5 text-[11px] font-medium text-aegis-text-muted">
                    ({unreadCount} {t('notification.unread', 'unread')})
                  </span>
                )}
              </span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  title={t('notification.markAllAsRead', 'Mark all as read')}
                  onClick={() => void markAllRead()}
                  className="p-0.5 rounded hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted"
                >
                  <CheckCheck size={14} />
                </button>
              )}
              <button
                type="button"
                title={t('common.close', 'Close')}
                onClick={() => setOpen(false)}
                className="p-0.5 rounded hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading && !result ? (
                <div className="p-6 text-center text-[12px] text-aegis-text-dim">
                  {t('common.loading', 'Loading…')}
                </div>
              ) : error && !result ? (
                <div className="p-6 text-center text-[12px] text-aegis-danger" style={{ lineHeight: 1.5 }}>
                  {error}
                </div>
              ) : items.length === 0 ? (
                <div className="p-6 text-center text-[12px] text-aegis-text-dim">
                  {t('notification.noNotifications', 'No notifications')}
                </div>
              ) : (
                items.map((item) => (
                  <NotificationEntry
                    key={item.id}
                    item={item}
                    onMarkRead={(id) => void markRead(id)}
                    onOpenUrl={handleOpenUrl}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
