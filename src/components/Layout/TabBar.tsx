// TabBar — 顶部标签导航
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import type { SidebarTab } from './tab-utils';
import { LayoutDashboard, Bot, Wrench, Settings } from 'lucide-react';
import clsx from 'clsx';
import junqiLogo from '@/assets/brand/junqi-logo-full-16x.png';

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
    <div className="flex items-center gap-0.5 h-[32px] shrink-0 chrome-bg border-b border-aegis-border pr-2 relative" style={{ paddingLeft: 'var(--aegis-sidebar-expanded, 220px)' }}>
      <div className="absolute inset-y-0 left-0 w-[var(--aegis-sidebar-expanded,220px)] flex items-center px-4 pointer-events-none">
        <img
          src={junqiLogo}
          alt="JunQi"
          className="h-[24px] max-w-[176px] object-contain object-left opacity-95"
          draggable={false}
        />
      </div>
      {TABS.map((tab) => {
        const active = activeTab === (tab.id as SidebarTab);
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => { setActiveTab(tab.id as SidebarTab); navigate(tab.path); }}
            className={clsx(
              'h-[26px] px-2.5 rounded text-[11.5px] font-medium transition-colors flex items-center gap-1.5',
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
  );
}
