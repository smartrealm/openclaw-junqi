import type { TerminalSidebarMode } from './terminalWorkspaceTree';
import { createWorkspaceSidebarChannel } from '@/components/Layout/workspaceSidebarChannel';

const channel = createWorkspaceSidebarChannel('terminal');

export const TERMINAL_SIDEBAR_TOGGLE_EVENT = channel.toggleEvent;
export const TERMINAL_SIDEBAR_MODE_EVENT = channel.modeEvent;
export const TERMINAL_SIDEBAR_STORAGE_KEY = channel.storageKey;

export function readTerminalSidebarMode(): TerminalSidebarMode {
  return channel.read();
}

export function requestTerminalSidebarToggle(): void {
  channel.requestToggle();
}

export function publishTerminalSidebarMode(mode: TerminalSidebarMode): void {
  channel.publish(mode);
}
