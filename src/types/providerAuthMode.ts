/**
 * ProviderAuthMode — ported from ClawX electron/shared/providers/types.ts
 *
 * ClawX supports 4 auth modes per provider. We port the type + the
 * per-mode metadata (API key env var, OAuth target key, etc.) so the
 * frontend can drive the right UI per mode. The actual Tauri-side
 * browser-OAuth / device-code flows (PKCE, local HTTP server) live in
 * openclaw-auth.ts and are out of scope for this commit — they're
 * invoked through the gateway RPC layer.
 */
export type ProviderAuthMode =
  | 'api_key'        // User supplies an API key in the desktop app
  | 'oauth_device'   // Device-code flow (e.g. Anthropic, MiniMax)
  | 'oauth_browser'  // Browser-OAuth (OpenAI ChatGPT login)
  | 'local';         // Local server (Ollama, no key)

/** Display order in the UI. */
export const AUTH_MODE_ORDER: ProviderAuthMode[] = [
  'api_key',
  'oauth_browser',
  'oauth_device',
  'local',
];

/** Per-mode capability flags — what the UI should show. */
export interface AuthModeInfo {
  /** Whether the user types a key in a text field. */
  hasApiKeyField: boolean;
  /** Whether clicking triggers a browser-based OAuth flow. */
  hasBrowserFlow: boolean;
  /** Whether the user is shown a one-time code to enter on a device. */
  hasDeviceCode: boolean;
  /** Whether the auth mode uses a self-hosted server URL. */
  hasBaseUrl: boolean;
}

export const AUTH_MODE_INFO: Record<ProviderAuthMode, AuthModeInfo> = {
  api_key:       { hasApiKeyField: true,  hasBrowserFlow: false, hasDeviceCode: false, hasBaseUrl: false },
  oauth_browser: { hasApiKeyField: false, hasBrowserFlow: true,  hasDeviceCode: false, hasBaseUrl: false },
  oauth_device:  { hasApiKeyField: false, hasBrowserFlow: false, hasDeviceCode: true,  hasBaseUrl: false },
  local:         { hasApiKeyField: false, hasBrowserFlow: false, hasDeviceCode: false, hasBaseUrl: true },
};

/**
 * Provider types whose default auth mode is NOT 'api_key'. ClawX calls
 * these 'OAUTH_PROVIDER_TYPES' (utils/provider-keys.ts:9) — currently
 * just the MiniMax Portal variants. The frontend uses this to choose
 * the default auth mode in the UI when the user picks a provider.
 */
export const OAUTH_PROVIDER_TYPES = new Set<string>(['minimax-portal', 'minimax-portal-cn']);

/**
 * Map a provider type to its default auth mode.
 * Ported from ClawX utils/provider-keys.ts:82-99 + provider-store.ts:6-17.
 */
export function defaultAuthModeFor(providerType: string): ProviderAuthMode {
  if (OAUTH_PROVIDER_TYPES.has(providerType)) return 'oauth_browser';
  if (providerType === 'ollama') return 'local';
  return 'api_key';
}

/**
 * Per-provider list of supported auth modes. ClawX encodes this on each
 * ProviderDefinition (registry.ts). We mirror the same shape so the
 * frontend can render the right radio group.
 *
 * If a provider isn't in this map, the UI falls back to ['api_key'].
 */
export const PROVIDER_AUTH_MODES: Record<string, ProviderAuthMode[]> = {
  anthropic:         ['api_key'],
  openai:            ['api_key', 'oauth_browser'],
  google:            ['api_key'],
  openrouter:        ['api_key'],
  ark:               ['api_key'],
  moonshot:          ['api_key'],
  'moonshot-global':  ['api_key'],
  siliconflow:       ['api_key'],
  deepseek:          ['api_key'],
  'minimax-portal':  ['oauth_browser'],
  'minimax-portal-cn': ['oauth_browser'],
  modelstudio:       ['api_key'],
  ollama:            ['local'],
  custom:            ['api_key', 'local'],
};

/** Resolve the available auth modes for a provider type. */
export function authModesFor(providerType: string): ProviderAuthMode[] {
  return PROVIDER_AUTH_MODES[providerType] ?? ['api_key'];
}