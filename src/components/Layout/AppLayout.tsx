// ═══════════════════════════════════════════════════════════
// AppLayout — Main layout with TitleBar + NavSidebar + Content
// + Ambient background glow (from conceptual design)
// ═══════════════════════════════════════════════════════════

import { lazy, Suspense, useLayoutEffect, useRef } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { TopBar } from '@/components/Layout/TopBar';
import { TabBar } from '@/components/Layout/TabBar';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { usePetStore } from '@/stores/petStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { getDirection } from '@/i18n';

const CommandPalette = lazy(() => import('@/components/CommandPalette').then(m => ({ default: m.CommandPalette })));
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

function SidebarFallback({ presentation = 'default' }: { presentation?: 'default' | 'terminal-rail' }) {
  const sidebarMode = useSettingsStore((s) => s.sidebarMode);
  const effectiveMode = presentation === 'terminal-rail' ? 'mini' : sidebarMode;
  if (effectiveMode === 'hidden') return null;
  const width = effectiveMode === 'mini'
    ? 'var(--aegis-sidebar-mini)'
    : 'var(--aegis-sidebar-expanded)';
  return (
    <aside
      className="shrink-0 border-r border-aegis-border sidebar-width-anim"
      style={{
        width,
        background: 'linear-gradient(180deg, var(--aegis-surface), var(--aegis-surface-elevated))',
      }}
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
  const usesGlobalSidebar = !isWorkspacePage && !isAgentWorkspacePage;
  // Settings already lives in the product shell, and terminal now retains a
  // compact JunQi rail. Neither needs browser-like back chrome near the macOS
  // traffic lights; only the dedicated agent workspace is a drill-in route.
  const showRouteBack = isAgentWorkspacePage;
  const routeBackFallback = '/tools';

  // Register global keyboard shortcuts
  useKeyboardShortcuts();

  // The route viewport persists between tabs. Reset it before paint so the
  // scrollbar never renders at the previous page's position and then jumps.
  useLayoutEffect(() => {
    if (routeScrollRef.current) routeScrollRef.current.scrollTop = 0;
  }, [location.pathname]);

  return (
    <div className={`h-screen flex flex-col overflow-hidden bg-aegis-bg relative${isTerminalPage ? ' terminal-kooky-app' : ''}`}>
      {/* ── Ambient Background Glow (from conceptual JSX) ── */}
      {!isTerminalPage && <div className="ambient-glow-teal" />}
      {!isTerminalPage && <div className="ambient-glow-purple" />}

      {/* ── Custom window-chrome top bar ── */}
      <TopBar
        hideSidebarToggle={isWorkspacePage}
        sidebarTarget={isTerminalPage ? 'terminal' : isAgentWorkspacePage ? 'agent-workspace' : 'app'}
        showBack={showRouteBack}
        backFallback={routeBackFallback}
      />

      {/* ── Navigation tabs ── */}
      {!isWorkspacePage && !isTerminalPage && <TabBar />}

      <div className="flex flex-1 min-h-0 relative z-[1]" dir={dir}>
        {usesGlobalSidebar && (
          <Suspense fallback={<SidebarFallback presentation={isTerminalPage ? 'terminal-rail' : 'default'} />}>
            <NavSidebar presentation={isTerminalPage ? 'terminal-rail' : 'default'} />
          </Suspense>
        )}
        <main className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
          <div
            ref={routeScrollRef}
            className={`route-scrollbar flex-1 h-full ${isTerminalPage || isAgentWorkspacePage ? 'overflow-hidden' : 'overflow-y-auto'}`}
            data-route-scroll
          >
            <ErrorBoundary>
              <Suspense fallback={
                <div className="flex-1 flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-aegis-primary/50" />
                </div>
              }>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
      {/* Pomodoro break overlay — enlarged pet + countdown, only during break phase */}
      <LazyPetBreakOverlayHost />
      {/* Keep workspace utilities available at the bottom-right on every route. */}
      {!isTerminalPage && (
        <Suspense fallback={<StatusBarFallback />}>
          <StatusBar />
        </Suspense>
      )}
      {/* Command Palette overlay */}
      <LazyCommandPaletteHost />
    </div>
  );
}
