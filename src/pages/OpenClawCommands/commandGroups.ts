import type { OpenClawCommandEntry } from '@/services/gateway/OpenClawCommandsClient';

export interface OpenClawCommandGroup {
  readonly id: string;
  readonly commands: readonly OpenClawCommandEntry[];
}

/** 仅按 Gateway 返回的类别组织目录，不补造本地命令或类别。 */
export function groupOpenClawCommands(
  commands: readonly OpenClawCommandEntry[],
): readonly OpenClawCommandGroup[] {
  const groups = new Map<string, OpenClawCommandEntry[]>();
  for (const command of commands) {
    const id = command.category ?? 'uncategorized';
    const group = groups.get(id);
    if (group) group.push(command);
    else groups.set(id, [command]);
  }
  return [...groups.entries()].map(([id, entries]) => ({ id, commands: entries }));
}
