import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { APP_PLATFORM } from '@/components/Terminal/platform';

// ═══════════════════════════════════════════════════════════
// 键盘快捷键：JunQi Desktop 全局快捷操作
// ═══════════════════════════════════════════════════════════

const NAV_ROUTES = ['/', '/chat', '/workshop', '/analytics', '/cron', '/agents', '/business-applications', '/settings'];

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

      // 输入控件聚焦时仍然生效。

      // Ctrl+K 和 Ctrl+P 打开命令面板。
      if (ctrl && (e.key === 'k' || e.key === 'p')) {
        // 终端面板使用 Cmd/Ctrl+P 展示工作区、目录和最近项目；Cmd/Ctrl+K 仍打开全局面板。
        if (e.key === 'p' && location.pathname === '/terminal') return;
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }

      // Ctrl+L 打开多行输入编辑器。
      if (ctrl && e.key === 'l') {
        // 仅在会话输入区接管多行编辑快捷键。
        const onComposerHost = location.pathname === '/chat';
        if (onComposerHost) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('aegis:open-multi-line-composer'));
          return;
        }
      }

      // Escape 关闭命令面板或模态界面。
      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
          e.preventDefault();
          return;
        }
        window.dispatchEvent(new CustomEvent('aegis:escape'));
        return;
      }

      // macOS 使用 Cmd+D 和 Cmd+Shift+D，避免与终端 EOF 冲突。
      // Windows 和 Linux 的 Ctrl+D 是 shell EOF，因此额外要求 Alt。
      // 该逻辑必须先于输入控件守卫执行，否则 xterm 的 textarea 会提前吞掉拆分快捷键。
      const onTerminalWorkspace = location.pathname === '/terminal';
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

      // 以下快捷键只在文本输入控件未聚焦时生效。
      if (isInput) return;

      // Ctrl+1 至 Ctrl+8 切换页面。
      if (ctrl && !shift) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 8 && NAV_ROUTES[num - 1]) {
          e.preventDefault();
          navigate(NAV_ROUTES[num - 1]);
          return;
        }
      }

      // Ctrl+, 打开设置。
      if (ctrl && e.key === ',') {
        e.preventDefault();
        navigate('/settings');
        return;
      }

      // Ctrl+N 新建会话；终端页面中则新建终端工作区。
      if (ctrl && e.key === 'n') {
        e.preventDefault();
        if (location.pathname === '/terminal') {
          window.dispatchEvent(new CustomEvent('junqi:new-terminal-workspace'));
          return;
        }
        navigate('/chat');
        return;
      }

      // Ctrl+O 在终端工作区打开项目目录。
      if (ctrl && e.key === 'o') {
        if (location.pathname === '/terminal') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('junqi:open-terminal-folder'));
          return;
        }
      }

      // Ctrl+W 关闭当前终端标签；窗格关闭属于结构操作，仍通过显式控件完成。
      if (ctrl && e.key === 'w' && !shift) {
        e.preventDefault();
        const wsPath = location.pathname;
        if (wsPath === '/terminal') {
          window.dispatchEvent(new CustomEvent('junqi:close-terminal-tab'));
          return;
        }
        if (activeSessionKey !== 'agent:main:main') {
          closeTab(activeSessionKey);
        }
        return;
      }

      // Ctrl+T 在当前聚焦窗格中新建终端标签。
      if (ctrl && e.key === 't' && !shift) {
        const wsPath = location.pathname;
        if (wsPath === '/terminal') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('junqi:new-terminal-tab'));
          return;
        }
      }

      // Ctrl+Shift+T 重新打开最近关闭的终端标签。
      // 当前窗格持有仅限本次运行的历史，并以相同标题和工作目录创建新的 PTY。
      if (ctrl && e.key === 't' && shift) {
        const wsPath = location.pathname;
        if (wsPath === '/terminal') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('junqi:reopen-terminal-tab'));
          return;
        }
      }

      // Ctrl+Shift+E 切换当前窗格缩放；Ctrl+E 保留给终端原生行尾编辑操作。
      if (ctrl && e.key === 'e' && shift) {
        const wsPath = location.pathname;
        if (wsPath === '/terminal') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('junqi:toggle-terminal-pane-zoom'));
          return;
        }
      }

      // Ctrl+Tab 和 Ctrl+Shift+Tab 循环切换标签。
      if (ctrl && e.key === 'Tab') {
        e.preventDefault();
        if (location.pathname === '/terminal') {
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
        if (location.pathname === '/terminal') {
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
