/**
 * Runtime-owned `models.providers.*.api` helpers.
 *
 * The accepted values come from the selected OpenClaw Runtime's config schema.
 * JunQi keeps protocol values as opaque strings so a newer Runtime can add an
 * adapter without requiring a desktop release.
 */
export type OpenClawApiProtocol = string;

/**
 * A narrowly scoped, reviewed migration for a value written by older JunQi
 * releases. This is compatibility history, not an accepted-value catalog.
 */
export const LEGACY_OPENCLAW_API_PROTOCOL_MIGRATIONS: Readonly<Record<string, string>> = {
  'openai-codex-responses': 'openai-chatgpt-responses',
};

/** Preserve current/future Runtime values and migrate only known legacy data. */
export function normalizeOpenClawApiProtocol(api: unknown): string | undefined {
  if (typeof api !== 'string' || !api.trim()) return undefined;
  const value = api.trim();
  return LEGACY_OPENCLAW_API_PROTOCOL_MIGRATIONS[value] ?? value;
}
