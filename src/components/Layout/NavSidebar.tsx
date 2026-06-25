// ═══════════════════════════════════════════════════════════
// NavSidebar — Compact icon-only sidebar (64px)
// Matches conceptual design: icons + active bar + user avatar
// ═══════════════════════════════════════════════════════════

import { NavLink, useLocation } from 'react-router-dom';
import { NavSidebarFooter } from './NavSidebarFooter';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, MessageCircle, Kanban, DollarSign,
  Clock, Bot, Settings2, Brain, Puzzle,
  Terminal, FolderOpen, CalendarDays, Activity, Sparkles,
  PanelLeftOpen, PanelLeftClose, History, GitBranch,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDirection } from '@/i18n';
import { isFeatureEnabled, type EditionFeatureKey } from '@/config/edition';
import clsx from 'clsx';

interface NavItem {
  to: string;
  icon: any;
  labelKey: string;
  badge?: string;
  feature: EditionFeatureKey;
  /** When set, the item is rendered in a submenu (e.g. 'advanced'). */
  submenu?: 'advanced';
}

const navItemDefs: NavItem[] = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard', feature: 'dashboard' },
  { to: '/chat', icon: MessageCircle, labelKey: 'nav.chat', feature: 'chat' },
  { to: '/workshop', icon: Kanban, labelKey: 'nav.workshop', feature: 'workshop' },
  { to: '/kanban', icon: LayoutDashboard, labelKey: 'nav.kanban', feature: 'workshop' },
  { to: '/cron', icon: Clock, labelKey: 'nav.cron', feature: 'cron' },
  { to: '/agents', icon: Bot, labelKey: 'nav.agents', feature: 'agents' },
  { to: '/costs', icon: DollarSign, labelKey: 'nav.costs', feature: 'analytics' },
  { to: '/skills', icon: Puzzle, labelKey: 'nav.skills', feature: 'skills' },
  { to: '/terminal', icon: Terminal, labelKey: 'nav.terminal', feature: 'terminal' },
  { to: '/agent-run', icon: Sparkles, labelKey: 'nav.agentRun', feature: 'agentRun', submenu: 'advanced' },
  { to: '/memory', icon: Brain, labelKey: 'nav.memory', badge: 'BETA', feature: 'memory' },
  { to: '/files', icon: FolderOpen, labelKey: 'nav.files', feature: 'files' },    { to: '/calendar', icon: CalendarDays, labelKey: 'nav.calendar', feature: 'calendar' },
  { to: '/config', icon: Settings2, labelKey: 'nav.config', feature: 'configManager' },
  { to: '/perf', icon: Activity, labelKey: 'nav.performance', feature: 'logs' }, // reuse logs flag or always show
];

const navItems = navItemDefs.filter((item) => isFeatureEnabled(item.feature));


// Prefetch heavy lazy chunks on hover (before click)
const PREFETCH_MAP: Record<string, () => void> = {
  '/chat': () => import('@/pages/ChatPage'),
  '/costs': () => import('@/pages/FullAnalytics'),
  '/cron': () => import('@/pages/CronMonitor'),
  '/terminal': () => import('@/pages/TerminalPage'),
};

