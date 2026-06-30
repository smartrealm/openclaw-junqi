import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';

// ═══════════════════════════════════════════════════════════
// Keyboard Shortcuts — Global hotkeys for OpenClaw Desktop
// ═══════════════════════════════════════════════════════════

const NAV_ROUTES = ['/', '/chat', '/workshop', '/analytics', '/cron', '/agents', '/memory', '/settings'];

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const { setCommandPaletteOpen, commandPaletteOpen } = useSettingsStore();
  const { openTabs, activeSessionKey, openTab, closeTab } = useChatStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

      // ── Always active (even in inputs) ──

      // Ctrl+K / Ctrl+P → Command Palette (kooky-style ⌘P, plus ⌘K alias)
      if (ctrl && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }

      // Ctrl+L → Multi-line composer (kooky-style prompt editor)
      if (ctrl && e.key === 'l') {
        // Don't hijack if user is selecting text outside chat/agent contexts.
        const onComposerHost = location.pathname === '/chat' || location.pathname === '/agent-run';
        if (onComposerHost) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('aegis:open-multi-line-composer'));
          return;
        }
      }

      // Escape → close palette / modals
      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
          e.preventDefault();
          return;
        }
        window.dispatchEvent(new CustomEvent('aegis:escape'));
        return;
      }

      // ── Only when NOT in text inputs ──
      if (isInput) return;

      // Ctrl+1-8 → Navigate pages
      if (ctrl && !shift) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 8 && NAV_ROUTES[num - 1]) {
          e.preventDefault();
          navigate(NAV_ROUTES[num - 1]);
          return;
        }
      }

      // Ctrl+, → Settings
      if (ctrl && e.key === ',') {
        e.preventDefault();
        navigate('/settings');
        return;
      }

      // Ctrl+N → New chat tab (navigate to chat + open picker)
      if (ctrl && e.key === 'n') {
        e.preventDefault();
        navigate('/chat');
        return;
      }

      // Ctrl+W → Close current chat tab OR close focused pane (kooky-style)
      if (ctrl && e.key === 'w') {
        e.preventDefault();
        // Workspace-mode: close the focused pane
        const wsPath = location.pathname;
        if (wsPath === '/terminal' || wsPath === '/agent-run') {
          // Lazy import to keep this hook lean
          import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
            const { workspaces, activeWorkspaceId, closePane } = useWorkspaceStore.getState();
            const ws = workspaces.find((w: { id: string }) => w.id === activeWorkspaceId);
            if (ws?.focusedPaneId) closePane(ws.focusedPaneId);
          });
          return;
        }
        if (activeSessionKey !== 'agent:main:main') {
          closeTab(activeSessionKey);
        }
        return;
      }

      // Ctrl+D / Ctrl+Shift+D → Split focused pane (kooky ⌘D / ⌘⇧D)
      if (ctrl && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        const wsPath = location.pathname;
        if (wsPath === '/terminal' || wsPath === '/agent-run') {
          import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
            const { workspaces, activeWorkspaceId, splitPane } = useWorkspaceStore.getState();
            const ws = workspaces.find((w: { id: string }) => w.id === activeWorkspaceId);
            if (ws?.focusedPaneId) {
              splitPane(ws.focusedPaneId, shift ? 'vertical' : 'horizontal');
            }
          });
          return;
        }
      }

      // Ctrl+T → New shell pane in current workspace (kooky ⌘T)
      if (ctrl && e.key === 't' && !shift) {
        const wsPath = location.pathname;
        if (wsPath === '/terminal' || wsPath === '/agent-run') {
          e.preventDefault();
          import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
            useWorkspaceStore.getState().addShellPane();
          });
          return;
        }
      }

      // Ctrl+E → New agent pane in current workspace (kooky ⌘E)
      if (ctrl && e.key === 'e' && !shift) {
        const wsPath = location.pathname;
        if (wsPath === '/terminal' || wsPath === '/agent-run') {
          e.preventDefault();
          import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
            useWorkspaceStore.getState().addAgentPane('claude');
          });
          return;
        }
      }

      // Ctrl+Tab / Ctrl+Shift+Tab → Cycle tabs
      if (ctrl && e.key === 'Tab') {
        e.preventDefault();
        const idx = openTabs.indexOf(activeSessionKey);
        if (shift) {
          const prev = idx > 0 ? openTabs[idx - 1] : openTabs[openTabs.length - 1];
          openTab(prev);
        } else {
          const next = idx < openTabs.length - 1 ? openTabs[idx + 1] : openTabs[0];
          openTab(next);
        }
        return;
      }

      // Ctrl+R → Refresh
      if (ctrl && e.key === 'r') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('aegis:refresh'));
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, setCommandPaletteOpen, commandPaletteOpen, openTabs, activeSessionKey, openTab, closeTab]);
}
