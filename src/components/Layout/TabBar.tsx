// TabBar — 顶部标签导航
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import type { SidebarTab } from './tab-utils';
import { LayoutDashboard, BookOpenText, Bot, Blocks, Wrench, Settings } from 'lucide-react';
import clsx from 'clsx';
import { JunQiLogo } from '@/components/shared/JunQiLogo';
import { ActiveTabIndicator } from '@/components/shared/TabMotion';

const TABS = [
  { id: 'workbench', labelKey: 'nav.dashboard', labelFallback: '仪表盘', path: '/', Icon: LayoutDashboard },
  { id: 'agents',    labelKey: 'nav.agents',     labelFallback: '智能体', path: '/agents', Icon: Bot },
  { id: 'businessApplications', labelKey: 'nav.businessApplications', labelFallback: '业务应用', path: '/business-applications', Icon: Blocks },
  { id: 'tools',     labelKey: 'nav.tools',      labelFallback: '工具',   path: '/tools', Icon: Wrench },
  { id: 'commands',  labelKey: 'nav.openclawCommands', labelFallback: 'OpenClaw commands', path: '/openclaw-commands', Icon: BookOpenText },
  { id: 'settings',  labelKey: 'nav.settings',   labelFallback: '设置',   path: '/settings', Icon: Settings },
] as const;

export function TabBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const activeTab = useSettingsStore((s) => s.activeSidebarTab);
  const setActiveTab = useSettingsStore((s) => s.setActiveSidebarTab);

  return (
    <div className="flex h-[44px] shrink-0 items-center gap-0.5 chrome-bg border-b border-aegis-border pr-2 relative" style={{ paddingLeft: 'var(--aegis-sidebar-expanded, 204px)' }}>
      <div className="absolute inset-y-0 left-0 w-[var(--aegis-sidebar-expanded,204px)] flex items-center px-2.5 pointer-events-none overflow-hidden">
        <JunQiLogo variant="lockup" className="h-[38px] w-full" title="陕西浚启智境科技有限公司" />
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
                'relative isolate h-[32px] whitespace-nowrap px-2.5 rounded text-[11.5px] font-medium flex items-center gap-1.5',
                'transition-[color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]',
                active
                  ? 'text-aegis-text'
                  : 'text-aegis-text-muted hover:text-aegis-text hover:bg-aegis-hover/40',
              )}
            >
              {active && (
                <ActiveTabIndicator
                  layoutId="product-navigation-active-tab"
                  className="inset-0 -z-10 rounded bg-aegis-primary/10 shadow-[inset_0_0_0_1px_rgb(var(--aegis-primary)/0.18)]"
                />
              )}
              <tab.Icon size={13} className="relative z-[1]" />
              <span className="relative z-[1]">{t(tab.labelKey, tab.labelFallback)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