export function NavSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  // Collapse toggle now lives in the TopBar; sidebar only reads the state.
  const { language, sidebarCollapsed, sidebarMode } = useSettingsStore();
  const dir = getDirection(language);
  const isRTL = dir === 'rtl';

  const borderClass = isRTL ? 'border-l' : 'border-r';

  // The element stays mounted across all three states so the width/opacity
  // can animate smoothly. expanded = 220, mini = 64, hidden = 0.
  const targetWidth = sidebarMode === 'expanded' ? 220
    : sidebarMode === 'mini' ? 64
      : 0;
  const visible = sidebarMode !== 'hidden';

  return (
    <motion.aside
      // Seed the initial paint from the same target so the first frame is
      // already at the right width (avoids framer defaulting to 0 and "popping"
      // into view). Subsequent updates animate smoothly via tween.
      initial={false}
      animate={{ width: targetWidth, opacity: visible ? 1 : 0 }}
      transition={{ type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.24 }}
      style={{ width: targetWidth, willChange: 'width, opacity', background: 'linear-gradient(180deg, var(--aegis-surface), var(--aegis-surface-elevated))' }}
      className={clsx(
        'shrink-0 flex flex-col overflow-hidden overflow-x-hidden',
        'chrome-bg', borderClass, 'border-aegis-border',
        'py-3 relative',
        sidebarMode === 'mini' ? 'items-center' : 'items-stretch',
      )}
    >
      {/* Navigation Icons */}
      <nav className={clsx('flex-1 flex flex-col gap-1 px-2 overflow-y-auto overflow-x-hidden', sidebarMode === 'mini' ? 'items-center' : 'items-stretch')}>
        {navItems.filter((i) => !i.submenu).map((item) => {
          const isActive = location.pathname === item.to ||
            (item.to !== '/' && location.pathname.startsWith(item.to));

          return (
            <NavLink
              key={item.to}
              to={item.to}
              onMouseEnter={() => PREFETCH_MAP[item.to]?.()}
              aria-current={isActive ? 'page' : undefined}
              className={clsx(
                'relative h-[44px] rounded-lg',
                'flex items-center',
                'transition-all duration-300 group',
                sidebarCollapsed ? 'w-[44px] justify-center' : 'w-full px-3 justify-start gap-2.5',
                isActive
                  ? 'bg-[rgb(var(--aegis-primary)/0.10)] text-aegis-primary'
                  : 'text-aegis-text-muted hover:text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.04)]'
              )}
            >
              {/* Active indicator bar — animated slide */}
              {isActive && (
                <motion.div
                  layoutId="nav-active-bar"
                  className={clsx(
                    'absolute top-1/2 -translate-y-1/2',
                    'w-[3px] h-[20px] rounded-full',
                    'bg-aegis-primary',
                    isRTL ? '-right-[12px]' : '-left-[12px]'
                  )}
                  transition={{
                    type: 'spring',
                    stiffness: 400,
                    damping: 30,
                  }}
                />
              )}

              <div className="relative" title={sidebarCollapsed ? t(item.labelKey, item.labelKey) : undefined}>
                <item.icon size={18} />
                {item.badge && !sidebarCollapsed && (
                  <span className="absolute -top-1.5 -right-2 text-[8px]">{item.badge}</span>
                )}
              </div>

              {!sidebarCollapsed && (
                <span className="text-[12px] font-medium truncate">{t(item.labelKey)}</span>
              )}

              {/* Tooltip on hover */}
              {sidebarCollapsed && (
                <div className={clsx(
                  'absolute top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg',
                  'bg-aegis-elevated-solid border border-aegis-border shadow-lg',
                  'text-aegis-text text-[11px] font-medium whitespace-nowrap',
                  'opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50',
                  isRTL ? 'right-full mr-3' : 'left-full ml-3'
                )}>
                  {t(item.labelKey)}
                </div>
              )}
            </NavLink>
          );
        })}

        {/* Advanced submenu — collapsed by default, hides nezha-specific
            power-user items that overlap with Chat. */}
        {(() => {
          const advanced = navItems.filter((i) => i.submenu === 'advanced');
          if (advanced.length === 0) return null;
          const isAdvancedOpen = !sidebarCollapsed;
          return (
            <div className={clsx('mt-3 pt-3', !sidebarCollapsed && 'border-t border-aegis-border/30')}>
              {!sidebarCollapsed && (
                <div className="text-[9.5px] font-bold uppercase tracking-wider text-aegis-text-dim mb-1.5 px-3">
                  {t('nav.advanced', 'Advanced')}
                </div>
              )}
              {advanced.map((item) => {
                const isActive = location.pathname === item.to ||
                  (item.to !== '/' && location.pathname.startsWith(item.to));
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onMouseEnter={() => PREFETCH_MAP[item.to]?.()}
                    aria-current={isActive ? 'page' : undefined}
                    title={sidebarCollapsed ? t(item.labelKey) : undefined}
                    className={clsx(
                      'relative h-[36px] rounded-md flex items-center transition-all',
                      sidebarCollapsed ? 'w-[36px] justify-center mx-auto' : 'w-full px-3 gap-2',
                      isActive
                        ? 'bg-[rgb(var(--aegis-primary)/0.10)] text-aegis-primary'
                        : 'text-aegis-text-muted hover:text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.04)]',
                    )}>
                    <item.icon size={15} />
                    {!sidebarCollapsed && <span className="text-[11.5px] font-medium truncate">{t(item.labelKey)}</span>}
                  </NavLink>
                );
              })}
            </div>
          );
        })()}
      </nav>

      <NavSidebarFooter collapsed={sidebarCollapsed} />
    </motion.aside>
  );
}

