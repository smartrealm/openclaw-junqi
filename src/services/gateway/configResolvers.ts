// ═══════════════════════════════════════════════════════════
// configResolvers — Chain of Responsibility for resolving gateway
// connection config (token + ws_url). Each resolver tries one source.
// ═══════════════════════════════════════════════════════════

import { debugLog } from '@/utils/debugLog';

export interface GwConfig { token: string; ws_url: string; credential_scope?: string }
export interface ConfigResolver { name: string; resolve(): Promise<GwConfig | null> }

/** Volatile fallback from a prior lifecycle result, scoped to its endpoint. */
export class CachedTokenResolver implements ConfigResolver {
  name = 'cached';
  constructor(private get: () => GwConfig | null) {}
  async resolve(): Promise<GwConfig | null> {
    const config = this.get();
    return config?.ws_url ? { ...config } : null;
  }
}

/** Resolver 2: gateway-config event payload (already arrived). */
export class EventPayloadResolver implements ConfigResolver {
  name = 'event';
  constructor(private get: () => any | null) {}
  async resolve(): Promise<GwConfig | null> {
    const cfg = this.get();
    return typeof cfg?.ws_url === 'string' && cfg.ws_url.trim()
      ? { token: typeof cfg.token === 'string' ? cfg.token : '', ws_url: cfg.ws_url }
      : null;
  }
}

/** Resolver 3: Read openclaw.json via Tauri invoke (authoritative). */
export class FileReadResolver implements ConfigResolver {
  name = 'file';
  constructor(private invoke: (cmd: string) => Promise<any>) {}
  async resolve(): Promise<GwConfig | null> {
    try {
      const gw: any = await this.invoke('detect_gateway_config');
      if (typeof gw?.ws_url !== 'string' || !gw.ws_url.trim()) return null;
      const runtimeMode = typeof gw.runtime_mode === 'string' ? gw.runtime_mode : 'unknown';
      const configPath = typeof gw.config_path === 'string' ? gw.config_path : '';
      const credentialScope = typeof gw.credential_scope === 'string' && gw.credential_scope.trim()
        ? gw.credential_scope.trim()
        : `${runtimeMode}:${configPath}`;
      let token = typeof gw.token === 'string' ? gw.token.trim() : '';
      if (!token && configPath) {
        try {
          // `detect_gateway_config` deliberately returns literal tokens only.
          // Resolve a selected SecretRef through OpenClaw's official resolver;
          // never pass its config representation to the WebSocket handshake.
          const resolved = await this.invoke('get_gateway_token');
          token = typeof resolved === 'string' ? resolved.trim() : '';
        } catch {
          // Token-less configurations remain valid resolver results so the
          // connection layer can surface the Gateway's structured auth error.
        }
      }
      return {
        token,
        ws_url: gw.ws_url,
        credential_scope: credentialScope,
      };
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
