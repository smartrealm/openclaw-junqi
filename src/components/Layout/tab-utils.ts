// Tab resolution — shared between TabBar and NavSidebar.
export type SidebarTab = 'workbench' | 'agents' | 'tools' | 'settings';

const TAB_ROUTE_MAP: [SidebarTab, string[]][] = [
  ['workbench', ['/', '/chat', '/kanban', '/workshop', '/timeline', '/welcome']],
  ['agents',    ['/agents', '/agent-run', '/memory']],
  ['tools',     ['/terminal', '/files', '/cron', '/sandbox', '/git', '/calendar', '/tools']],
  ['settings',  ['/settings', '/config', '/logs', '/perf', '/sessions', '/skills', '/analytics', '/skill-hub', '/ui-showcase']],
];

const CACHE = new Map<string, SidebarTab>();

export function resolveTab(pathname: string): SidebarTab {
  const cached = CACHE.get(pathname);
  if (cached) return cached;
  for (const [tab, prefixes] of TAB_ROUTE_MAP) {
    for (const prefix of prefixes) {
      if (prefix === '/') {
        if (pathname === '/') { CACHE.set(pathname, tab); return tab; }
        continue;
      }
      if (pathname.startsWith(prefix)) { CACHE.set(pathname, tab); return tab; }
    }
  }
  CACHE.set(pathname, 'settings');
  return 'settings';
}

export function tabActive(pathname: string, tab: SidebarTab): boolean {
  return resolveTab(pathname) === tab;
}
