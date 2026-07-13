// ═══════════════════════════════════════════════════════════
// AppLayout — Main layout with TitleBar + NavSidebar + Content
// + Ambient background glow (from conceptual design)
// ═══════════════════════════════════════════════════════════

import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { TopBar } from '@/components/Layout/TopBar';
import { TabBar } from '@/components/Layout/TabBar';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { useChatStore } from '@/stores/chatStore';
import { usePetStore } from '@/stores/petStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { getDirection } from '@/i18n';

/** Pages that work without Gateway connection */
const OFFLINE_PAGES = ['/settings', '/terminal', '/welcome', '/config', '/openclaw-commands'];
const CommandPalette = lazy(() => import('@/components/CommandPalette').then(m => ({ default: m.CommandPalette })));
const PetBreakOverlay = lazy(() => import('@/pet/PetBreakOverlay').then(m => ({ default: m.PetBreakOverlay })));
const OfflineOverlay = lazy(() => import('@/components/OfflineOverlay').then(m => ({ default: m.OfflineOverlay })));
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
  const { connected } = useChatStore();
  const isWorkspacePage = matchPath('/welcome', location.pathname) !== null;
  const isTerminalPage = matchPath('/terminal/*', location.pathname) !== null;
  const usesGlobalSidebar = !isWorkspacePage && !isTerminalPage;

  // Register global keyboard shortcuts
  useKeyboardShortcuts();

  // Show offline overlay on pages that need Gateway, when not connected.
  // A 600ms grace period prevents the overlay from flashing on brief
  // disconnect/reconnect cycles (e.g. when the user clicks "重连").
  const isOfflinePage = OFFLINE_PAGES.some((path) => matchPath(`${path}/*`, location.pathname) !== null);
  const wantsOffline = !connected && !isOfflinePage;
  const [showOffline, setShowOffline] = useState(false);
  useEffect(() => {
    if (!wantsOffline) { setShowOffline(false); return; }
    const t = setTimeout(() => setShowOffline(true), 600);
    return () => clearTimeout(t);
  }, [wantsOffline]);

  // The route viewport persists between tabs. Reset it before paint so the
  // scrollbar never renders at the previous page's position and then jumps.
  useLayoutEffect(() => {
    if (routeScrollRef.current) routeScrollRef.current.scrollTop = 0;
  }, [location.pathname]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-aegis-bg relative">
      {/* ── Ambient Background Glow (from conceptual JSX) ── */}
      <div className="ambient-glow-teal" />
      <div className="ambient-glow-purple" />

      {/* ── Custom window-chrome top bar ── */}
      <TopBar
        hideSidebarToggle={isWorkspacePage}
        sidebarTarget={isTerminalPage ? 'terminal' : 'app'}
      />

      {/* ── Navigation tabs ── */}
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
            className="route-scrollbar flex-1 overflow-y-auto h-full"
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
      {showOffline && (
        <div className="fixed inset-0 z-[9000] bg-aegis-bg/94 backdrop-blur-xl">
          <Suspense fallback={null}>
            <OfflineOverlay />
          </Suspense>
        </div>
      )}
      {/* Pomodoro break overlay — enlarged pet + countdown, only during break phase */}
      <LazyPetBreakOverlayHost />
      {/* Keep workspace utilities available at the bottom-right on every route. */}
      <Suspense fallback={<StatusBarFallback />}>
        <StatusBar />
      </Suspense>
      {/* Command Palette overlay */}
      <LazyCommandPaletteHost />
    </div>
  );
}
