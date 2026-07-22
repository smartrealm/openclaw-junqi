import {
  terminalAgentLauncher,
  type TerminalAgentId,
} from './terminalAgentCatalog';
import {
  terminalCustomAgentCommand,
  terminalCustomAgentDisplayTitle,
  visibleTerminalCustomAgents,
  type TerminalCustomAgentPreferencesSnapshot,
} from './terminalCustomAgents';
import {
  visibleTerminalAgentIds,
  type TerminalAgentPreferencesSnapshot,
} from './terminalAgentPreferences';
import {
  terminalPresetDisplayTitle,
  visibleTerminalPresets,
  type TerminalPresetPreferencesSnapshot,
} from './terminalPresets';

export type TerminalLaunchTarget =
  | { kind: 'terminal'; id: 'terminal'; label: string }
  | { kind: 'preset'; id: string; label: string; path: string }
  | { kind: 'agent'; id: string; label: string; command: string; iconAgent?: TerminalAgentId };

export interface TerminalLaunchCatalogInput {
  availableAgentIds: ReadonlySet<TerminalAgentId>;
  agentPreferences: TerminalAgentPreferencesSnapshot;
  presetPreferences: TerminalPresetPreferencesSnapshot;
  customAgentPreferences: TerminalCustomAgentPreferencesSnapshot;
  platform: 'windows' | 'posix';
}

/**
 * One source of truth for every launcher surface. Keeping the order here
 * prevents the `+` menu, command palette, and default action from drifting.
 */
export function buildTerminalLaunchTargets(input: TerminalLaunchCatalogInput): readonly TerminalLaunchTarget[] {
  const targets: TerminalLaunchTarget[] = [{ kind: 'terminal', id: 'terminal', label: 'Terminal' }];

  for (const preset of visibleTerminalPresets(input.presetPreferences)) {
    targets.push({
      kind: 'preset',
      id: preset.id,
      label: terminalPresetDisplayTitle(preset),
      path: preset.path,
    });
  }

  for (const agentId of visibleTerminalAgentIds(input.agentPreferences)) {
    if (!input.availableAgentIds.has(agentId)) continue;
    const agent = terminalAgentLauncher(agentId);
    targets.push({ kind: 'agent', id: agent.id, label: agent.label, command: agent.id, iconAgent: agent.id });
  }

  for (const custom of visibleTerminalCustomAgents(input.customAgentPreferences)) {
    const command = terminalCustomAgentCommand(custom, input.platform);
    if (!command) continue;
    // An inherited blank command is only valid when its actual base binary is
    // on PATH. A custom direct command is intentional user input and executes
    // in the PTY exactly as entered, matching Kooky's behavior.
    if (!custom.command.trim() && custom.baseAgentId && !input.availableAgentIds.has(custom.baseAgentId)) continue;
    targets.push({
      kind: 'agent',
      id: custom.id,
      label: terminalCustomAgentDisplayTitle(custom),
      command,
      ...(custom.baseAgentId ? { iconAgent: custom.baseAgentId } : {}),
    });
  }

  return Object.freeze(targets);
}

export function findTerminalLaunchTarget(
  id: string | null | undefined,
  targets: readonly TerminalLaunchTarget[],
): TerminalLaunchTarget | null {
  if (!id) return null;
  return targets.find((target) => target.id === id) ?? null;
}
