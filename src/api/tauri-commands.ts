import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from '@tauri-apps/api/window';
import { presentVoiceWakeWindow } from '@/services/voice/VoiceWakeWindowPresenter';
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
import type { GatewayRuntimeConfig } from '@/types/openclawConfig';

export type VoiceWakeCaptureMode = 'dictation' | 'wake_word';

export interface VoiceWakeStatus {
  listening: boolean;
  mode: VoiceWakeCaptureMode | null;
}

export interface VoiceWakeDetectorStatus {
  available: boolean;
  modelId: string | null;
  directory: string | null;
  keywords: string[];
  reason: string | null;
}

function voiceWakeContractError(command: string): Error {
  return new Error(`${command} returned an invalid native contract`);
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error('invalid optional string');
  return value;
}

function nonEmptyStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('invalid string array');
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 128) {
      throw new Error('invalid string array entry');
    }
    result.push(entry);
  }
  return result;
}

function parseVoiceWakeStatus(command: string, value: unknown): VoiceWakeStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw voiceWakeContractError(command);
  const record = value as Record<string, unknown>;
  if (typeof record.listening !== 'boolean') throw voiceWakeContractError(command);
  const mode = optionalString(record.mode);
  if (mode !== null && mode !== 'dictation' && mode !== 'wake_word') throw voiceWakeContractError(command);
  return { listening: record.listening, mode };
}

function parseVoiceWakeDetectorStatus(command: string, value: unknown): VoiceWakeDetectorStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw voiceWakeContractError(command);
  const record = value as Record<string, unknown>;
  if (typeof record.available !== 'boolean') throw voiceWakeContractError(command);
  try {
    return {
      available: record.available,
      modelId: optionalString(record.modelId),
      directory: optionalString(record.directory),
      keywords: nonEmptyStringArray(record.keywords),
      reason: optionalString(record.reason),
    };
  } catch {
    throw voiceWakeContractError(command);
  }
}

export const getVoiceWakeStatus = async (): Promise<VoiceWakeStatus> => (
  parseVoiceWakeStatus('voice_wake_status', await invoke<unknown>('voice_wake_status'))
);

export const startVoiceWake = async (
  mode: VoiceWakeCaptureMode,
  options: { streamPcm?: boolean } = {},
): Promise<VoiceWakeStatus> => (
  parseVoiceWakeStatus('voice_wake_start', await invoke<unknown>('voice_wake_start', {
    mode,
    streamPcm: options.streamPcm ?? false,
  }))
);

export const stopVoiceWake = async (): Promise<VoiceWakeStatus> => (
  parseVoiceWakeStatus('voice_wake_stop', await invoke<unknown>('voice_wake_stop'))
);

export const playTalkPcm = (audioBase64: string) => invoke<void>('voice_talk_play_pcm', {
  audioBase64,
  sampleRateHz: 24_000,
  channels: 1,
});

export const stopTalkPlayback = () => invoke<void>('voice_talk_stop_playback');

export const finishTalkPlayback = () => invoke<void>('voice_talk_finish_playback');

export const getVoiceWakeDetectorStatus = async (): Promise<VoiceWakeDetectorStatus> => (
  parseVoiceWakeDetectorStatus(
    'voice_wake_detector_status',
    await invoke<unknown>('voice_wake_detector_status'),
  )
);

export const setVoiceWakeModelDirectory = async (directory: string): Promise<VoiceWakeDetectorStatus> => (
  parseVoiceWakeDetectorStatus(
    'voice_wake_set_model_directory',
    await invoke<unknown>('voice_wake_set_model_directory', { directory }),
  )
);

