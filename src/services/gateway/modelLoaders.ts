// ═══════════════════════════════════════════════════════════
// modelLoaders — Chain of Responsibility for loading available models.
// Each strategy tries to load; returns null to signal "try next".
// ═══════════════════════════════════════════════════════════

import { debugLog } from '@/utils/debugLog';

export interface ModelEntry { id: string; label: string; alias?: string; supportsImage?: boolean }
export interface ModelLoadContext {
  hasProviders: (config: any) => boolean;
  extractModels: (config: any) => ModelEntry[];
  extractRuntimeModels?: (result: unknown) => ModelEntry[];
}
export interface ModelLoaderStrategy {
  name: string;
  load(ctx: ModelLoadContext): Promise<ModelEntry[] | null>;
}

/** Strategy 0: Gateway's authoritative configured-model view. */
export class GatewayModelsListLoader implements ModelLoaderStrategy {
  name = 'models.list';
  constructor(private call: (m: string, p: any) => Promise<any>) {}

  async load(ctx: ModelLoadContext): Promise<ModelEntry[] | null> {
    if (!ctx.extractRuntimeModels) return null;
    let raw: any;
    try { raw = await this.call('models.list', { view: 'configured' }); }
    catch { return null; }
    const models = ctx.extractRuntimeModels(raw);
    return models.length > 0 ? models : null;
  }
}

/** Strategy 1: WebSocket config.get (reflects runtime state). */
export class ConfigGetLoader implements ModelLoaderStrategy {
  name = 'config.get';
  constructor(private call: (m: string, p: any) => Promise<any>) {}

  async load(ctx: ModelLoadContext): Promise<ModelEntry[] | null> {
    let raw: any;
    try { raw = await this.call('config.get', {}); }
    catch { return null; }  // WS not connected — delegate to next

    // Reject health events (method rejected / scope insufficient)
    if (raw?.eventLoop || raw?.plugins?.loaded) return null;

    const config = raw?.agents?.defaults?.models ? raw : (raw?.config ?? raw);
    const models = ctx.extractModels(config);
    if (models.length > 0) return models;

    // Config loaded but empty — signal "tried, got nothing" (not null)
    // so the chain knows providers exist but no models configured.
    return ctx.hasProviders(config) ? [] : null;
  }
}

/** Strategy 2: Read openclaw.json directly via Tauri (no WS needed). */
export class FileReadLoader implements ModelLoaderStrategy {
  name = 'openclaw.json';
  constructor(private readConfig: () => Promise<{ data: any } | null>) {}

  async load(ctx: ModelLoadContext): Promise<ModelEntry[] | null> {
    let result: { data: any } | null;
    try { result = await this.readConfig(); }
    catch { return null; }
    if (!result?.data) return null;

    const models = ctx.extractModels(result.data);
    return models.length > 0 ? models : null;
  }
}

/** Strategy 3: Collect from agents.list + session model (last resort). */
export class AgentsSessionLoader implements ModelLoaderStrategy {
  name = 'agents+sessions';
  constructor(
    private getSessions: () => Promise<any>,
    private getAgents: () => Promise<any>,
  ) {}

  async load(ctx: ModelLoadContext): Promise<ModelEntry[] | null> {
    const modelMap = new Map<string, ModelEntry>();
    try {
      const sessionsResult = await this.getSessions();
      const sessions = Array.isArray(sessionsResult?.sessions) ? sessionsResult.sessions : [];
      const main = sessions.find((s: any) => (s.key || '') === 'agent:main:main');
      if (main?.model) modelMap.set(main.model, { id: main.model, label: main.model });
    } catch { /* continue to agents */ }

    try {
      const agentsResult = await this.getAgents();
      const agents = Array.isArray(agentsResult?.agents) ? agentsResult.agents : [];
      for (const agent of agents) {
        const modelId = typeof agent?.model === 'string'
          ? agent.model
          : agent?.model?.primary;
        if (modelId && !modelMap.has(modelId)) modelMap.set(modelId, { id: modelId, label: modelId });
      }
    } catch { /* ignore */ }

    return modelMap.size > 0 ? [...modelMap.values()] : null;
  }
}

/** Orchestrates the chain — tries each strategy in order. */
export class ModelLoaderChain {
  private strategies: ModelLoaderStrategy[];

  constructor(strategies: ModelLoaderStrategy[]) {
    this.strategies = strategies;
  }

  async load(ctx: ModelLoadContext): Promise<ModelEntry[]> {
    for (const s of this.strategies) {
      const result = await s.load(ctx);
      if (result && result.length > 0) {
        debugLog('models', `[Models] Loaded from ${s.name}:`, result.length);
        return result;
      }
      // result === null means "couldn't try" → continue
      // result === [] means "tried, no models" → continue to next strategy
    }
    return [];  // All strategies exhausted
  }
}
