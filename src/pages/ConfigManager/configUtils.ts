// ═══════════════════════════════════════════════════════════
// configUtils — Pure config normalization functions (extracted from
// ConfigManager/index.tsx for testability and design pattern compliance).
// ═══════════════════════════════════════════════════════════

// ── 1. Provider ID canonicalization (lookup table, not if-else) ──
const PROVIDER_ALIASES: Record<string, string> = {
  modelstudio: 'qwen', qwencloud: 'qwen', 'qwen-dashscope': 'qwen',
  'z.ai': 'zai', 'z-ai': 'zai',
  'kimi-coding': 'kimi-coding', 'kimi-code': 'kimi-coding', 'kimi': 'kimi-coding',
};

export function canonicalProviderId(providerId: string | undefined): string {
  const normalized = String(providerId ?? '').trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

// ── 2. Private hostname detection (CIDR table, not 10-branch if-else) ──
// RFC 1918 + RFC 4193 + CGNAT + benchmark + link-local ranges.
const PRIVATE_IPV4_RANGES: Array<[number, number, number]> = [
  // [firstOctet, maskOctet2 or 0, range type flag]
  // 10.0.0.0/8
  [10, 0, 0],
  // 127.0.0.0/8
  [127, 0, 0],
  // 169.254.0.0/16
  [169, 254, 1],
  // 172.16.0.0/12 → b in 16..31
  [172, 16, 2],
  // 192.168.0.0/16
  [192, 168, 1],
  // 100.64.0.0/10 → b in 64..127
  [100, 64, 2],
  // 198.18.0.0/15 → b in 18..19
  [198, 18, 2],
];

export function isPrivateHostname(hostname: string): boolean {
  const normalized = String(hostname ?? '').trim().toLowerCase();
  if (!normalized) return false;

  // Named hosts
  if (normalized === 'localhost' || normalized.endsWith('.local')) return true;

  // IPv6 loopback + unique-local
  if (normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80:')) return true;

  // IPv4
  const m = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;

  const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
  if (a > 255 || b > 255) return false;

  for (const [fa, fb, flag] of PRIVATE_IPV4_RANGES) {
    if (a !== fa) continue;
    switch (flag) {
      case 0: return true;                          // /8 — any b
      case 1: return b === fb;                      // /16 — exact b
      case 2:                                       // /12 or /10 or /15 — b in range
        if (fa === 172) return b >= 16 && b <= 31;
        if (fa === 100) return b >= 64 && b <= 127;
        if (fa === 198) return b === 18 || b === 19;
        return false;
    }
  }
  return false;
}

// ── 3. Channel streaming normalization (Strategy per channelId) ──
type StreamingNormalizer = (raw: unknown) => unknown;

/** Feishu: streaming is a boolean or truthy string. */
const feishuStreamingNormalizer: StreamingNormalizer = (raw) => {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    return !(v === '' || v === 'off' || v === 'false' || v === '0' || v === 'no');
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, any>;
    if (typeof obj.enabled === 'boolean') return obj.enabled;
    if (typeof obj.mode === 'string') return obj.mode !== 'off';
  }
  return undefined;
};

/** Telegram/Discord/Slack: streaming is { mode: 'off'|'partial'|'full' }. */
const modeStreamingNormalizer: StreamingNormalizer = (raw) => {
  if (typeof raw === 'string') {
    const mode = raw.trim().toLowerCase();
    return { mode: ['off', 'partial', 'full'].includes(mode) ? mode : 'off' };
  }
  if (typeof raw === 'boolean') return { mode: raw ? 'partial' : 'off' };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, any>;
    const mode = String(obj.mode ?? '').toLowerCase();
    return { mode: ['off', 'partial', 'full'].includes(mode) ? mode : 'off' };
  }
  return undefined;
};

const CHANNEL_STREAMING_NORMALIZERS: Record<string, StreamingNormalizer> = {
  feishu: feishuStreamingNormalizer,
  telegram: modeStreamingNormalizer,
  discord: modeStreamingNormalizer,
  slack: modeStreamingNormalizer,
};

export function normalizeChannelStreaming(
  channels: Record<string, any> | undefined,
): Record<string, any> | undefined {
  if (!channels || typeof channels !== 'object') return channels;

  const result: Record<string, any> = { ...channels };
  let mutated = false;

  for (const [channelId, channelConfig] of Object.entries(channels)) {
    if (!channelConfig || typeof channelConfig !== 'object') continue;
    const rawStreaming = (channelConfig as Record<string, any>).streaming;
    if (rawStreaming === undefined) continue;

    const normalizer = CHANNEL_STREAMING_NORMALIZERS[channelId];
    if (!normalizer) {
      // Unknown channel — strip streaming field (default behavior)
      const { streaming: _s, ...rest } = channelConfig as Record<string, any>;
      result[channelId] = rest;
      mutated = true;
      continue;
    }

    const normalized = normalizer(rawStreaming);
    if (normalized === undefined) {
      const { streaming: _s, ...rest } = channelConfig as Record<string, any>;
      result[channelId] = rest;
    } else {
      result[channelId] = { ...channelConfig, streaming: normalized };
    }
    mutated = true;
  }

  return mutated ? result : channels;
}