export const presentCurrentWindowForVoiceWake = () => (
  presentVoiceWakeWindow(getCurrentWindow())
);

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
  /** Newer than the range this JunQi build was verified against; usable, but flagged. */
  version_beyond_verified_range: boolean;
  error: string | null;
}
export interface DockerStatus { available: boolean; version: string | null; daemon_running: boolean; unsupported_reason: string | null; image_available: boolean; }
export interface GatewayStatus { running: boolean; port: number; pid: number | null; token: string | null; }
export interface SetupNodeStatus {
  node: NodeStatus;
  npm: NpmStatus;
  requirement: string | null;
  requirementError: string | null;
}
export interface SetupOperationCancellationResult {
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
  credential_scope: string;
}
export interface GatewayProcessStatus {
  running: boolean;
  port: number;
  pid: number | null;
  token: string | null;
}
export interface BrokenGatewayPlugin {
  id: string;
  version: string | null;
  reason: string;
  detail: string | null;
}
export interface PluginHealOutcome {
  id: string;
  healed: boolean;
  attempted: string[];
  error: string | null;
}
export type GatewayRecoveryRecommendation = 'retry' | 'repair' | 'inspect_config' | 'select_storage';
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

export interface PersistentNotificationItem {
  id: string;
  level: string;
  title: string;
  body: string;
  bodyZh: string | null;
  agent?: string | null;
  dedupeKey?: string | null;
  url: string | null;
  createdAt: string;
  isRead: boolean;
}

export interface PersistentNotificationResult {
  notifications: PersistentNotificationItem[];
  unreadCount: number;
}

export interface PersistentNotificationPushResult {
  item: PersistentNotificationItem;
  inserted: boolean;
}

export interface PersistentNotificationInput {
  level: string;
  title: string;
  body: string;
  url?: string | null;
  agent?: string | null;
  dedupeKey?: string | null;
}

export const getPersistentNotifications = () => (
  invoke<PersistentNotificationResult>('get_notifications')
);
export const pushPersistentNotification = (notification: PersistentNotificationInput) => (
  invoke<PersistentNotificationPushResult>('push_notification', {
    level: notification.level,
    title: notification.title,
    body: notification.body,
    url: notification.url ?? null,
    agent: notification.agent ?? null,
    dedupeKey: notification.dedupeKey ?? null,
  })
);
export const markPersistentNotificationRead = (id: string) => (
  invoke<void>('mark_notification_read', { id })
);
export const markPersistentNotificationsRead = (ids?: readonly string[]) => (
  invoke<void>('mark_all_notifications_read', ids ? { ids: [...ids] } : {})
);
export const clearPersistentNotifications = (ids?: readonly string[]) => (
  invoke<void>('clear_notifications', ids ? { ids: [...ids] } : {})
);

export interface SkillHubConfig {
  hubProjectId?: string | null;
  hubPath?: string | null;
  createdAt?: number | null;
}

export interface SkillHubSkill {
  name: string;
  displayName?: string;
  description?: string;
  path: string;
  hasError?: string;
}

export interface SkillHubInstallation {
  skillName: string;
  projectId: string;
  agent: string;
  installedAt: number;
  linkPath: string;
  targetPath: string;
  health?: string;
}

export interface SkillHubConflict {
  existingKind: string;
  existingTarget?: string | null;
  linkPath: string;
}

export interface SkillHubInstallResult {
  ok: boolean;
  conflict?: SkillHubConflict | null;
  alreadyInstalled?: boolean;
  skipped?: boolean;
  cancelled?: boolean;
  installation?: SkillHubInstallation | null;
}

export interface SkillHubDeleteResult {
  ok: boolean;
  removedLinks: number;
}

export type SkillHubInstallStrategy = 'detect' | 'skip' | 'overwrite' | 'cancel';

