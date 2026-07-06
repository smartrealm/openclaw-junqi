// ── NavSidebarFooter — sidebar bottom bar ─────────────────────────────────
//
// Single-responsibility footer: just the Settings entry point. Theme cycling,
// pet toggle, and pomodoro control live in StatusBar (right side of the
// status bar at the very bottom) — keeping the sidebar's left rail focused
// on navigation, and avoiding duplicate buttons that confused which
// location was authoritative.

import { Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UsagePopover } from '@/components/shared/UsagePopover';
import clsx from 'clsx';

export function NavSidebarFooter({ collapsed }: { collapsed?: boolean }) {
  const { t } = useTranslation();

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 pb-2">
        <UsagePopover />
        <NavLink to="/settings"
          title={t('nav.settings', 'Settings')}
          aria-label={t('nav.settings', 'Settings')}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text">
          <Settings size={14} />
        </NavLink>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 mx-2 mb-2 rounded-lg"
      style={{ background: 'rgb(var(--aegis-overlay) / 0.03)', border: '1px solid rgb(var(--aegis-border))' }}>
      <UsagePopover />
      <NavLink to="/settings"
        className={clsx(
          'flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-[13px] font-medium transition-colors',
          'text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text',
        )}>
        <Settings size={12} className="text-aegis-text-muted" />
        <span>{t('nav.settings', '设置')}</span>
      </NavLink>
    </div>
  );
}
