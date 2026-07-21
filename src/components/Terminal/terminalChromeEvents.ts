import type { TerminalAgentId } from './terminalAgentCatalog';

export const TERMINAL_COMMAND_PALETTE_EVENT = 'junqi:open-terminal-command-palette';
export const TERMINAL_AGENT_PANEL_TOGGLE_EVENT = 'junqi:toggle-terminal-agent-panel';
export const TERMINAL_AGENT_LAUNCH_EVENT = 'junqi:launch-terminal-agent';

function requestTerminalChromeAction(type: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(type));
}

export function requestTerminalCommandPalette(): void {
  requestTerminalChromeAction(TERMINAL_COMMAND_PALETTE_EVENT);
}

export function requestTerminalAgentPanelToggle(): void {
  requestTerminalChromeAction(TERMINAL_AGENT_PANEL_TOGGLE_EVENT);
}

/** Ask the focused terminal pane to resolve and launch one real catalog row. */
export function requestTerminalLaunch(launcherId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<{ launcherId: string }>(TERMINAL_AGENT_LAUNCH_EVENT, {
    detail: { launcherId },
  }));
}

/** Backward-compatible builtin shortcut used by Ask Agent surfaces. */
export function requestTerminalAgentLaunch(agent: TerminalAgentId): void {
  requestTerminalLaunch(agent);
}