export const getSkillHubConfig = () => invoke<SkillHubConfig>('get_skill_hub_config');
export const setSkillHubPath = (path: string) => invoke('set_skill_hub_path', { path });
export const clearSkillHub = () => invoke<void>('clear_skill_hub');
export const listSkillHubSkills = () => invoke<SkillHubSkill[]>('list_skills');
export const listSkillHubInstallations = (skillName?: string) => (
  invoke<SkillHubInstallation[]>('list_skill_installations', { skillName: skillName ?? null })
);
export const installSkillHubSkill = (input: {
  skillName: string;
  skillPath: string;
  projectId: string;
  agent: 'claude' | 'codex';
  strategy: SkillHubInstallStrategy;
}) => invoke<SkillHubInstallResult>('install_skill', input);
export const uninstallSkillHubSkill = (input: {
  skillName: string;
  projectId: string;
  agent: string;
}) => invoke<void>('uninstall_skill', input);
export const deleteSkillHubSkill = (skillName: string, skillPath: string) => (
  invoke<SkillHubDeleteResult>('delete_skill', { skillName, skillPath })
);

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
  invoke<SetupNodeStatus>("repair_setup_node_runtime", { operationId })
);
export const checkGit = () => invoke<GitStatus>("check_git");
export const checkOpenclaw = () => invoke<OpenclawStatus>("check_openclaw");
export const checkOpenclawUpdate = () => invoke<OpenclawUpdateStatus>("check_openclaw_update");
export const updateOpenclaw = () => invoke<OpenclawUpdateResult>("update_openclaw");
export const repairOpenclaw = () => invoke<boolean>('repair_openclaw');
export const diagnoseGatewayRecovery = (error: string) => (
  invoke<GatewayRecoveryRecommendation>('diagnose_gateway_recovery', { error })
);
/** Durable per-installation owner used to recover a persisted collaboration lease. */
export const getCollaborationMaintenanceOwner = (legacyOwner?: string) => invoke<CollaborationMaintenanceOwner>(
  "get_collaboration_maintenance_owner",
  { params: legacyOwner ? { legacyOwner } : {} },
);
export const runMaintenanceScan = () => invoke<MaintenanceReport>("run_maintenance_scan");
export const installNode = (force = false, operationId?: string) => (
  invoke<SetupNodeStatus>("install_node", { force, operationId })
);
export const installGit = (operationId?: string) => (
  invoke<string>("install_git", { operationId })
);
export const cancelSetupOperation = (operationId: string) => (
  invoke<SetupOperationCancellationResult>("cancel_setup_operation", { operationId })
);
export const installOpenclaw = (operationId?: string) => invoke<string>("install_openclaw", { operationId });
export const reinstallOpenclaw = (operationId?: string) => invoke<string>("reinstall_openclaw", { operationId });
export const relocateOpenclaw = (operationId?: string) => invoke<string>("relocate_openclaw", { operationId });
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
  port == null ? invoke<GatewayStatus>("start_gateway") : invoke<GatewayStatus>("start_gateway", { port })
);
export const restartGateway = (port?: number) => (
  port == null ? invoke<GatewayStatus>('restart_gateway', {}) : invoke<GatewayStatus>('restart_gateway', { port })
);
export const checkDocker = () => invoke<DockerStatus>("check_docker");
export const pullOpenclawImage = (tag?: string, operationId?: string) => (
  invoke<string>("pull_openclaw_image", { tag, operationId })
);
export const startDockerGateway = (port?: number, tag?: string) => invoke<GatewayStatus>("start_docker_gateway", { port, tag });
export const detectGatewayConfig = () => invoke<GatewayConfigInfo>("detect_gateway_config");
/** Resolve the selected runtime credential through OpenClaw without exposing its config form. */
export const getGatewayToken = () => invoke<string>('get_gateway_token');
/** Compatibility-only migration source for pre-credential-provider Gateway tokens. */
export const getLegacyGatewayCredential = (endpoint: string, scope?: string) => (
  invoke<string | null>('get_legacy_gateway_credential', { endpoint, scope: scope ?? null })
);
export const deleteLegacyGatewayCredential = (endpoint: string, scope?: string) => (
  invoke<void>('delete_legacy_gateway_credential', { endpoint, scope: scope ?? null })
);

/** Probe a concrete Gateway port for compatibility surfaces such as Control UI. */
export const probeGatewayPort = (port?: number) => (
  port === undefined
    ? invoke<boolean>('probe_gateway_port', {})
    : invoke<boolean>('probe_gateway_port', { port })
);
export const openGatewayControlUi = () => invoke<void>('open_control_ui');