// ── 4. Auth profiles normalization (pure function, no closure) ──
function secretFieldForMode(mode: string): 'token' | 'apiKey' {
  return mode === 'token' ? 'token' : 'apiKey';
}

export function authProfilesForRuntime(
  profiles: Record<string, any> | undefined,
  canonicalize: (id: string) => string,
): Record<string, any> | undefined {
  if (!profiles || Object.keys(profiles).length === 0) return profiles;

  const out: Record<string, any> = {};
  for (const [k, p] of Object.entries(profiles)) {
    const mode = p?.mode ?? p?.type ?? 'api_key';
    const secret = p?.apiKey ?? p?.token ?? p?.key;
    const { type: _type, key: _key, ...rest } = (p ?? {}) as Record<string, any>;
    const keyParts = k.split(':');
    const profileName = keyParts.length > 1 ? keyParts.slice(1).join(':') : 'main';
    const provider = canonicalize(p?.provider ?? keyParts[0]);
    const field = secretFieldForMode(mode);
    out[`${provider}:${profileName}`] = {
      ...rest,
      provider,
      mode,
      ...(secret ? { [field]: secret } : {}),
    };
  }
  return out;
}

export function normalizeAuthProfilesFromDisk(
  profiles: Record<string, any> | undefined,
): Record<string, any> | undefined {
  if (!profiles) return profiles;
  const out: Record<string, any> = {};
  for (const [k, p] of Object.entries(profiles)) {
    const mode = p?.mode ?? p?.type ?? 'api_key';
    out[k] = {
      ...p,
      mode,
      apiKey: mode === 'token' ? undefined : (p?.apiKey ?? p?.key ?? p?.token),
      token: mode === 'token' ? (p?.token ?? p?.key ?? p?.apiKey) : p?.token,
    };
  }
  return out;
}


const ENV_REF_RE = /^\$\{([^}]+)\}$/;

/** Parse "${FOO_API_KEY}" -> "FOO_API_KEY". */
export function extractEnvRefKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const m = value.trim().match(ENV_REF_RE);
  return m?.[1];
}

/**
 * True when a provider has an actual secret configured, from any supported source:
 * - env.vars[TEMPLATE_ENV_KEY]
 * - models.providers[providerId].apiKey = '${ENV_KEY}' + env.vars[ENV_KEY]
 * - models.providers[providerId].apiKey = '<raw-secret>'
 */
export function hasConfiguredProviderSecret(
  config: Record<string, any> | undefined,
  providerId: string,
  template?: { envKey?: string; envKeyAlt?: string[] } | undefined,
): { configured: boolean; envKeyValue?: string } {
  const envVars = config?.env?.vars ?? {};
  const providerCfg = config?.models?.providers?.[providerId] ?? {};

  // 1) Primary env key on template
  if (template?.envKey) {
    const value = String(envVars[template.envKey] ?? '').trim();
    if (value) return { configured: true, envKeyValue: value };
  }

  // 2) Alternate env keys on template
  for (const key of template?.envKeyAlt ?? []) {
    const value = String(envVars[key] ?? '').trim();
    if (value) return { configured: true, envKeyValue: value };
  }

  // 3) models.providers.apiKey references an env var
  const refKey = extractEnvRefKey(providerCfg?.apiKey);
  if (refKey) {
    const value = String(envVars[refKey] ?? '').trim();
    if (value) return { configured: true, envKeyValue: value };
  }

  // 4) models.providers.apiKey stores a raw secret directly (custom providers)
  if (typeof providerCfg?.apiKey === 'string' && providerCfg.apiKey.trim() && !extractEnvRefKey(providerCfg.apiKey)) {
    return { configured: true, envKeyValue: providerCfg.apiKey.trim() };
  }

  return { configured: false };
}

/**
 * Preserve provider env vars from disk unless the user explicitly removed the provider.
 * This prevents accidental secret loss when UI state dropped env.vars during normalization.
 */
export function preserveProviderEnvVars(
  disk: Record<string, any>,
  merged: Record<string, any>,
  original: Record<string, any>,
): Record<string, any> {
  const next = structuredClone(merged ?? {});
  const diskVars = disk?.env?.vars ?? {};
  if (!diskVars || Object.keys(diskVars).length === 0) return next;

  const nextVars = { ...(next?.env?.vars ?? {}) };
  const currentProfiles = next?.auth?.profiles ?? {};
  const currentProviders = next?.models?.providers ?? {};

  // If a disk env key is referenced by a surviving provider/profile, preserve it.
  for (const [envKey, envValue] of Object.entries(diskVars)) {
    if (envKey in nextVars) continue; // already present in merged result

    const referencedByProvider = Object.values(currentProviders).some((cfg: any) => extractEnvRefKey(cfg?.apiKey) === envKey);
    const referencedByProfile = Object.values(currentProfiles).some((p: any) => {
      const providerId = String(p?.provider ?? '').trim();
      return providerId && typeof envKey === 'string' && envKey.startsWith(providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
    });

    if (referencedByProvider || referencedByProfile) {
      nextVars[envKey] = envValue;
    }
  }

  if (Object.keys(nextVars).length > 0) {
    next.env = { ...(next.env ?? {}), vars: nextVars };
  }
  return next;
}
