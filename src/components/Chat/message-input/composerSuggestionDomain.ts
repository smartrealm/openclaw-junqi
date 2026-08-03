import type { SlashCommand } from '@/data/slashCommands';
import type { OpenClawCommandEntry } from '@/services/gateway/OpenClawCommandsClient';

export interface GatewaySkill {
  name: string;
  description?: string;
}

export type MentionItem =
  | { kind: 'skill'; name: string; description?: string }
  | { kind: 'file'; name: string; path: string };

export interface ArgumentCompletion {
  value: string;
  label: string;
}

export interface ComposerMessage {
  role: string;
  content: unknown;
}

/** Converts only Gateway-advertised text aliases into composer suggestions. */
export function toComposerSlashCommands(commands: readonly OpenClawCommandEntry[]): SlashCommand[] {
  const seen = new Set<string>();
  const suggestions: SlashCommand[] = [];
  for (const command of commands) {
    if (command.scope === 'native') continue;
    for (const alias of command.textAliases ?? []) {
      if (!alias.startsWith('/') || seen.has(alias)) continue;
      seen.add(alias);
      suggestions.push({
        cmd: alias,
        description: command.description,
        category: command.category ?? 'uncategorized',
        source: command.source,
        scope: command.scope,
        acceptsArgs: command.acceptsArgs,
        ...(command.args ? { args: command.args } : {}),
      });
    }
  }
  return suggestions;
}

export function parseGatewaySkills(value: unknown): GatewaySkill[] {
  if (!value || typeof value !== 'object' || !('skills' in value) || !Array.isArray(value.skills)) return [];
  return value.skills.flatMap((skill) => {
    if (!skill || typeof skill !== 'object') return [];
    const record = skill as Record<string, unknown>;
    if (
      record.userInvocable !== true
      || record.eligible !== true
      || record.disabled === true
      || typeof record.name !== 'string'
    ) return [];
    return [{
      name: record.name,
      description: typeof record.description === 'string' ? record.description : undefined,
    }];
  });
}

export function filterSlashCommands(query: string, commands: readonly SlashCommand[]): SlashCommand[] {
  const normalized = query.toLowerCase();
  return commands.filter((command) => (
    !normalized
    || command.cmd.toLowerCase().includes(normalized)
    || command.description.toLowerCase().includes(normalized)
  )).slice(0, 12);
}

export function groupSlashCommands(commands: readonly SlashCommand[]) {
  const groups = new Map<string, SlashCommand[]>();
  for (const command of commands) {
    const group = groups.get(command.category);
    if (group) group.push(command);
    else groups.set(command.category, [command]);
  }
  return {
    order: [...groups.keys()],
    groups: Object.fromEntries(groups),
  };
}

export function buildMentionItems(
  query: string,
  skills: readonly GatewaySkill[],
  files: readonly { name: string; path: string }[],
): MentionItem[] {
  const normalized = query.toLowerCase();
  const skillMatches: MentionItem[] = skills
    .filter((skill) => !normalized || skill.name.toLowerCase().includes(normalized) || skill.description?.toLowerCase().includes(normalized))
    .slice(0, 8)
    .map((skill) => ({ kind: 'skill', ...skill }));
  const fileMatches: MentionItem[] = files
    .filter((file) => !normalized || file.name.toLowerCase().includes(normalized) || file.path.toLowerCase().includes(normalized))
    .slice(0, 8)
    .map((file) => ({ kind: 'file', ...file }));
  return [...skillMatches, ...fileMatches];
}

export function buildArgumentCompletions(
  commandName: string,
  query: string,
  commands: readonly SlashCommand[],
  argumentIndex: number,
): ArgumentCompletion[] {
  const normalized = query.toLowerCase();
  const argument = commands.find((candidate) => candidate.cmd === commandName)?.args?.[argumentIndex];
  if (argument?.dynamic === true) return [];
  return (argument?.choices ?? [])
    .filter((choice) => !normalized || choice.value.toLowerCase().includes(normalized) || choice.label.toLowerCase().includes(normalized))
    .slice(0, 12)
    .map((choice) => ({ value: choice.value, label: choice.label }));
}

/** Replaces only the active declared argument, preserving arguments before it. */
export function replaceCommandArgumentCompletion(params: {
  readonly text: string;
  readonly cursor: number;
  readonly command: string;
  readonly argumentIndex: number;
  readonly value: string;
}): string | null {
  const before = params.text.slice(0, params.cursor);
  const after = params.text.slice(params.cursor);
  const commandStart = before.lastIndexOf(params.command);
  if (commandStart < 0) return null;
  const commandInput = before.slice(commandStart).trimStart().split(/\s+/);
  const precedingArguments = commandInput.slice(1, params.argumentIndex + 1);
  const replacement = [params.command, ...precedingArguments, params.value].join(' ');
  return `${before.slice(0, commandStart)}${replacement} ${after}`;
}

export function buildUserMessageHistory(messages: readonly ComposerMessage[]): string[] {
  const seen = new Set<string>();
  const history: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user' || typeof message.content !== 'string') continue;
    const content = message.content.trim();
    if (content && !seen.has(content)) {
      seen.add(content);
      history.push(content);
    }
  }
  return history;
}
