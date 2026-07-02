import { invoke } from "@tauri-apps/api/core";

export interface NodeStatus { available: boolean; version: string | null; path: string | null; source: string | null; }
export interface GitStatus { available: boolean; version: string | null; path: string | null; source: string | null; }
export interface OpenclawStatus { installed: boolean; version: string | null; path: string | null; }
export interface DockerStatus { available: boolean; version: string | null; daemon_running: boolean; }

export const checkNode = () => invoke<NodeStatus>("check_node");
export const checkGit = () => invoke<GitStatus>("check_git");
export const checkOpenclaw = () => invoke<OpenclawStatus>("check_openclaw");
export const installNode = () => invoke<string>("install_node");
export const installGit = () => invoke<string>("install_git");
export const installOpenclaw = () => invoke<string>("install_openclaw");
export const prepareGateway = () => invoke<string>("prepare_gateway");
export const startGateway = (port?: number) => invoke<any>("start_gateway", { port });
export const checkDocker = () => invoke<DockerStatus>("check_docker");
export const pullOpenclawImage = (tag?: string) => invoke<string>("pull_openclaw_image", { tag });
export const startDockerGateway = (port?: number, tag?: string) => invoke<any>("start_docker_gateway", { port, tag });

/** Result of ensure_gateway_running — see src-tauri/src/commands/ensure.rs */
export type GatewayMode = 'native' | 'docker' | 'unavailable';
export interface EnsureResult {
  mode: GatewayMode;
  healthy: boolean;
  port: number;
  token: string | null;
  attempted_fallback: boolean;
  error: string | null;
}

/**
 * Boot-time / on-demand orchestrator. Tries native → docker → unavailable.
 * Debounced to one call per 60s on the Rust side.
 */
export const ensureGatewayRunning = () => invoke<EnsureResult>("ensure_gateway_running");

/** Gateway log buffer access (200-entry circular, see gateway_process.rs). */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'child_stdout' | 'child_stderr' | 'docker_stdout' | 'docker_stderr' | 'lifecycle';
export interface LogEntry {
  timestamp_ms: number;
  level: LogLevel;
  source: LogSource;
  message: string;
}
export const getGatewayLogs = (limit: number) => invoke<LogEntry[]>("get_gateway_logs", { limit });
export const clearGatewayLogs = () => invoke<void>("clear_gateway_logs");
