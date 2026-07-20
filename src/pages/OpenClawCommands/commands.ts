import { CORE_COMMANDS } from './commands-core';
import { GATEWAY_COMMANDS } from './commands-gateway';
import { MODEL_COMMANDS } from './commands-models';
import type { OpenClawCommandReference } from './types';

export const OPENCLAW_CLI_INDEX_URL = 'https://docs.openclaw.ai/cli';

/**
 * Commands and deep links verified against the official OpenClaw CLI pages.
 * Keep URLs explicit: several generated heading ids contain encoded symbols.
 */
export const OPENCLAW_COMMANDS: readonly OpenClawCommandReference[] = [
  ...CORE_COMMANDS.setup,
  ...GATEWAY_COMMANDS.gateway,
  ...GATEWAY_COMMANDS.diagnostics,
  ...MODEL_COMMANDS.models,
  ...MODEL_COMMANDS.auth,
  ...CORE_COMMANDS.channels,
  ...CORE_COMMANDS.automation,
];
