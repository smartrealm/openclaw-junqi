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

/** Ask the focused terminal pane to create an actual local CLI tab. */
export function requestTerminalAgentLaunch(agent: TerminalAgentId): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<{ agent: TerminalAgentId }>(TERMINAL_AGENT_LAUNCH_EVENT, {
    detail: { agent },
  }));
}
