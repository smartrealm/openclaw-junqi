// ═══════════════════════════════════════════════════════════
// AppLayout — Main layout with TitleBar + NavSidebar + Content
// + Ambient background glow (from conceptual design)
// ═══════════════════════════════════════════════════════════

import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { TopBar } from '@/components/Layout/TopBar';
import { NavSidebar } from '@/components/Layout/NavSidebar';
import { TabBar } from '@/components/Layout/TabBar';
import { StatusBar } from '@/components/Layout/StatusBar';
import { CommandPalette } from '@/components/CommandPalette';
import { OfflineOverlay } from '@/components/OfflineOverlay';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { getDirection } from '@/i18n';

/** Pages that work without Gateway connection */
const OFFLINE_PAGES = ['/settings', '/terminal', '/config'];

export function AppLayout() {
  const { language } = useSettingsStore();
  const dir = getDirection(language);
  const location = useLocation();
  const { connected } = useChatStore();

  // Register global keyboard shortcuts
  useKeyboardShortcuts();

  // Show offline overlay on pages that need Gateway, when not connected
  const isOfflinePage = OFFLINE_PAGES.some(p => location.pathname === p || location.pathname.startsWith(p + '/'));
  const showOffline = !connected && !isOfflinePage;

  return (
    <TooltipProvider delayDuration={150}>
    <div className="h-screen flex flex-col overflow-hidden bg-aegis-bg relative">
      {/* ── Ambient Background Glow (from conceptual JSX) ── */}
      <div className="ambient-glow-teal" />
      <div className="ambient-glow-purple" />

      {/* ── Custom window-chrome top bar ── */}
      <TopBar />

      {/* ── Navigation tabs ── */}
      <TabBar />

      <div className="flex flex-1 min-h-0 relative z-[1]" dir={dir}>
        <NavSidebar />
        <main className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
          <div className="flex-1 overflow-y-auto scrollbar-thin h-full">
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
          <OfflineOverlay />
        </div>
      )}
      {/* Bottom status bar — gateway / model / restart */}
      <StatusBar />
      {/* Command Palette overlay */}
      <CommandPalette />
    </div>
    </TooltipProvider>
  );
}