export interface GatewayRescueTarget {
  providerId: string;
  modelId: string;
  modelRef: string;
  source: 'primary' | 'configured';
}

export interface GatewayRescueMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GatewayRescueContext {
  error: string;
  logs?: string;
}

export interface GatewayRescueChatRequest {
  modelRef: string;
  messages: GatewayRescueMessage[];
  context: GatewayRescueContext;
}

export interface GatewayRescueChatResponse {
  text: string;
}

export const listGatewayRescueTargets = () => (
  invoke<GatewayRescueTarget[]>('list_gateway_rescue_targets')
);
export const gatewayRescueChat = (req: GatewayRescueChatRequest) => (
  invoke<GatewayRescueChatResponse>('gateway_rescue_chat', { req })
);

export interface OpenClawMediaPreviewResult {
  success: boolean;
  url?: string | null;
  error?: string | null;
}

/** Creates a state-directory-scoped preview URL for a persisted OpenClaw attachment. */
export const createOpenClawMediaPreviewUrl = (path: string) => (
  invoke<OpenClawMediaPreviewResult>('create_openclaw_media_preview_url', { path })
);

export interface ManagedFileOpenResult {
  success: boolean;
}

export interface ManagedFileExistsResult {
  success: boolean;
  exists: boolean;
}

export interface ManagedFileTextResult {
  success: boolean;
  content: string | null;
  byte_size: number;
  truncated: boolean;
  error: string | null;
}

export interface ManagedFilePreviewUrlResult {
  success: boolean;
  url: string | null;
  error: string | null;
}

export const openManagedFile = (path: string) => (
  invoke<ManagedFileOpenResult>('managed_file_open', { path })
);
export const revealManagedFile = (path: string) => (
  invoke<ManagedFileOpenResult>('managed_file_reveal', { path })
);
export const managedFileExists = (path: string) => (
  invoke<ManagedFileExistsResult>('managed_file_exists', { path })
);
export const readManagedFileText = (path: string) => (
  invoke<ManagedFileTextResult>('read_file_text', { path })
);
export const createManagedFilePreviewUrl = (path: string) => (
  invoke<ManagedFilePreviewUrlResult>('create_file_preview_url', { path })
);

export interface ScreenshotCapturePayload {
  success: boolean;
  data?: string;
}

export interface ScreenshotWindowSource {
  id: string;
  name: string;
  thumbnail: string;
}

export const captureInteractiveScreenshot = () => (
  invoke<ScreenshotCapturePayload>('screenshot_interactive')
);
export const captureFullscreenScreenshot = () => (
  invoke<ScreenshotCapturePayload>('screenshot_fullscreen')
);
export const listScreenshotWindows = () => (
  invoke<ScreenshotWindowSource[]>('screenshot_list_windows')
);
export const captureScreenshotWindow = (id: string) => (
  invoke<ScreenshotCapturePayload>('screenshot_capture_window', { id })
);

