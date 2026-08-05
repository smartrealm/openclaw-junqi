import type {
  OpenClawCommandArgument,
  OpenClawCommandCategory,
  OpenClawCommandScope,
  OpenClawCommandSource,
} from '@/services/gateway/OpenClawCommandsClient';

/** `uncategorized` is only a presentational bucket for an omitted optional protocol field. */
export type SlashCategory = OpenClawCommandCategory | 'uncategorized';

/** A text command alias validated from the current OpenClaw commands.list response. */
export interface SlashCommand {
  readonly cmd: string;
  readonly description: string;
  readonly category: SlashCategory;
  readonly source: OpenClawCommandSource;
  readonly scope: OpenClawCommandScope;
  readonly acceptsArgs: boolean;
  readonly args?: readonly OpenClawCommandArgument[];
}
