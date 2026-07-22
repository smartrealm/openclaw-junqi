import { ArrowUpRight, Bell, Check, CheckCircle2, Info, MessageSquare, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

import type { NotificationPanelItem } from './NotificationPanel';
import { KookyAgentIcon } from '@/components/Terminal/KookyAgentIcon';

interface TerminalNotificationPanelProps {
  items: readonly NotificationPanelItem[];
  onMarkAllRead: () => void;
  onClear: () => void;
  onItemClick: (item: NotificationPanelItem) => void;
}

type InboxVisual = {
  AccentIcon: typeof Bell;
  accent: string;
};

function inboxVisual(type: NotificationPanelItem['type']): InboxVisual {
  switch (type) {
    case 'error':
      return { AccentIcon: TriangleAlert, accent: '#e86868' };
    case 'task_complete':
      return { AccentIcon: CheckCircle2, accent: '#68b0db' };
    case 'message':
      return { AccentIcon: MessageSquare, accent: '#e8b066' };
    default:
      return { AccentIcon: Info, accent: '#8c9099' };
  }
}

/** Kooky's inbox uses a compact English relative clock in the trailing slot. */
export function terminalInboxRelativeTime(timestamp: string, now = Date.now()): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return '';
  const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/**
 * Terminal-only notification inbox. The data remains JunQi's persistent
 * notification source; this component only adopts Kooky's panel geometry,
 * row rhythm, unread treatment, and icon-only header actions.
 */
export function TerminalNotificationPanel({
  items,
  onMarkAllRead,
  onClear,
  onItemClick,
}: TerminalNotificationPanelProps) {
  const { t } = useTranslation();
  const unread = items.filter((item) => !item.read).length;
  const hasItems = items.length > 0;

  return (
    <div
      className="terminal-kooky-inbox absolute end-0 top-[calc(100%+8px)] z-[100] flex w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-[12px] border border-[rgb(239_239_241_/_0.18)] bg-[#22252c] shadow-[0_18px_44px_rgb(0_0_0_/_0.48)]"
      role="dialog"
      aria-label={t('notifications.title', 'Notifications')}
    >
      <div className="flex h-[50px] shrink-0 items-center gap-[7px] border-b border-[rgb(239_239_241_/_0.07)] px-[14px]">
        <span className="font-['Kooky_JetBrains_Mono','JetBrains_Mono',monospace] text-[13px] font-semibold text-[#efeff1]">
          {t('notifications.title', 'Notifications')}
        </span>
        {unread > 0 && (
          <span className="rounded-full bg-[rgb(232_102_102_/_0.15)] px-[5.5px] py-[1.5px] font-['Kooky_JetBrains_Mono','JetBrains_Mono',monospace] text-[9.5px] font-semibold text-[#e86868]">
            {unread}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={unread === 0}
          title={t('notifications.markAllRead', 'Mark all read')}
          aria-label={t('notifications.markAllRead', 'Mark all read')}
          className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[#8c9099] transition-colors hover:bg-[rgb(239_239_241_/_0.07)] hover:text-[#efeff1] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <Check size={12} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!hasItems}
          title={t('notifications.clearAll', 'Clear all')}
          aria-label={t('notifications.clearAll', 'Clear all')}
          className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[#8c9099] transition-colors hover:bg-[rgb(239_239_241_/_0.07)] hover:text-[#efeff1] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <Trash2 size={12} strokeWidth={1.8} />
        </button>
      </div>

      {hasItems ? (
        <div className="max-h-[412px] overflow-y-auto py-1">
          {items.map((item) => {
            const { AccentIcon, accent } = inboxVisual(item.type);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onItemClick(item)}
                className={clsx(
                  'group flex h-[50px] w-full items-center gap-[11px] px-[14px] text-left transition-colors hover:bg-[rgb(239_239_241_/_0.07)]',
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-[30px] w-[3px] shrink-0 rounded-[2px]"
                  style={{ background: accent, opacity: item.read ? 0.22 : 1 }}
                />
                <span className="flex h-[15px] w-[15px] shrink-0 items-center justify-center" style={{ opacity: item.read ? 0.6 : 1 }}>
                  <KookyAgentIcon
                    agent={item.agent ?? undefined}
                    size={15}
                    fallback={<AccentIcon size={15} strokeWidth={1.8} style={{ color: accent }} />}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={clsx(
                    'block truncate font-[\'Kooky_JetBrains_Mono\',\'JetBrains_Mono\',monospace] text-[12.5px]',
                    item.read ? 'font-normal text-[#8c9099]' : 'font-medium text-[#efeff1]',
                  )}>
                    {item.title}
                  </span>
                  <span className="mt-[2px] block truncate font-['Kooky_JetBrains_Mono','JetBrains_Mono',monospace] text-[10.5px] text-[rgb(140_144_153_/_0.72)]">
                    {item.body || t('notifications.title', 'Notifications')}
                  </span>
                </span>
                <span className="flex min-w-8 shrink-0 justify-end font-['Kooky_JetBrains_Mono','JetBrains_Mono',monospace] text-[10px] text-[rgb(140_144_153_/_0.72)]">
                  <span className="group-hover:hidden">{terminalInboxRelativeTime(item.timestamp)}</span>
                  <ArrowUpRight size={10} strokeWidth={2} className="hidden text-[rgb(239_239_241_/_0.75)] group-hover:block" />
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex h-[100px] flex-col items-center justify-center gap-[7px] text-[#8c9099]">
          <Bell size={19} strokeWidth={1.3} className="opacity-40" />
          <span className="font-['Kooky_JetBrains_Mono','JetBrains_Mono',monospace] text-[12px]">
            {t('notifications.empty', 'no notifications')}
          </span>
        </div>
      )}
    </div>
  );
}
