import { invoke } from "@tauri-apps/api/core";

export type RuntimeToolSource = 'system' | 'custom';
export interface NodeStatus { available: boolean; version: string | null; path: string | null; source: RuntimeToolSource | null; }
export interface NpmStatus { available: boolean; version: string | null; path: string | null; source: string | null; reason: string | null; }
export interface GitStatus { available: boolean; version: string | null; path: string | null; source: RuntimeToolSource | null; }
export interface OpenclawStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
  source: string | null;
  binary_found: boolean;
  version_ok: boolean;
  package_valid: boolean;
  gateway_command_ok: boolean;
  relocation_required: boolean;
  error: string | null;
}
export interface DockerStatus { available: boolean; version: string | null; daemon_running: boolean; }
export interface GatewayStatus { running: boolean; port: number; pid: number | null; token: string | null; }
export interface SetupNodeStatus {
  node: NodeStatus;
  npm: NpmStatus;
  requirement: string | null;
  requirementError: string | null;
}
export interface DependencyInstallCancellationResult {
  accepted: boolean;
  queued: boolean;
}
export type GatewayRuntimeMode = "native" | "docker";
export interface GatewayConfigInfo {
  token: string | null;
  port: number;
  ws_url: string;
  http_url: string;
  config_path: string | null;
  runtime_mode: GatewayRuntimeMode;
}
export interface TerminalIntegrationStatus {
  requested: boolean;
  enabled: boolean;
  launcherReady: boolean;
  launcherDir: string;
  launcherPath: string;
  profilePath: string | null;
  terminalRestartRequired: boolean;
  message: string;
}
export interface OpenclawUpdateStatus {
  currentVersion: string | null;
  latestVersion: string | null;
  available: boolean;
  hasGitUpdate: boolean;
  hasRegistryUpdate: boolean;
  gitBehind: number | null;
  channel: string | null;
  channelLabel: string | null;
  installKind: string | null;
  packageManager: string | null;
  npmRegistry: string | null;
  npmRegistryKind: 'official' | 'chinaMirror' | null;
  error: string | null;
}
export interface OpenclawUpdateResult {
  success: boolean;
  status: string;
  mode: string | null;
  reason: string | null;
  beforeVersion: string | null;
  afterVersion: string | null;
  gatewayRestarted: boolean;
  gatewayError: string | null;
  npmRegistry: string | null;
  npmRegistryKind: 'official' | 'chinaMirror' | null;
  error: string | null;
}

export type MaintenanceSeverity = 'error' | 'warning' | 'info';
export type MaintenanceCategory = 'config' | 'plugin' | 'mcp' | 'security' | 'gateway' | 'doctor';
export interface MaintenanceFinding {
  source: 'config' | 'doctor';
  category: MaintenanceCategory;
  severity: MaintenanceSeverity;
  checkId: string | null;
  message: string;
  path: string | null;
  requirement: string | null;
  fixHint: string | null;
}
export interface MaintenanceReport {
  healthy: boolean;
  checkedAtMs: number;
  configValid: boolean | null;
  configPath: string | null;
  doctorOk: boolean | null;
  checksRun: number | null;
  checksSkipped: number | null;
  findings: MaintenanceFinding[];
  scanErrors: string[];
  summary: { errors: number; warnings: number; info: number };
}

export const checkNode = () => invoke<NodeStatus>("check_node");
export const checkSetupNode = () => invoke<SetupNodeStatus>("check_setup_node");
export const repairSetupNodeRuntime = (operationId?: string) => (
  invoke<string>("repair_setup_node_runtime", { operationId })
);
export const checkGit = () => invoke<GitStatus>("check_git");
export const checkOpenclaw = () => invoke<OpenclawStatus>("check_openclaw");
export const checkOpenclawUpdate = () => invoke<OpenclawUpdateStatus>("check_openclaw_update");
export const updateOpenclaw = () => invoke<OpenclawUpdateResult>("update_openclaw");
export const runMaintenanceScan = () => invoke<MaintenanceReport>("run_maintenance_scan");
export const installNode = (force = false, operationId?: string) => (
  invoke<string>("install_node", { force, operationId })
);
export const installGit = (operationId?: string) => (
  invoke<string>("install_git", { operationId })
);
export const cancelDependencyInstall = (operationId: string) => (
  invoke<DependencyInstallCancellationResult>("cancel_dependency_install", { operationId })
);
export const installOpenclaw = () => invoke<string>("install_openclaw");
export const reinstallOpenclaw = () => invoke<string>("reinstall_openclaw");
export const relocateOpenclaw = () => invoke<string>("relocate_openclaw");
export const applyTerminalIntegration = () => invoke<TerminalIntegrationStatus>("apply_terminal_integration");
export const prepareGateway = () => invoke<string>("prepare_gateway");
export const startGateway = (port?: number) => (
  port == null ? invoke<any>("start_gateway") : invoke<any>("start_gateway", { port })
);
export const checkDocker = () => invoke<DockerStatus>("check_docker");
export const pullOpenclawImage = (tag?: string) => invoke<string>("pull_openclaw_image", { tag });
export const startDockerGateway = (port?: number, tag?: string) => invoke<GatewayStatus>("start_docker_gateway", { port, tag });
export const detectGatewayConfig = () => invoke<GatewayConfigInfo>("detect_gateway_config");
export const setActiveGatewayRuntime = (mode: GatewayRuntimeMode) => (
  invoke<void>("set_active_gateway_runtime", { mode })
);
export const commitActiveGatewayRuntime = (mode: GatewayRuntimeMode) => (
  invoke<void>("commit_active_gateway_runtime", { mode })
);
export const rollbackActiveGatewayRuntime = (mode: GatewayRuntimeMode) => (
  invoke<void>("rollback_active_gateway_runtime", { mode })
);
export const commitRuntimeReconfiguration = () => (
  invoke<boolean>("commit_runtime_reconfiguration")
);
export const rollbackRuntimeReconfiguration = () => (
  invoke<boolean>("rollback_runtime_reconfiguration")
);

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
