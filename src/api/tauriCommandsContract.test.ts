import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const commands = readFileSync(new URL('./tauri-commands.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('./tauri-adapter.ts', import.meta.url), 'utf8');
const logPanel = readFileSync(
  new URL('../components/settings/GatewayLogPanel.tsx', import.meta.url),
  'utf8',
);
const wizard = readFileSync(
  new URL('../hooks/useSetupFlow/useWizardSession.ts', import.meta.url),
  'utf8',
);
const setupFlow = readFileSync(new URL('../hooks/useSetupFlow/index.ts', import.meta.url), 'utf8');
const environmentReview = readFileSync(
  new URL('../hooks/useSetupFlow/useSetupEnvironmentReview.ts', import.meta.url),
  'utf8',
);
const pluginRecovery = readFileSync(
  new URL('../services/gateway/pluginRecovery.ts', import.meta.url),
  'utf8',
);
const openclawRepair = readFileSync(
  new URL('../services/gateway/openclawRepair.ts', import.meta.url),
  'utf8',
);
const providerRuntime = readFileSync(
  new URL('../services/openclawProviderRuntime.ts', import.meta.url),
  'utf8',
);
const channelRuntime = readFileSync(
  new URL('../services/openclawChannelRuntime.ts', import.meta.url),
  'utf8',
);
const configSchema = readFileSync(
  new URL('../services/openclawConfigSchema.ts', import.meta.url),
  'utf8',
);
const channelsCenter = readFileSync(
  new URL('../pages/ChannelsCenter/index.tsx', import.meta.url),
  'utf8',
);
const configManager = readFileSync(
  new URL('../pages/ConfigManager/index.tsx', import.meta.url),
  'utf8',
);
const providersTab = readFileSync(
  new URL('../pages/ConfigManager/ProvidersTab.tsx', import.meta.url),
  'utf8',
);
const eventModal = readFileSync(
  new URL('../pages/Calendar/EventModal.tsx', import.meta.url),
  'utf8',
);
const gatewayProcessObservation = readFileSync(
  new URL('../services/gateway/gatewayProcessObservation.ts', import.meta.url),
  'utf8',
);
const gatewayConnectionManager = readFileSync(
  new URL('../services/gateway/GatewayConnectionManager.ts', import.meta.url),
  'utf8',
);
const gatewayActionExecutor = readFileSync(
  new URL('../services/gateway/GatewayActionExecutor.ts', import.meta.url),
  'utf8',
);
const gatewayConnectionTargetResolver = readFileSync(
  new URL('../services/gateway/GatewayConnectionTargetResolver.ts', import.meta.url),
  'utf8',
);
const gatewayRescue = readFileSync(new URL('../services/gatewayRescue.ts', import.meta.url), 'utf8');
const openclawMediaPreview = readFileSync(
  new URL('../services/chat/openclawMediaPreview.ts', import.meta.url),
  'utf8',
);
const gatewayLifecyclePanel = readFileSync(
  new URL('../components/settings/GatewayLifecyclePanel.tsx', import.meta.url),
  'utf8',
);
const gatewayConnection = readFileSync(
  new URL('../services/gateway/Connection.ts', import.meta.url),
  'utf8',
);
const gatewayCredentialBinding = readFileSync(
  new URL('../services/gateway/GatewayCredentialBinding.ts', import.meta.url),
  'utf8',
);
const gatewayControlUi = readFileSync(
  new URL('../services/gateway/GatewayControlUi.ts', import.meta.url),
  'utf8',
);
const collaborationChatProvider = readFileSync(
  new URL('../components/Chat/CollaborationChatProvider.tsx', import.meta.url),
  'utf8',
);
const settingsPage = readFileSync(new URL('../pages/SettingsPage.tsx', import.meta.url), 'utf8');
const gatewayErrorScreen = readFileSync(
  new URL('../components/GatewayErrorScreen.tsx', import.meta.url),
  'utf8',
);
const gatewayProcessRecoveryHook = readFileSync(
  new URL('../hooks/useGatewayProcessRecovery.ts', import.meta.url),
  'utf8',
);
const persistentNotificationRepository = readFileSync(
  new URL('../services/persistentNotifications.ts', import.meta.url),
  'utf8',
);
const notificationService = readFileSync(
  new URL('../services/notifications.ts', import.meta.url),
  'utf8',
);
const persistentNotificationHook = readFileSync(
  new URL('../hooks/usePersistentNotifications.ts', import.meta.url),
  'utf8',
);
const notificationCommand = readFileSync(
  new URL('../../src-tauri/src/commands/notification.rs', import.meta.url),
  'utf8',
);
const terminalShellPanel = readFileSync(
  new URL('../components/Terminal/ShellTerminalPanel.tsx', import.meta.url),
  'utf8',
);
const skillHubManager = readFileSync(
  new URL('../pages/SkillHubManager.tsx', import.meta.url),
  'utf8',
);
const skillHubRuntime = readFileSync(
  new URL('../services/skillHubRuntime.ts', import.meta.url),
  'utf8',
);
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const commandPalette = readFileSync(new URL('../components/CommandPalette.tsx', import.meta.url), 'utf8');
const chatView = readFileSync(new URL('../components/Chat/ChatView.tsx', import.meta.url), 'utf8');
const gateway = readFileSync(
  new URL('../../src-tauri/src/commands/gateway.rs', import.meta.url),
  'utf8',
);
const ensure = readFileSync(
  new URL('../../src-tauri/src/commands/ensure.rs', import.meta.url),
  'utf8',
);
const gatewayProcess = readFileSync(
  new URL('../../src-tauri/src/state/gateway_process.rs', import.meta.url),
  'utf8',
);

test('Tauri command wrappers match the Rust Gateway result contracts', () => {
  assert.match(gateway, /pub async fn start_gateway\([\s\S]*?Result<GatewayStatus, String>/);
  assert.match(commands, /invoke<GatewayStatus>\("start_gateway"/);
  assert.doesNotMatch(commands, /invoke<any>\("start_gateway"/);
  assert.match(gateway, /pub async fn restart_gateway\([\s\S]*?Result<GatewayStatus, String>/);
  assert.match(commands, /export const restartGateway = \(port\?: number\)/);

  const rustLogLevel = gatewayProcess.slice(
    gatewayProcess.indexOf('pub enum LogLevel'),
    gatewayProcess.indexOf('pub enum LogSource'),
  );
  assert.match(rustLogLevel, /Info/);
  assert.match(rustLogLevel, /Warn/);
  assert.match(rustLogLevel, /Error/);
  assert.doesNotMatch(rustLogLevel, /\n\s+(?:Trace|Debug),/);
  assert.match(commands, /export type LogLevel = 'info' \| 'warn' \| 'error'/);
});

test('ensure documentation follows the selected-runtime-only Rust policy', () => {
  assert.match(ensure, /切换运行时必须经过显式设置流程/);
  assert.match(commands, /only the persisted runtime selected by the user/);
  assert.doesNotMatch(commands, /Tries native|Debounced to one call per 60s/);
});

test('shared Gateway commands have one renderer invocation boundary', () => {
  for (const source of [
    adapter,
    logPanel,
    wizard,
    setupFlow,
    environmentReview,
    pluginRecovery,
    openclawRepair,
    gatewayRescue,
    openclawMediaPreview,
    gatewayLifecyclePanel,
  ]) {
    assert.doesNotMatch(
      source,
      /invoke(?:<[^>]+>)?\(["'](?:check_openclaw|start_gateway|restart_gateway|ensure_gateway_running|get_gateway_logs|clear_gateway_logs|handoff_gateway_to_official_service|probe_selected_gateway|gateway_status|repair_openclaw|diagnose_gateway_recovery|list_broken_gateway_plugins|heal_openclaw_plugin|disable_openclaw_plugin|list_gateway_rescue_targets|gateway_rescue_chat|create_openclaw_media_preview_url|get_gateway_runtime_snapshot|probe_gateway_port|open_control_ui|get_legacy_gateway_credential|delete_legacy_gateway_credential)["']/,
    );
  }
  assert.match(adapter, /await checkOpenclaw\(\)/);
  assert.doesNotMatch(adapter, /(?:startGateway|ensureGatewayRunning|restartGateway)\(/);
  assert.match(logPanel, /await getGatewayLogs\(200\)/);
  assert.match(wizard, /await handoffGatewayToOfficialService\(\)/);
  assert.match(wizard, /await probeSelectedGateway\(\)/);
  assert.match(setupFlow, /await probeSelectedGateway\(port\)/);
  assert.match(environmentReview, /await probeSelectedGateway\(\)/);
  assert.match(commands, /export const probeSelectedGateway = \(port\?: number\)/);
  assert.match(commands, /export const getGatewayProcessStatus = \(\) => invoke<GatewayProcessStatus>\('gateway_status'\)/);
  assert.match(commands, /export const getGatewayToken = \(\) => invoke<string>\('get_gateway_token'\)/);
  assert.match(commands, /export const repairOpenclaw = \(\) => invoke<boolean>\('repair_openclaw'\)/);
  assert.match(commands, /invoke<void>\("approve_selected_gateway_device", \{ requestId \}\)/);
  assert.match(appSource, /await approveSelectedGatewayDevice\(requestId\)/);
  assert.match(commands, /export const diagnoseGatewayRecovery = \(error: string\)/);
  assert.match(commands, /export const listGatewayRescueTargets/);
  assert.match(commands, /export const gatewayRescueChat/);
  assert.match(commands, /export const createOpenClawMediaPreviewUrl/);
  assert.match(commands, /export const getGatewayRuntimeSnapshot/);
  assert.match(commands, /export const getLegacyGatewayCredential/);
  assert.match(commands, /export const deleteLegacyGatewayCredential/);
  assert.match(pluginRecovery, /listBrokenGatewayPluginsCommand\(error\)/);
  assert.match(pluginRecovery, /healOpenclawPluginCommand\(id, reason\)/);
  assert.match(openclawRepair, /createOpenClawRepairCoordinator\(repairOpenclaw\)/);
  assert.match(gatewayRescue, /listGatewayRescueTargets\(\)/);
  assert.match(gatewayRescue, /gatewayRescueChat/);
  assert.match(openclawMediaPreview, /createOpenClawMediaPreviewUrl/);
  assert.match(gatewayLifecyclePanel, /getGatewayRuntimeSnapshot\(\)/);
  assert.match(gatewayConnection, /storeGatewayConnectionDeviceCredential/);
  assert.doesNotMatch(gatewayConnection, /window\.aegis\.pairing/);
  assert.doesNotMatch(adapter, /getStoredGatewayCredentialToken/);
  assert.doesNotMatch(adapter, /storeGatewayConnectionDeviceCredential/);
  assert.match(gatewayCredentialBinding, /resolveGatewayConnectionCredentialRuntimeKey/);
  assert.match(gatewayCredentialBinding, /bindGatewayCredentialToInstance/);
  assert.match(gatewayControlUi, /probeReady: probeSelectedGateway/);
  assert.match(gatewayControlUi, /open: openGatewayControlUi/);
  assert.doesNotMatch(gatewayControlUi, /probeGatewayPort/);
  assert.doesNotMatch(appSource, /window\.aegis\?\.consoleUi/);
  assert.doesNotMatch(settingsPage, /window\.aegis\?\.consoleUi/);
  assert.doesNotMatch(adapter, /pairing:/);
  assert.doesNotMatch(adapter, /consoleUi:/);
  assert.doesNotMatch(adapter, /agentAuth:/);
  assert.doesNotMatch(configManager, /window\.aegis\?\.agentAuth/);
  assert.doesNotMatch(providersTab, /window\.aegis\?\.agentAuth/);
  assert.doesNotMatch(collaborationChatProvider, /window\.aegis\.pairing/);
  assert.doesNotMatch(adapter, /function gatewayDeviceCredentialRuntimeKey/);
  assert.doesNotMatch(adapter, /function migrateNativeLegacyGatewayCredential/);
});

test('OpenClaw provider and channel commands have one typed renderer boundary', () => {
  const commandNames = /(?:get_openclaw_provider_catalog|get_openclaw_config_schema|get_openclaw_auth_profiles|probe_openclaw_provider|probe_active_openclaw_model|get_openclaw_channel_catalog|install_openclaw_channel_plugin|get_openclaw_channel_capabilities|get_openclaw_channel_status|get_openclaw_channel_logs)/;
  for (const source of [
    adapter,
    setupFlow,
    providerRuntime,
    channelRuntime,
    configSchema,
    channelsCenter,
    configManager,
    providersTab,
    eventModal,
    gatewayProcessObservation,
  ]) {
    assert.doesNotMatch(source, new RegExp(`invoke(?:<[^>]+>)?\\(["']${commandNames.source}["']`));
    assert.doesNotMatch(source, /window\.aegis\.(?:providerRuntime|channelRuntime)/);
  }
  assert.match(commands, /export const getOpenclawProviderCatalog/);
  assert.match(commands, /export const probeOpenclawProvider/);
  assert.match(commands, /export const getOpenclawChannelCatalog/);
  assert.match(commands, /export const getOpenclawChannelStatus/);
  assert.match(providerRuntime, /normalizeOfficialProviderCatalog/);
  assert.match(channelRuntime, /loadOfficialChannelStatus/);
});

test('read-only selected Gateway observation uses typed process and authenticated probe commands', () => {
  assert.match(gatewayProcessObservation, /getGatewayProcessStatus\(\)/);
  assert.match(gatewayProcessObservation, /probeSelectedGateway\(status\.port\)/);
  assert.match(gatewayProcessObservation, /loadGatewayProcessLogs/);
  assert.doesNotMatch(gatewayProcessObservation, /window\.aegis/);
  assert.doesNotMatch(gatewayErrorScreen, /window\.aegis\.gateway/);
  assert.doesNotMatch(channelsCenter, /window\.aegis\.gateway/);
  assert.match(gatewayConnectionManager, /subscribeGatewayProcessRuntime/);
  assert.match(gatewayConnectionManager, /ensureSelectedGatewayRuntime/);
  assert.match(gatewayConnectionManager, /restartSelectedGatewayRuntime/);
  assert.doesNotMatch(gatewayConnectionManager, /window\.aegis\.(?:gateway|config)/);
  assert.doesNotMatch(gatewayActionExecutor, /window\.aegis\.(?:gateway|config)/);
  assert.match(gatewayActionExecutor, /resolveGatewayConnectionTarget/);
  assert.doesNotMatch(gatewayConnectionTargetResolver, /window\.aegis/);
  assert.match(gatewayErrorScreen, /useGatewayProcessRecovery\(onRecovered\)/);
  assert.doesNotMatch(gatewayErrorScreen, /window\.aegis\.gateway/);
  assert.match(gatewayProcessRecoveryHook, /subscribeGatewayProcessRuntime/);
  assert.doesNotMatch(appSource, /window\.aegis\?\.gateway/);
  assert.doesNotMatch(commandPalette, /window\.aegis\?\.config/);
  assert.doesNotMatch(chatView, /window\.aegis\?\.config/);
  assert.match(settingsPage, /resolveGatewayConnectionTarget/);
  assert.doesNotMatch(settingsPage, /window\.aegis\?\.config/);
});

test('persistent notification operations share one typed repository boundary', () => {
  assert.match(commands, /export const getPersistentNotifications/);
  assert.match(commands, /export const pushPersistentNotification/);
  assert.match(commands, /PersistentNotificationPushResult/);
  assert.match(notificationCommand, /pub struct NotificationPushResult/);
  assert.match(notificationService, /then\(\(inserted\) =>/);
  assert.match(notificationService, /return result\.inserted;/);
  assert.match(commands, /export const markPersistentNotificationRead/);
  assert.match(commands, /export const markPersistentNotificationsRead/);
  assert.match(commands, /export const clearPersistentNotifications/);
  assert.match(persistentNotificationRepository, /persistentNotificationRepository/);
  assert.match(notificationService, /persistentNotificationRepository\.push/);
  assert.match(persistentNotificationHook, /persistentNotificationRepository\.list/);
  assert.match(terminalShellPanel, /usePersistentNotificationPublisher/);
  assert.match(terminalShellPanel, /markPersistentNotificationRead\(created\.id\)/);
  assert.doesNotMatch(notificationService, /invoke\('push_notification'/);
  assert.doesNotMatch(persistentNotificationHook, /invoke(?:<[^>]+>)?\(/);
  assert.doesNotMatch(terminalShellPanel, /invoke(?:<[^>]+>)?\(['\"](?:push_notification|mark_notification_read)['\"]/);
});

test('local Skill Hub pages use the typed command and runtime boundaries', () => {
  assert.match(commands, /export const listSkillHubSkills/);
  assert.match(commands, /export const installSkillHubSkill/);
  assert.match(commands, /export const uninstallSkillHubSkill/);
  assert.match(commands, /export const deleteSkillHubSkill/);
  assert.match(skillHubRuntime, /loadSkillHubState/);
  assert.doesNotMatch(skillHubRuntime, /window\.aegis/);
  assert.doesNotMatch(skillHubManager, /\binvoke\(/);
  assert.match(skillHubManager, /loadSkillHubState/);
});
