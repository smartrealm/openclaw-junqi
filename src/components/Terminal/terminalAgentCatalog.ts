/**
 * Kooky-compatible terminal agent catalog.
 *
 * These entries describe real local CLI executables launched through a PTY.
 * The Rust CLI detector remains the authority for whether one is available.
 */
export const TERMINAL_AGENT_LAUNCHERS = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'amp', label: 'Amp', promptFlag: '-x' },
  { id: 'cursor-agent', label: 'Cursor CLI' },
  { id: 'copilot', label: 'Copilot CLI', promptFlag: '-p' },
  { id: 'grok', label: 'Grok Build' },
  { id: 'agy', label: 'Antigravity CLI', promptFlag: '-i' },
  { id: 'kimi', label: 'Kimi Code', promptFlag: '-p' },
  { id: 'pi', label: 'Pi', promptFlag: '-p' },
  { id: 'kiro-cli', label: 'Kiro CLI' },
  { id: 'droid', label: 'Droid' },
] as const;

export type TerminalAgentId = (typeof TERMINAL_AGENT_LAUNCHERS)[number]['id'];
export type TerminalAgentLauncher = (typeof TERMINAL_AGENT_LAUNCHERS)[number];

const launcherById = new Map<string, TerminalAgentLauncher>(
  TERMINAL_AGENT_LAUNCHERS.map((launcher) => [launcher.id, launcher]),
);

export const TERMINAL_AGENT_LAUNCHER_IDS = new Set<string>(launcherById.keys());

export function isTerminalAgentId(value: string): value is TerminalAgentId {
  return launcherById.has(value);
}

export function terminalAgentLauncher(agent: TerminalAgentId): TerminalAgentLauncher {
  return launcherById.get(agent)!;
}

/** Quote a terminal selection as a single argument for the active shell. */
export function quoteTerminalAgentPrompt(prompt: string, platform: 'windows' | 'posix'): string {
  if (platform === 'windows') return `'${prompt.replace(/'/g, "''")}'`;
  return `'${prompt.replace(/'/g, "'\"'\"'")}'`;
}

/**
 * Match Kooky's `AgentTemplate.launchCommand(initialPrompt:)` behavior.
 * Positional-prompt CLIs receive `--` first, protecting selected output that
 * begins with a dash from being parsed as a CLI option.
 */
export function terminalAgentLaunchCommand(
  agent: TerminalAgentId,
  prompt: string,
  platform: 'windows' | 'posix',
): string {
  const launcher = terminalAgentLauncher(agent);
  const quoted = quoteTerminalAgentPrompt(prompt, platform);
  const promptFlag = 'promptFlag' in launcher ? launcher.promptFlag : undefined;
  return promptFlag
    ? `${launcher.id} ${promptFlag} ${quoted}`
    : `${launcher.id} -- ${quoted}`;
}
