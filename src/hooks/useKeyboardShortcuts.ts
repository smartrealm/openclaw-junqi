import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { APP_PLATFORM } from '@/components/Terminal/_nezha-platform';

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
        // Terminal owns Cmd/Ctrl+P because its palette includes workspaces,
        // folders, and recents. Cmd/Ctrl+K still opens the global palette.
        if (e.key === 'p' && location.pathname === '/terminal') return;
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }

      // Ctrl+L → Multi-line composer (kooky-style prompt editor)
      if (ctrl && e.key === 'l') {
        // Don't hijack if user is selecting text outside chat/agent contexts.
        const onComposerHost = location.pathname === '/chat'
          || location.pathname === '/agent-run'
          || location.pathname === '/ai-workspace';
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

      // Kooky uses Cmd+D / Cmd+Shift+D, which macOS does not pass through as
      // terminal EOF. On Windows and Linux, Ctrl+D is shell EOF, so require
      // Alt as the platform-safe equivalent. Handle this before the input
      // guard: xterm owns a textarea and used to swallow the advertised split
      // shortcut before the workspace store saw it.
      const onTerminalWorkspace = location.pathname === '/terminal' || location.pathname === '/agent-run';
      const splitModifier = APP_PLATFORM === 'macos'
        ? e.metaKey && !e.ctrlKey && !e.altKey
        : e.ctrlKey && e.altKey && !e.metaKey;
      if (onTerminalWorkspace && splitModifier && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const direction = e.shiftKey ? 'vertical' : 'horizontal';
        import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
          const { workspaces, activeWorkspaceId, splitPane } = useWorkspaceStore.getState();
          const workspace = workspaces.find((candidate) => candidate.id === activeWorkspaceId);
          if (workspace?.focusedPaneId) {
            splitPane(workspace.focusedPaneId, direction);
          }
        });
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
        if (location.pathname === '/terminal' || location.pathname === '/agent-run') {
          window.dispatchEvent(new CustomEvent('junqi:new-terminal-workspace'));
          return;
        }
        navigate('/chat');
        return;
      }

      // Ctrl+O → Open a project directory in the terminal workspace.
      if (ctrl && e.key === 'o') {
        if (location.pathname === '/terminal' || location.pathname === '/agent-run') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('junqi:open-terminal-folder'));
          return;
        }
      }

      // Ctrl+W → close the current terminal tab (kooky ⌘W). Closing a pane
      // is structural and remains behind an explicit pane control.
      if (ctrl && e.key === 'w' && !shift) {
        e.preventDefault();
        const wsPath = location.pathname;
        if (wsPath === '/terminal' || wsPath === '/agent-run') {
          window.dispatchEvent(new CustomEvent('junqi:close-terminal-tab'));
          return;
        }
        if (activeSessionKey !== 'agent:main:main') {
          closeTab(activeSessionKey);
        }
        return;
      }

      // Ctrl+T → New terminal tab in the focused pane (kooky ⌘T).
      if (ctrl && e.key === 't' && !shift) {
        const wsPath = location.pathname;
        if (wsPath === '/terminal' || wsPath === '/agent-run') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('junqi:new-terminal-tab'));
          return;
        }
      }

      // Ctrl+Shift+T → Reopen the last closed terminal tab. The focused pane
      // claims this runtime-only history and spawns a fresh PTY with the same
      // title and cwd, matching Kooky's reopen fallback semantics.
      if (ctrl && e.key === 't' && shift) {
        const wsPath = location.pathname;
        if (wsPath === '/terminal' || wsPath === '/agent-run') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('junqi:reopen-terminal-tab'));
          return;
        }
      }

      // Ctrl+Shift+E → toggle the focused pane's zoom (kooky ⌘⇧E).
      // Plain Ctrl+E remains available to the terminal as its native
      // line-end editing shortcut.
      if (ctrl && e.key === 'e' && shift) {
        const wsPath = location.pathname;
        if (wsPath === '/terminal' || wsPath === '/agent-run') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('junqi:toggle-terminal-pane-zoom'));
          return;
        }
      }

      // Ctrl+Tab / Ctrl+Shift+Tab → Cycle tabs
      if (ctrl && e.key === 'Tab') {
        e.preventDefault();
        if (location.pathname === '/terminal' || location.pathname === '/agent-run') {
          window.dispatchEvent(new CustomEvent('junqi:cycle-terminal-tab', {
            detail: { direction: shift ? -1 : 1 },
          }));
          return;
        }
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
      if (ctrl && e.key === 'r' && !shift) {
        e.preventDefault();
        if (location.pathname === '/terminal' || location.pathname === '/agent-run') {
          window.dispatchEvent(new CustomEvent('junqi:rename-terminal-tab'));
          return;
        }
        window.dispatchEvent(new CustomEvent('aegis:refresh'));
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, setCommandPaletteOpen, commandPaletteOpen, openTabs, activeSessionKey, openTab, closeTab]);
}
