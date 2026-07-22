import type { TerminalAgentId } from './terminalAgentCatalog';

export const TERMINAL_COMMAND_PALETTE_EVENT = 'junqi:open-terminal-command-palette';
export const TERMINAL_AGENT_PANEL_TOGGLE_EVENT = 'junqi:toggle-terminal-agent-panel';
export const TERMINAL_AGENT_LAUNCH_EVENT = 'junqi:launch-terminal-agent';
export const TERMINAL_FILE_TREE_REVEAL_EVENT = 'junqi:reveal-terminal-file-tree';
export const TERMINAL_PASTE_INPUT_EVENT = 'junqi:paste-terminal-input';

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

/** Ask the workbench to reveal the repository tree behind a terminal pane. */
export function requestTerminalFileTreeReveal(repositoryRoot?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<{ repositoryRoot?: string }>(TERMINAL_FILE_TREE_REVEAL_EVENT, {
    detail: { repositoryRoot },
  }));
}

/** Deliver trusted, already-formatted input to the currently focused pane. */
export function requestTerminalInput(input: string): void {
  if (typeof window === 'undefined' || !input) return;
  window.dispatchEvent(new CustomEvent<{ input: string }>(TERMINAL_PASTE_INPUT_EVENT, {
    detail: { input },
  }));
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
