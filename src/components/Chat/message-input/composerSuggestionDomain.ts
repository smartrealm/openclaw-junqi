import { SLASH_COMMANDS, type SlashCommand } from '@/data/slashCommands';
import type { ModelEntry } from '@/services/gateway/modelLoaders';

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

export const COMPOSER_SLASH_COMMANDS = SLASH_COMMANDS.filter((command) => command.cmd !== '/skill:');

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

export function filterSlashCommands(query: string): SlashCommand[] {
  const normalized = query.toLowerCase();
  return COMPOSER_SLASH_COMMANDS.filter((command) => (
    !normalized
    || command.cmd.toLowerCase().includes(normalized)
    || command.label.toLowerCase().includes(normalized)
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
  models: readonly ModelEntry[],
): ArgumentCompletion[] {
  const normalized = query.toLowerCase();
  if (commandName === '/model') {
    return models
      .filter((model) => !normalized || model.id.toLowerCase().includes(normalized) || model.alias?.toLowerCase().includes(normalized))
      .slice(0, 10)
      .map((model) => ({ value: model.id, label: model.alias || model.label || model.id }));
  }
  const command = COMPOSER_SLASH_COMMANDS.find((candidate) => candidate.cmd === commandName);
  return (command?.argChoices ?? [])
    .filter((choice) => !normalized || choice.toLowerCase().includes(normalized))
    .slice(0, 12)
    .map((choice) => ({ value: choice, label: choice }));
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
