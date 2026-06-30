// TabBar — 顶部标签导航
import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Bot, Wrench, Settings } from 'lucide-react';
import clsx from 'clsx';

const TABS = [
  { id: 'workbench', label: '工作台', path: '/', Icon: LayoutDashboard },
  { id: 'agents',    label: '智能体', path: '/agents', Icon: Bot },
  { id: 'tools',     label: '工具',   path: '/terminal', Icon: Wrench },
  { id: 'settings',  label: '设置',   path: '/settings', Icon: Settings },
];

export function TabBar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-0.5 h-[32px] shrink-0 chrome-bg border-b border-aegis-border pr-2" style={{ paddingLeft: 'var(--aegis-sidebar-expanded, 220px)' }}>
      {TABS.map((tab) => {
        const active = tab.path === '/'
          ? location.pathname === '/'
          : location.pathname.startsWith(tab.path);
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => navigate(tab.path)}
            className={clsx(
              'h-[26px] px-2.5 rounded text-[11.5px] font-medium transition-colors flex items-center gap-1.5',
              active
                ? 'bg-aegis-primary/10 text-aegis-text shadow-[inset_0_0_0_1px_rgb(var(--aegis-primary)/0.18)]'
                : 'text-aegis-text-muted hover:text-aegis-text hover:bg-aegis-hover/40',
            )}
          >
            <tab.Icon size={13} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
