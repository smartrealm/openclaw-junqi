// ═══════════════════════════════════════════════════════════
// AppLayout：标题栏、导航侧栏与内容区的桌面外壳
// ═══════════════════════════════════════════════════════════

import { lazy, Suspense, useLayoutEffect, useRef } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import { TopBar } from '@/components/Layout/TopBar';
import { TabBar } from '@/components/Layout/TabBar';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { usePetStore } from '@/stores/petStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { getDirection } from '@/i18n';
import { BusinessGuide } from '@/components/BusinessGuide/BusinessGuide';

const CommandPalette = lazy(() => import('@/runtime/CommandPalette').then(m => ({ default: m.CommandPalette })));
const PetBreakOverlay = lazy(() => import('@/pet/PetBreakOverlay').then(m => ({ default: m.PetBreakOverlay })));
const NavSidebar = lazy(() => import('@/components/Layout/NavSidebar').then(m => ({ default: m.NavSidebar })));
const StatusBar = lazy(() => import('@/components/Layout/StatusBar').then(m => ({ default: m.StatusBar })));

function LazyCommandPaletteHost() {
  const open = useSettingsStore((s) => s.commandPaletteOpen);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette />
    </Suspense>
  );
}

function LazyPetBreakOverlayHost() {
  const shouldShow = usePetStore((s) => (
    s.enabled &&
    s.pomodoro.enabled &&
    s.pomodoro.running &&
    s.pomodoro.phase === 'break'
  ));
  if (!shouldShow) return null;
  return (
    <Suspense fallback={null}>
      <PetBreakOverlay />
    </Suspense>
  );
}

function SidebarFallback() {
  const sidebarMode = useSettingsStore((s) => s.sidebarMode);
  if (sidebarMode === 'hidden') return null;
  const width = sidebarMode === 'mini'
    ? 'var(--aegis-sidebar-mini)'
    : 'var(--aegis-sidebar-expanded)';
  return (
    <aside
      className="shrink-0 border-r border-aegis-border bg-aegis-surface sidebar-width-anim"
      style={{ width }}
      aria-hidden="true"
    />
  );
}

function StatusBarFallback() {
  return (
    <footer
      className="h-[26px] shrink-0 border-t border-aegis-border bg-aegis-surface"
      aria-hidden="true"
    />
  );
}

export function AppLayout() {
  const language = useSettingsStore((s) => s.language);
  const dir = getDirection(language);
  const location = useLocation();
  const routeScrollRef = useRef<HTMLDivElement>(null);
  const isWorkspacePage = matchPath('/welcome', location.pathname) !== null;
  const isTerminalPage = matchPath('/terminal/*', location.pathname) !== null;
  const isAgentWorkspacePage = matchPath('/ai-workspace/*', location.pathname) !== null;
  const usesGlobalSidebar = !isWorkspacePage;

  // 注册全局键盘快捷键。
  useKeyboardShortcuts();

  // 路由视口会跨标签保留，绘制前复位以避免滚动条先显示上一页位置再跳动。
  useLayoutEffect(() => {
    if (routeScrollRef.current) routeScrollRef.current.scrollTop = 0;
  }, [location.pathname]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-aegis-bg relative">
      {/* 自定义窗口标题栏 */}
      <TopBar
        hideSidebarToggle={isWorkspacePage}
        sidebarTarget={isTerminalPage ? 'terminal' : isAgentWorkspacePage ? 'agent-workspace' : 'app'}
      />

      {/* 导航标签栏 */}
      {!isWorkspacePage && <TabBar />}

      <div className="flex flex-1 min-h-0 relative z-[1]" dir={dir}>
        {usesGlobalSidebar && (
          <Suspense fallback={<SidebarFallback />}>
            <NavSidebar />
          </Suspense>
        )}
        <main className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
          <div
            ref={routeScrollRef}
            className={`route-scrollbar flex-1 h-full ${isTerminalPage || isAgentWorkspacePage ? 'overflow-hidden' : 'overflow-y-auto'}`}
            data-route-scroll
          >
            <BusinessGuide />
            <ErrorBoundary>
              <Suspense fallback={
                <div className="flex-1 flex items-center justify-center h-full">
                  <LoadingIndicator variant="dots" size={12} className="text-aegis-primary/60" />
                </div>
              }>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
      {/* 休息阶段才显示番茄钟覆盖层。 */}
      <LazyPetBreakOverlayHost />
      {/* 非终端路由保留右下角工作区工具。 */}
      {!isTerminalPage && (
        <Suspense fallback={<StatusBarFallback />}>
          <StatusBar />
        </Suspense>
      )}
      {/* 命令面板覆盖层 */}
      <LazyCommandPaletteHost />
    </div>
  );
}
