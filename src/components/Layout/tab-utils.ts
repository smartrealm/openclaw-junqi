// 顶层标签归属由 TabBar 与 NavSidebar 共用，查询参数属于路由语义的一部分。
export type SidebarTab = 'workbench' | 'agents' | 'businessApplications' | 'tools' | 'commands' | 'settings';

const TAB_ROUTE_MAP: [SidebarTab, string[]][] = [
  ['workbench', ['/', '/chat', '/welcome', '/session']],
  ['agents',    ['/agents', '/agents/live', '/channels', '/memory', '/config', '/sessions', '/skills', '/skill-hub']],
  ['businessApplications', ['/business-applications']],
  ['commands',  ['/openclaw-commands']],
  ['tools',     ['/terminal', '/files', '/cron', '/sandbox', '/git', '/calendar', '/tools', '/kanban', '/timeline', '/activity', '/workshop']],
  ['settings',  ['/settings', '/logs', '/perf', '/analytics']],
];

const CACHE = new Map<string, SidebarTab>();

export function resolveTab(locationPath: string): SidebarTab {
  const cached = CACHE.get(locationPath);
  if (cached) return cached;
  const [pathname, query = ''] = locationPath.split('?', 2);
  if (pathname === '/config' && new URLSearchParams(query).get('tab') === 'tools') {
    CACHE.set(locationPath, 'tools');
    return 'tools';
  }
  for (const [tab, prefixes] of TAB_ROUTE_MAP) {
    for (const prefix of prefixes) {
      if (prefix === '/') {
        if (pathname === '/') { CACHE.set(locationPath, tab); return tab; }
        continue;
      }
      if (pathname.startsWith(prefix)) { CACHE.set(locationPath, tab); return tab; }
    }
  }
  CACHE.set(locationPath, 'settings');
  return 'settings';
}

export function tabActive(pathname: string, tab: SidebarTab): boolean {
  return resolveTab(pathname) === tab;
}
