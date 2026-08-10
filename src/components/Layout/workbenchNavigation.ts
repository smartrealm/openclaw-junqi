export type WorkbenchNavigationIcon = 'agents' | 'models' | 'channels' | 'cron';

export interface WorkbenchNavigationItem {
  readonly key: WorkbenchNavigationIcon;
  readonly to: string;
  readonly labelKey: string;
  readonly fallback: string;
}

export const WORKBENCH_NAVIGATION_ITEMS: readonly WorkbenchNavigationItem[] = [
  { key: 'agents', to: '/agents', labelKey: 'sidebar.nav.agents', fallback: '智能体' },
  { key: 'models', to: '/config?tab=providers', labelKey: 'sidebar.nav.models', fallback: '模型服务' },
  { key: 'channels', to: '/channels', labelKey: 'sidebar.nav.channels', fallback: '通道' },
  { key: 'cron', to: '/cron', labelKey: 'sidebar.nav.cron', fallback: '定时任务' },
];

export function isWorkbenchNavigationItemActive(
  item: WorkbenchNavigationItem,
  pathname: string,
  search: string,
): boolean {
  if (item.key === 'models') {
    return pathname === '/config' && new URLSearchParams(search).get('tab') === 'providers';
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
