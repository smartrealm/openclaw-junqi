// ═══════════════════════════════════════════════════════════
// configResolvers — Chain of Responsibility for resolving gateway
// connection config (token + ws_url). Each resolver tries one source.
// ═══════════════════════════════════════════════════════════

import { debugLog } from '@/utils/debugLog';

export interface GwConfig { token: string; ws_url: string }
export interface ConfigResolver { name: string; resolve(): Promise<GwConfig | null> }

/** Resolver 1: Cached token from a prior start_gateway call. */
export class CachedTokenResolver implements ConfigResolver {
  name = 'cached';
  constructor(private get: () => string | null, private getPort: () => number | null) {}
  async resolve(): Promise<GwConfig | null> {
    const token = this.get();
    if (!token) return null;
    const port = this.getPort() ?? 18789;
    return { token, ws_url: `ws://127.0.0.1:${port}` };
  }
}

/** Resolver 2: gateway-config event payload (already arrived). */
export class EventPayloadResolver implements ConfigResolver {
  name = 'event';
  constructor(private get: () => any | null) {}
  async resolve(): Promise<GwConfig | null> {
    const cfg = this.get();
    return cfg?.token ? { token: cfg.token, ws_url: cfg.ws_url } : null;
  }
}

/** Resolver 3: Read openclaw.json via Tauri invoke (authoritative). */
export class FileReadResolver implements ConfigResolver {
  name = 'file';
  constructor(private invoke: (cmd: string) => Promise<any>) {}
  async resolve(): Promise<GwConfig | null> {
    try {
      const gw: any = await this.invoke('detect_gateway_config');
      if (!gw?.token) return null;
      return { token: gw.token, ws_url: gw.ws_url };
    } catch { return null; }
  }
}

/** Orchestrate resolvers in priority order. */
export class ConfigResolverChain {
  constructor(private resolvers: ConfigResolver[]) {}

  async resolve(): Promise<GwConfig | null> {
    for (const r of this.resolvers) {
      const result = await r.resolve();
      if (result) { debugLog('gateway', `[GW Config] Resolved via ${r.name}`); return result; }
    }
    return null;
  }
}
