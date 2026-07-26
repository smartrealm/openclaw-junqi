// ═══════════════════════════════════════════════════════════
// configUtils — Pure config normalization functions (extracted from
// ConfigManager/index.tsx for testability and design pattern compliance).
// ═══════════════════════════════════════════════════════════

import { normalizeProviderAuthMode, toOpenClawAuthProfileMode } from '@/types/providerAuthMode';

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

export function authProfilesForRuntime(
  profiles: Record<string, any> | undefined,
  canonicalize: (id: string) => string,
): Record<string, any> | undefined {
  if (!profiles || Object.keys(profiles).length === 0) return profiles;

  const out: Record<string, any> = {};
  for (const [k, p] of Object.entries(profiles)) {
    const mode = toOpenClawAuthProfileMode(p?.mode ?? p?.type);
    const keyParts = k.split(':');
    const profileName = keyParts.length > 1 ? keyParts.slice(1).join(':') : 'main';
    const provider = canonicalize(p?.provider ?? keyParts[0]);
    if (!provider || !mode) continue;
    const displayName = String(p?.displayName ?? p?.profileName ?? '').trim();
    out[`${provider}:${profileName}`] = {
      provider,
      mode,
      ...(typeof p?.email === 'string' && p.email.trim() ? { email: p.email.trim() } : {}),
      ...(displayName ? { displayName } : {}),
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
    const rawMode = p?.mode ?? p?.type;
    const secret = p?.apiKey ?? p?.key ?? p?.token;
    // Preserve native OpenClaw modes on a read/write round trip. A token field
    // alongside mode=token is the legacy JunQi shape and still migrates to the
    // API-key flow so its secret can be moved into env/provider storage.
    const runtimeMode = toOpenClawAuthProfileMode(rawMode);
    const mode = rawMode === 'token' && secret
      ? 'api_key'
      : runtimeMode ?? normalizeProviderAuthMode(rawMode);
    out[k] = {
      ...p,
      mode,
      profileName: p?.profileName ?? p?.displayName,
      apiKey: mode === 'api_key' ? (p?.apiKey ?? p?.key ?? p?.token) : undefined,
      token: undefined,
    };
  }
  return out;
}
