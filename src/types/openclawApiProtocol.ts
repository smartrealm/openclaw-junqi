/**
 * OpenClaw gateway `models.providers.*.api` protocol whitelist.
 *
 * Ported from ClawX electron/shared/providers/types.ts:48-58.
 *
 * Writing any other value into `~/.openclaw/openclaw.json` triggers
 * `Invalid config` rejection on the next gateway reload/restart and
 * tears down all channels. The ClawX implementation is the
 * authoritative source for which values OpenClaw accepts.
 *
 * Use `assertValidApiProtocol` at every write site so we fail fast
 * (before the gateway does) with a clear error message.
 */
export const OPENCLAW_API_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'openai-chatgpt-responses',
  'anthropic-messages',
  'google-generative-ai',
  'github-copilot',
  'bedrock-converse-stream',
  'ollama',
  'azure-openai-responses',
] as const;

export type OpenClawApiProtocol = (typeof OPENCLAW_API_PROTOCOLS)[number];

/**
 * Legacy api values that ClawX previously wrote but openclaw no longer
 * accepts. We auto-migrate on read so users with old config don't see
 * their providers break after an upgrade.
 *
 * Ported from ClawX electron/shared/providers/types.ts:62-65.
 */
export const LEGACY_OPENCLAW_API_PROTOCOL_MIGRATIONS = {
  'openai-codex-responses': 'openai-chatgpt-responses',
} as const satisfies Record<string, OpenClawApiProtocol>;

/**
 * Normalize any value to a known protocol. Returns the migrated protocol
 * for legacy values, the same value if already valid, or undefined for
 * completely unknown values.
 */
export function normalizeOpenClawApiProtocol(
  api: unknown,
): OpenClawApiProtocol | undefined {
  if (typeof api !== 'string') return undefined;
  if ((OPENCLAW_API_PROTOCOLS as readonly string[]).includes(api)) {
    return api as OpenClawApiProtocol;
  }
  return (LEGACY_OPENCLAW_API_PROTOCOL_MIGRATIONS as Record<string, OpenClawApiProtocol>)[api];
}

export class InvalidApiProtocolError extends Error {
  constructor(
    public readonly api: unknown,
    public readonly providerKey?: string,
  ) {
    const where = providerKey ? ` for provider "${providerKey}"` : '';
    super(
      `Invalid OpenClaw api protocol${where}: ${JSON.stringify(api)}. ` +
      `Expected one of: ${OPENCLAW_API_PROTOCOLS.join(', ')}.`,
    );
    this.name = 'InvalidApiProtocolError';
  }
}

/**
 * Type-guard that throws if the value isn't a known OpenClaw API protocol.
 * Use at every write site so the gateway never sees an invalid config.
 */
export function assertValidApiProtocol(
  api: unknown,
  providerKey?: string,
): asserts api is OpenClawApiProtocol {
  if (
    typeof api !== 'string' ||
    !(OPENCLAW_API_PROTOCOLS as readonly string[]).includes(api)
  ) {
    throw new InvalidApiProtocolError(api, providerKey);
  }
}