import { invoke } from "@tauri-apps/api/core";
import type {
  ClearRuntimeIdentityParams,
  GatewayHelloObservation,
  RuntimeIdentity,
} from '@/types/gatewayRuntime';
import type {
  BootstrapApplyParams,
  BootstrapAbandonParams,
  BootstrapConfigureParams,
  BootstrapConfirmHealthParams,
  BootstrapProbeParams,
  BootstrapRecoverParams,
  BootstrapRestartParams,
  CollaborationBootstrapConfigureResult,
  CollaborationBootstrapAbandonResult,
  CollaborationBootstrapProbe,
  CollaborationBootstrapRestartResult,
  CollaborationBootstrapResult,
  CollaborationBootstrapStatus,
} from '@/types/collaborationBootstrap';

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
  installedVersion: string | null;
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

export interface CollaborationMaintenanceOwner {
  owner: string;
  created: boolean;
  adoptedLegacy: boolean;
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
/** Durable per-installation owner used to recover a persisted collaboration lease. */
export const getCollaborationMaintenanceOwner = (legacyOwner?: string) => invoke<CollaborationMaintenanceOwner>(
  "get_collaboration_maintenance_owner",
  { params: legacyOwner ? { legacyOwner } : {} },
);
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
export const openSetupDiagnosticsDirectory = async () => {
  const path = await invoke<string>("get_setup_diagnostics_directory");
  await invoke<void>("open_folder", { path });
  return path;
};
export const exportSetupDiagnosticsBundle = (destination: string) => (
  invoke<string>("export_setup_diagnostics_bundle", { destination })
);
export const applyTerminalIntegration = () => invoke<TerminalIntegrationStatus>("apply_terminal_integration");
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

/**
 * Gateway 开机自启（系统服务）状态 — see src-tauri/src/commands/gateway_service.rs
 * 仅 Native 运行时 supported；enabled 表示服务已注册并被系统加载。
 */
export interface GatewayAutostartStatus {
  supported: boolean;
  enabled: boolean;
  serviceLabel: string | null;
}
export const gatewayAutostartStatus = () => invoke<GatewayAutostartStatus>("gateway_autostart_status");

/**
 * 状态目录分裂检测 — see src-tauri/src/commands/state_dir_probe.rs
 * split=true 表示选定目录与系统默认目录(~/.openclaw)不同,且默认目录也
 * 存在一份 OpenClaw 配置(外部命令/服务会读取它,造成配置不一致)。
 */
export interface StateDirSplit {
  split: boolean;
  activeDir: string;
  defaultDir: string;
  defaultHasConfig: boolean;
}
export const detectStateDirSplit = () => invoke<StateDirSplit>("detect_state_dir_split");
export const enableGatewayAutostart = () => invoke<GatewayAutostartStatus>("enable_gateway_autostart");
export const disableGatewayAutostart = () => invoke<GatewayAutostartStatus>("disable_gateway_autostart");

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

export const resolveGatewayRuntimeIdentity = (observation: GatewayHelloObservation) =>
  invoke<RuntimeIdentity>('resolve_gateway_runtime_identity', { observation });

export const getGatewayRuntimeIdentity = () =>
  invoke<RuntimeIdentity | null>('get_gateway_runtime_identity');

export const clearGatewayRuntimeIdentity = (params: ClearRuntimeIdentityParams) =>
  invoke<boolean>('clear_gateway_runtime_identity', { params });

export const probeCollaborationBootstrap = (params: BootstrapProbeParams = {}) =>
  invoke<CollaborationBootstrapProbe>('collaboration_bootstrap_probe', { params });

export const applyCollaborationBootstrap = (params: BootstrapApplyParams) =>
  invoke<CollaborationBootstrapResult>('collaboration_bootstrap_apply', { params });

export const getCollaborationBootstrapStatus = () =>
  invoke<CollaborationBootstrapStatus>('collaboration_bootstrap_status');

export const recoverCollaborationBootstrap = (params: BootstrapRecoverParams) =>
  invoke<CollaborationBootstrapResult>('collaboration_bootstrap_recover', { params });

export const abandonCollaborationBootstrap = (params: BootstrapAbandonParams) =>
  invoke<CollaborationBootstrapAbandonResult>('collaboration_bootstrap_abandon', { params });

export const confirmCollaborationBootstrapHealth = (params: BootstrapConfirmHealthParams) =>
  invoke<CollaborationBootstrapResult>('collaboration_bootstrap_confirm_health', { params });

export const restartCollaborationBootstrapGateway = (params: BootstrapRestartParams) =>
  invoke<CollaborationBootstrapRestartResult>('collaboration_bootstrap_restart', { params });

export const configureCollaborationBootstrap = (params: BootstrapConfigureParams) =>
  invoke<CollaborationBootstrapConfigureResult>('collaboration_bootstrap_configure', { params });

export type GatewayCredentialPersistence = 'system' | 'session_only' | 'unsupported';

export interface GatewayCredentialResult {
  runtimeKey: string;
  persistence: GatewayCredentialPersistence;
  token: string | null;
  migrated: boolean;
}

export interface GatewayCredentialKeyParams {
  runtimeKey: string;
  deviceId: string;
}

export interface StoreGatewayCredentialParams extends GatewayCredentialKeyParams {
  token: string;
}

export interface MigrateGatewayCredentialParams extends GatewayCredentialKeyParams {
  legacyToken: string;
}

export const getGatewayCredential = (params: GatewayCredentialKeyParams) =>
  invoke<GatewayCredentialResult>('get_gateway_credential', { params });

export const storeGatewayCredential = (params: StoreGatewayCredentialParams) =>
  invoke<GatewayCredentialResult>('store_gateway_credential', { params });

export const deleteGatewayCredential = (params: GatewayCredentialKeyParams) =>
  invoke<GatewayCredentialResult>('delete_gateway_credential', { params });

export const migrateGatewayCredential = (params: MigrateGatewayCredentialParams) =>
  invoke<GatewayCredentialResult>('migrate_gateway_credential', { params });
