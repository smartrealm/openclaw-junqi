/**
 * ProviderAccount — per-vendor multi-account support, ported from
 * JunQi electron/shared/providers/types.ts:172-193.
 *
 * JunQi distinguishes ProviderConfig (the vendored config, written to
 * `~/.openclaw/openclaw.json → models.providers.*`) from
 * ProviderAccount (a runtime per-account object with auth credentials,
 * stored in the app's secure store). We use a single unified shape
 * here for now — the gateway serializer will project accounts down
 * to the `models.providers.*` config when persisting.
 *
 * Why this matters:
 *  - A user has 2 OpenAI accounts (work + personal): today they have
 *    to choose one and lose the other. With ProviderAccount[], the
 *    UI can show "Work (default)" / "Personal" and switch on demand.
 *  - OAuth logins land in an account (not a vendor-level key) — when
 *    ChatGPT OAuth completes, we save the token in the account, not
 *    the provider.
 */
import type { ProviderAuthMode } from './providerAuthMode';
import type { OpenClawApiProtocol } from './openclawApiProtocol';

export interface ProviderAccount {
  /** Stable id (UUID). Used as openclaw.json `models.providers.*.id`. */
  id: string;
  /** Vendor type, e.g. 'openai', 'minimax-portal'. */
  vendorId: string;
  /** User-visible label, e.g. "Work" / "Personal" / "Anthropic — Team". */
  label: string;
  /** Auth mode for THIS account (different accounts of same vendor can differ). */
  authMode: ProviderAuthMode;
  /** Optional override — defaults come from the vendor's `providerConfig`. */
  baseUrl?: string;
  apiProtocol?: OpenClawApiProtocol;
  headers?: Record<string, string>;
  /** Primary model id used by this account (e.g. 'gpt-5.5'). */
  model?: string;
  /** Other models to try as fallbacks if `model` is unavailable. */
  fallbackModels?: string[];
  /** Other account ids (same vendor) to fall back to. */
  fallbackAccountIds?: string[];
  /** Whether this account is enabled in routing. Disabled accounts aren't tried. */
  enabled: boolean;
  /** True if this account is the default for its vendor. Exactly one per vendor. */
  isDefault: boolean;
  /** Optional side-channel metadata (region, email for OAuth, etc.). */
  metadata?: {
    region?: string;
    email?: string;
    resourceUrl?: string;
    customModels?: string[];
  };
  /** ISO timestamps for diagnostics + sync conflict detection. */
  createdAt: string;
  updatedAt: string;
}

/**
 * ProviderSecret — a credential attached to ONE ProviderAccount.
 *  *
 * Each variant is a tagged union: the `type` discriminator tells the
 * secret store where to put it (keychain? secure storage? in-memory
 * cache?).
 */
export type ProviderSecret =
  | {
    type: 'api_key';
    accountId: string;
    apiKey: string;
  }
  | {
    type: 'oauth';
    accountId: string;
    accessToken: string;
    refreshToken: string;
    /** Unix epoch ms. */
    expiresAt: number;
    scopes?: string[];
    email?: string;
    subject?: string;
  }
  | {
    type: 'local';
    accountId: string;
    /** Ollama doesn't need a key, but the field is reserved for future proxy auth. */
    apiKey?: string;
  };

/**
 * Generate a fresh account id. Currently a thin wrapper over crypto
 * so callers don't have to import a UUID library just to make an id.
 * Returns a URL-safe 22-char string (16 random bytes base64url-encoded).
 */
export function makeProviderAccountId(): string {
  const bytes = new Uint8Array(16);
  // Node has globalThis.crypto; we expect the same in the browser at runtime.
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Validate that a candidate `isDefault` flag assignment is consistent:
 * exactly one account per vendor can be `isDefault: true`. Returns a
 * corrected array (or the input if already consistent).
 */
export function enforceSingleDefault(
  accounts: ProviderAccount[],
  vendorId: string,
): ProviderAccount[] {
  const inVendor = accounts.filter((a) => a.vendorId === vendorId);
  const defaultCount = inVendor.filter((a) => a.isDefault).length;
  if (defaultCount === 1) return accounts;
  if (inVendor.length === 0) return accounts;
  // Pick the first enabled account as default; if none enabled, first.
  const pick = inVendor.find((a) => a.enabled) ?? inVendor[0];
  return accounts.map((a) => ({ ...a, isDefault: a.id === pick.id }));
}