import type { TerminalSidebarMode } from './terminalWorkspaceTree';

export const TERMINAL_SIDEBAR_TOGGLE_EVENT = 'junqi:toggle-terminal-sidebar';
export const TERMINAL_SIDEBAR_MODE_EVENT = 'junqi:terminal-sidebar-mode';
export const TERMINAL_SIDEBAR_STORAGE_KEY = 'junqi:terminal-sidebar-mode';

export function readTerminalSidebarMode(): TerminalSidebarMode {
  try {
    const saved = localStorage.getItem(TERMINAL_SIDEBAR_STORAGE_KEY);
    return saved === 'full' || saved === 'compact' || saved === 'hidden' ? saved : 'full';
  } catch {
    return 'full';
  }
}

export function requestTerminalSidebarToggle(): void {
  window.dispatchEvent(new Event(TERMINAL_SIDEBAR_TOGGLE_EVENT));
}

export function publishTerminalSidebarMode(mode: TerminalSidebarMode): void {
  window.dispatchEvent(new CustomEvent<TerminalSidebarMode>(TERMINAL_SIDEBAR_MODE_EVENT, { detail: mode }));
}