export type SharePackageKind = 'agent' | 'skill';
export interface SharePackageFile { path: string; size: number; executable: boolean; sensitive: boolean; }
export interface SharePackageSourceEntry extends Omit<SharePackageFile, 'executable'> { kind: 'file' | 'directory'; recommended: boolean; excludedReason?: string; }
export interface SharePackageSourceScan { root: string; entries: SharePackageSourceEntry[]; omittedDirectories: string[]; }
export interface SharePackageManifest { format: string; version: number; kind: SharePackageKind; name: string; createdAt: number; metadata: Record<string, unknown>; files: SharePackageFile[]; }
export interface SharePackageExportRequest { kind: SharePackageKind; name: string; root: string; destination: string; selectedPaths: string[]; includeSensitive: boolean; metadata: Record<string, unknown>; }
export interface SharePackageExportResult { destination: string; fileCount: number; totalBytes: number; }
export interface SharePackageInspectResult { packagePath: string; manifest: SharePackageManifest; }
export interface SharePackageImportPreviewRequest { sourcePath: string; targetParent: string; targetName: string; selectedPaths: string[]; }
export interface SharePackageImportPreview { targetPath: string; selectedFiles: SharePackageFile[]; conflicts: Array<{ path: string; existingKind: 'file' | 'directory' | 'symlink' }>; }
export interface SharePackageImportRequest extends SharePackageImportPreviewRequest { conflictStrategy: 'error' | 'skip' | 'overwrite'; }
export interface SharePackageImportResult { targetPath: string; importedFiles: number; skippedFiles: number; }
export const scanSharePackageSource = (root: string) => invoke<SharePackageSourceScan>('scan_share_package_source', { root });
export const exportSharePackage = (request: SharePackageExportRequest) => invoke<SharePackageExportResult>('export_share_package', { request });
export const inspectSharePackage = (sourcePath: string) => invoke<SharePackageInspectResult>('inspect_share_package', { sourcePath });
export const previewSharePackageImport = (request: SharePackageImportPreviewRequest) => invoke<SharePackageImportPreview>('preview_share_package_import', { request });
export const importSharePackage = (request: SharePackageImportRequest) => invoke<SharePackageImportResult>('import_share_package', { request });

export interface VoiceRecordingStartResult { success: boolean; error?: string; }
export interface VoiceRecordingStopResult { success: boolean; data?: string; duration?: number; error?: string; }
export const startVoiceRecording = () => invoke<VoiceRecordingStartResult>('voice_start_recording');
export const stopVoiceRecording = () => invoke<VoiceRecordingStopResult>('voice_stop_recording');

export interface ActiveOpenClawModelProbe {
  ready: boolean;
  model: string | null;
  detail: string | null;
}

/** Selected-runtime OpenClaw configuration file contract. */
export interface OpenclawConfigReadResult {
  data: GatewayRuntimeConfig;
  path: string;
  exists: boolean;
  revision: string;
}

export interface OpenclawConfigValidationResult {
  valid: boolean;
  path: string;
  exists: boolean;
  error?: string;
}

export interface OpenclawConfigWriteResult {
  revision: string;
}

export const readOpenclawConfig = () => invoke<OpenclawConfigReadResult>('read_config');
export const validateOpenclawConfig = () => (
  invoke<OpenclawConfigValidationResult>('validate_openclaw_config')
);
export const parseOpenclawConfigText = (raw: string) => (
  invoke<GatewayRuntimeConfig>('parse_openclaw_config_text', { raw })
);
export const writeOpenclawConfig = (
  data: GatewayRuntimeConfig,
  expectedRevision?: string,
) => invoke<OpenclawConfigWriteResult>('write_config', {
  json: JSON.stringify(data, null, 2),
  expectedRevision: expectedRevision ?? null,
});

/** OpenClaw-owned provider metadata remains opaque until its service parser validates it. */
export const getOpenclawProviderCatalog = (provider?: string) => (
  invoke<unknown>('get_openclaw_provider_catalog', { provider: provider ?? null })
);
export const getOpenclawConfigSchema = () => invoke<unknown>('get_openclaw_config_schema');
export const getOpenclawAuthProfiles = (provider?: string) => (
  invoke<unknown>('get_openclaw_auth_profiles', { provider: provider ?? null })
);
export const probeOpenclawProvider = (
  config: unknown,
  provider: string,
  profileKey?: string,
) => invoke<unknown>('probe_openclaw_provider', {
  json: JSON.stringify(config),
  provider,
  profileKey: profileKey ?? null,
});
export const probeActiveOpenclawModel = () => (
  invoke<ActiveOpenClawModelProbe>('probe_active_openclaw_model')
);

