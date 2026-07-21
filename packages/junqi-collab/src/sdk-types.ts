import type {
  OpenClawConfig,
  OpenClawPluginApi,
  PluginLogger,
} from "openclaw/plugin-sdk/plugin-entry";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

export type OpenClawRuntime = PluginRuntime;
export type OpenClawApi = OpenClawPluginApi;
export type OpenClawLogger = PluginLogger;
export type OpenClawRuntimeConfig = OpenClawConfig;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface OpenClawAdapterOptions {
  allowedAgentIds?: readonly string[];
  coordinatorAgentId?: string;
  emitAgentEvent: OpenClawApi["agent"]["events"]["emitAgentEvent"];
  logger?: Pick<OpenClawLogger, "warn">;
}
