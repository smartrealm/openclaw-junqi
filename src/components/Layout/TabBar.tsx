// TabBar — 顶部标签导航
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import type { SidebarTab } from './tab-utils';
import { LayoutDashboard, Bot, Wrench, Settings } from 'lucide-react';
import clsx from 'clsx';
import { JunQiLogo } from '@/components/shared/JunQiLogo';

const TABS = [
  { id: 'workbench', labelKey: 'nav.dashboard', labelFallback: '仪表盘', path: '/', Icon: LayoutDashboard },
  { id: 'agents',    labelKey: 'nav.agents',     labelFallback: '智能体', path: '/agents', Icon: Bot },
  { id: 'tools',     labelKey: 'nav.tools',      labelFallback: '工具',   path: '/terminal', Icon: Wrench },
  { id: 'settings',  labelKey: 'nav.settings',   labelFallback: '设置',   path: '/settings', Icon: Settings },
] as const;

export function TabBar() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = useSettingsStore((s) => s.activeSidebarTab);
  const setActiveTab = useSettingsStore((s) => s.setActiveSidebarTab);

  return (
    <div className="flex h-[44px] shrink-0 items-center gap-0.5 chrome-bg border-b border-aegis-border pr-2 relative" style={{ paddingLeft: 'var(--aegis-sidebar-expanded, 204px)' }}>
      <div className="absolute inset-y-0 left-0 w-[var(--aegis-sidebar-expanded,204px)] flex items-center px-3 pointer-events-none">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="flex h-8 w-10 shrink-0 items-center justify-center rounded-lg border"
            style={{
              background: 'rgb(var(--aegis-primary) / 0.08)',
              borderColor: 'rgb(var(--aegis-primary) / 0.18)',
            }}
          >
          <JunQiLogo
              variant="emblem"
              className="h-7 w-9"
            title="JunQi Desktop"
            style={{ filter: 'drop-shadow(0 1px 1px rgb(var(--aegis-overlay) / 0.08))' }}
          />
          </div>
          <div className="min-w-0 leading-none">
            <div className="truncate text-[14px] font-extrabold text-aegis-text">JunQi</div>
            <div className="mt-1 truncate text-[10px] font-medium text-aegis-text-dim">Desktop</div>
          </div>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-0.5">
      {TABS.map((tab) => {
        const active = activeTab === (tab.id as SidebarTab);
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => { setActiveTab(tab.id as SidebarTab); navigate(tab.path); }}
            className={clsx(
              'h-[32px] px-2.5 rounded text-[11.5px] font-medium transition-colors flex items-center gap-1.5',
              active
                ? 'bg-aegis-primary/10 text-aegis-text shadow-[inset_0_0_0_1px_rgb(var(--aegis-primary)/0.18)]'
                : 'text-aegis-text-muted hover:text-aegis-text hover:bg-aegis-hover/40',
            )}
          >
            <tab.Icon size={13} />
            {t(tab.labelKey, tab.labelFallback)}
          </button>
        );
      })}
      </div>
    </div>
  );
}