/** OpenClaw-owned channel metadata remains opaque until its service parser validates it. */
export const getOpenclawChannelCatalog = () => invoke<unknown>('get_openclaw_channel_catalog');
export const installOpenclawChannelPlugin = (channel: string) => (
  invoke<unknown>('install_openclaw_channel_plugin', { channel })
);
export const getOpenclawChannelCapabilities = (channel: string) => (
  invoke<unknown>('get_openclaw_channel_capabilities', { channel })
);
export const getOpenclawChannelStatus = (channel?: string, probe = false) => (
  invoke<unknown>('get_openclaw_channel_status', { channel: channel ?? null, probe })
);
export const getOpenclawChannelLogs = (channel?: string, lines = 200) => (
  invoke<unknown>('get_openclaw_channel_logs', { channel: channel ?? null, lines })
);
export const listBrokenGatewayPlugins = (error?: string) => (
  invoke<BrokenGatewayPlugin[]>('list_broken_gateway_plugins', { error: error ?? null })
);
export const healOpenclawPlugin = (id: string, reason?: string) => (
  invoke<PluginHealOutcome>('heal_openclaw_plugin', { id, reason: reason ?? null })
);
export const disableOpenclawPlugin = (id: string) => invoke<void>('disable_openclaw_plugin', { id });
export const setActiveGatewayRuntime = (mode: GatewayRuntimeMode) => (
  invoke<void>("set_active_gateway_runtime", { mode })
);
export const rollbackActiveGatewayRuntime = (mode: GatewayRuntimeMode) => (
  invoke<void>("rollback_active_gateway_runtime", { mode })
);
export const commitSetupGatewayRuntime = (mode: GatewayRuntimeMode) => (
  invoke<boolean>("commit_setup_gateway_runtime", { mode })
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
  /** Compatibility field retained by Rust; selected-runtime-only startup keeps it false. */
  attempted_fallback: boolean;
  error: string | null;
}

/**
 * Starts and probes only the persisted runtime selected by the user.
 * It never silently switches between Native and Docker.
 */
export const ensureGatewayRunning = () => invoke<EnsureResult>("ensure_gateway_running");
/**
 * Stops the Gateway of the currently selected runtime. `stop_gateway` dispatches
 * to Docker itself, so callers must not pick a runtime-specific command and risk
 * acting on the runtime the user did not select.
 */
export const stopGateway = () => invoke<string>("stop_gateway");

/** Probe the selected runtime's authenticated Gateway, never an arbitrary listener. */
export const probeSelectedGateway = (port?: number) => (
  port === undefined
    ? invoke<boolean>('probe_selected_gateway', {})
    : invoke<boolean>('probe_selected_gateway', { port })
);

/** Return the JunQi-managed process status used during setup polling. */
export const getGatewayProcessStatus = () => invoke<GatewayProcessStatus>('gateway_status');

/**
 * Gateway 开机自启（系统服务）状态 — see src-tauri/src/commands/gateway_service.rs
 * 仅 Native 运行时 supported；enabled 表示服务已注册并被系统加载。
 */
export interface GatewayAutostartStatus {
  supported: boolean;
  enabled: boolean;
  running: boolean;
  serviceKind: 'macos_launch_agent' | 'windows_scheduled_task' | 'native_service';
}

export type GatewayLifecycleState = 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting';
export type GatewaySupervisorRuntimeMode = 'none' | 'external' | 'system_service' | 'managed_child' | 'docker';
export interface GatewayRuntimeSnapshot {
  lifecycle: GatewayLifecycleState;
  mode: GatewaySupervisorRuntimeMode;
  restarting: boolean;
  port: number;
  managed_pid: number | null;
}
export const getGatewayRuntimeSnapshot = () => (
  invoke<GatewayRuntimeSnapshot>('get_gateway_runtime_snapshot')
);
export const gatewayAutostartStatus = () => invoke<GatewayAutostartStatus>("gateway_autostart_status");
export const handoffGatewayToOfficialService = () => (
  invoke<boolean>("handoff_gateway_to_official_service")
);

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
export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'child_stdout' | 'child_stderr' | 'docker_stdout' | 'docker_stderr' | 'lifecycle';
export interface LogEntry {
  timestamp_ms: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  /** Translation key for lifecycle lines the app authors; absent for process output. */
  key?: string | null;
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
