import path from "node:path";
import {
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";
import { CollaborationDatabase } from "./database.js";
import { OpenClawRuntimeAdapter } from "./openclaw-adapter.js";
import { registerCollaborationRpc } from "./rpc.js";
import { CollaborationService } from "./service.js";
import type { OpenClawApi } from "./sdk-types.js";
import type { PluginConfig } from "./types.js";

const PLUGIN_ID = "junqi-collab";
const PLUGIN_NAME = "JunQi Collaboration";
const PLUGIN_DESCRIPTION = "Durable, auditable collaboration workflows across OpenClaw agents.";
const SERVICE_ID = "junqi-collab-controller";

const CONFIG_DEFAULTS = {
  maxConcurrency: 4,
  maxWorkItems: 24,
  attemptTimeoutMs: 1_800_000,
  retentionDays: 365,
} as const;

function integerConfig(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function normalizePluginConfig(input: Record<string, unknown> | undefined): PluginConfig {
  const config = input ?? {};
  const coordinatorAgentId = typeof config.coordinatorAgentId === "string"
    ? config.coordinatorAgentId.trim()
    : "";
  const allowedAgentIds = Array.isArray(config.allowedAgentIds)
    ? [...new Set(config.allowedAgentIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean))]
    : [];
  return {
    ...(coordinatorAgentId ? { coordinatorAgentId } : {}),
    allowedAgentIds,
    maxConcurrency: integerConfig(config.maxConcurrency, CONFIG_DEFAULTS.maxConcurrency, 1, 16),
    maxWorkItems: integerConfig(config.maxWorkItems, CONFIG_DEFAULTS.maxWorkItems, 1, 64),
    attemptTimeoutMs: integerConfig(
      config.attemptTimeoutMs,
      CONFIG_DEFAULTS.attemptTimeoutMs,
      30_000,
      86_400_000,
    ),
    retentionDays: integerConfig(config.retentionDays, CONFIG_DEFAULTS.retentionDays, 7, 3_650),
  };
}

export function registerOpenClawAdapter(api: OpenClawApi): void {
  if (api.registrationMode !== "full") return;

  const config = normalizePluginConfig(api.pluginConfig);
  const adapter = new OpenClawRuntimeAdapter(api.runtime, {
    allowedAgentIds: config.allowedAgentIds,
    ...(config.coordinatorAgentId ? { coordinatorAgentId: config.coordinatorAgentId } : {}),
    emitAgentEvent: api.agent.events.emitAgentEvent,
    logger: api.logger,
  });
  let database: CollaborationDatabase | null = null;
  let service: CollaborationService | null = null;

  registerCollaborationRpc(api, () => service);

  api.registerService({
    id: SERVICE_ID,
    async start(context) {
      if (service || database) return;
      const dataDir = path.join(context.stateDir, PLUGIN_ID);
      const nextDatabase = new CollaborationDatabase(path.join(dataDir, "collaboration.sqlite"));
      try {
        const nextService = new CollaborationService(
          nextDatabase,
          adapter,
          config,
          dataDir,
          context.logger,
        );
        nextService.start();
        database = nextDatabase;
        service = nextService;
      } catch (error) {
        nextDatabase.close();
        throw error;
      }
    },
    async stop() {
      const currentService = service;
      const currentDatabase = database;
      service = null;
      database = null;
      try {
        await currentService?.stop();
      } finally {
        currentDatabase?.close();
      }
    },
  });
}

export function createJunqiCollaborationPlugin(): OpenClawPluginDefinition {
  return definePluginEntry({
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: PLUGIN_DESCRIPTION,
    register(api) {
      registerOpenClawAdapter(api);
    },
  });
}

export { OpenClawRuntimeAdapter } from "./openclaw-adapter.js";
export type {
  OpenClawAdapterOptions,
} from "./sdk-types.js";

const plugin: OpenClawPluginDefinition = createJunqiCollaborationPlugin();

export default plugin;
