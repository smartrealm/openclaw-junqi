// Tab resolution — shared between TabBar and NavSidebar.
export type SidebarTab = 'workbench' | 'agents' | 'tools' | 'commands' | 'settings';

const TAB_ROUTE_MAP: [SidebarTab, string[]][] = [
  ['workbench', ['/', '/chat', '/welcome', '/session']],
  ['agents',    ['/agents', '/agent-run', '/agents/live', '/channels', '/memory', '/config', '/sessions', '/skills', '/skill-hub']],
  ['commands',  ['/openclaw-commands']],
  ['tools',     ['/terminal', '/files', '/cron', '/sandbox', '/git', '/calendar', '/tools', '/kanban', '/timeline', '/workshop', '/ai-workspace']],
  ['settings',  ['/settings', '/logs', '/perf', '/analytics', '/ui-showcase']],
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
