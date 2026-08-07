import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const adapter = source('./tauri-adapter.ts');
const commands = source('./tauri-commands.ts');
const configRuntime = source('../services/openclawConfigRuntime.ts');
const globalTypes = source('../types/global.d.ts');
const configTypes = source('../types/openclawConfig.ts');
const app = source('../App.tsx');
const setupFlow = source('../hooks/useSetupFlow/index.ts');
const channelConfig = source('../services/channelConfig.ts');
const configManager = source('../pages/ConfigManager/index.tsx');
const secretsTab = source('../pages/ConfigManager/SecretsTab.tsx');
const channelsCenter = source('../pages/ChannelsCenter/index.tsx');
const agentSettings = source('../pages/AgentHub/AgentSettingsPanel.tsx');
const gatewayErrorScreen = source('../components/GatewayErrorScreen.tsx');
const channelsTab = source('../pages/ConfigManager/ChannelsTab.tsx');
const agentHub = source('../pages/AgentHub/index.tsx');
const rustConfig = source('../../src-tauri/src/commands/config.rs');
const tauriLib = source('../../src-tauri/src/lib.rs');

test('OpenClaw config reads and imports share the Rust JSON5 contract', () => {
  assert.match(commands, /export const readOpenclawConfig = \(\) => invoke<OpenclawConfigReadResult>\('read_config'\)/);
  assert.match(commands, /export const parseOpenclawConfigText/);
  assert.match(configRuntime, /readOpenclawConfig\(\)/);
  assert.match(configRuntime, /parseOpenclawConfigText\(raw\)/);
  assert.doesNotMatch(commands, /JSON\.parse\(d\.raw/);
  assert.match(rustConfig, /pub struct ConfigData \{[\s\S]*?pub data: serde_json::Value,[\s\S]*?pub revision: String,/);
  assert.match(rustConfig, /pub fn parse_openclaw_config_text\(raw: String\)/);
  assert.match(tauriLib, /commands::config::parse_openclaw_config_text/);
});

test('renderer does not expose a direct OpenClaw config write command', () => {
  assert.doesNotMatch(commands, /writeOpenclawConfig|write_config/);
  assert.match(adapter, /clearLegacyOpenClawConfigBackups\(\)/);
  assert.doesNotMatch(configManager, /aegis-config-backups/);
  assert.doesNotMatch(configManager, /config\.read\([^)]/);
  assert.doesNotMatch(channelsCenter, /config\.read\(detected\.path\)/);
  assert.doesNotMatch(agentSettings, /config\.read\(detected\.path\)/);
  assert.doesNotMatch(agentSettings, /channelConfigPath/);
});

test('active OpenClaw config access crosses one typed renderer boundary', () => {
  const activeConfigCommandNames = /(?:read_config|parse_openclaw_config_text|validate_openclaw_config)/;
  for (const rendererSource of [
    app,
    setupFlow,
    channelConfig,
    configManager,
    channelsCenter,
    agentSettings,
    gatewayErrorScreen,
  ]) {
    assert.doesNotMatch(rendererSource, new RegExp(`invoke(?:<[^>]+>)?\\(["']${activeConfigCommandNames.source}["']`));
    assert.doesNotMatch(rendererSource, /window\.aegis\.config\.(?:detect|read|write|parse)/);
  }
  assert.match(setupFlow, /validateActiveOpenclawConfig/);
  assert.match(configManager, /parseActiveOpenclawConfig/);
  assert.doesNotMatch(app, /readActiveOpenclawConfig/);
  assert.doesNotMatch(channelConfig, /writeActiveOpenclawConfig/);
  assert.doesNotMatch(channelsCenter, /readActiveOpenclawConfig/);
  assert.doesNotMatch(agentSettings, /readActiveOpenclawConfig/);
  assert.doesNotMatch(gatewayErrorScreen, /resetActiveOpenclawConfig/);
});

test('OpenClaw configuration types stay outside the legacy desktop bridge', () => {
  assert.doesNotMatch(globalTypes, /openclawConfig/);
  assert.match(configTypes, /export interface OpenClawConfig/);
  assert.doesNotMatch(adapter, /pages\/ConfigManager\/types/);
});

test('secret provider presentation does not claim unsupported audit or reload operations', () => {
  assert.doesNotMatch(adapter, /secrets:\s*\{/);
  assert.doesNotMatch(globalTypes, /secrets:\s*\{/);
  assert.doesNotMatch(secretsTab, /window\.aegis.*secrets/);
  assert.doesNotMatch(secretsTab, /Secrets Audit|Reload Secrets/);
});

test('retired uploads compatibility bridge cannot reappear as a desktop capability', () => {
  assert.doesNotMatch(adapter, /uploads:\s*\{/);
  assert.doesNotMatch(globalTypes, /uploads\??:\s*\{/);
});

test('retired no-op updater compatibility bridge cannot reappear', () => {
  assert.doesNotMatch(adapter, /update:\s*\{\s*check:\s*async\s*\(\)\s*=>\s*null/);
  assert.doesNotMatch(globalTypes, /^\s*update:\s*\{/m);
});

test('unimplemented calendar compatibility bridge cannot reappear', () => {
  assert.doesNotMatch(globalTypes, /^\s*calendar\??:\s*\{/m);
  assert.doesNotMatch(adapter, /calendar:\s*\{/);
});

test('migrated OpenClaw and local preference bridges cannot reappear', () => {
  const settingsStore = source('../stores/settingsStore.ts');

  assert.doesNotMatch(adapter, /^\s*(?:config|providerRuntime|channelRuntime|gateway|settings):\s*\{/m);
  assert.doesNotMatch(globalTypes, /^\s*(?:config|providerRuntime|channelRuntime|gateway|settings)\??:\s*\{/m);
  assert.doesNotMatch(settingsStore, /window\.aegis\?\.settings/);
});

test('runtime data access has one typed desktop bridge', () => {
  const runtimeData = source('../services/runtimeDataDirectory.ts');
  const settings = source('../pages/SettingsPage.tsx');

  assert.match(adapter, /runtimeData:\s*\{\s*openStateDirectory:/);
  assert.match(globalTypes, /runtimeData\?:\s*\{\s*openStateDirectory:/);
  assert.match(runtimeData, /window\.aegis\?\.runtimeData/);
  assert.match(settings, /openRuntimeDataDirectory/);
  assert.match(gatewayErrorScreen, /openRuntimeDataDirectory/);
  assert.doesNotMatch(settings, /open(?:Gateway|Desktop)LogFile/);
  assert.doesNotMatch(gatewayErrorScreen, /openElectronLogFile/);
});

test('managed chat files use typed commands instead of the legacy desktop bridge', () => {
  const managedRuntime = source('../services/chat/managedFileRuntime.ts');
  const filePreview = source('../services/chat/filePreview.ts');
  const resultCards = source('../components/Chat/ResultCards.tsx');
  const markdownRenderer = source('../components/Chat/ChatMarkdownRenderer.tsx');

  assert.match(commands, /export const openManagedFile/);
  assert.match(commands, /export const revealManagedFile/);
  assert.match(commands, /export const managedFileExists/);
  assert.match(commands, /export const readManagedFileText/);
  assert.match(commands, /export const createManagedFilePreviewUrl/);
  assert.match(managedRuntime, /openManagedFile/);
  assert.match(filePreview, /nativePreviewBridge/);
  assert.match(resultCards, /openLocalManagedFile/);
  assert.match(markdownRenderer, /openLocalManagedFile/);
  assert.doesNotMatch(adapter, /managedFiles:\s*\{/);
  assert.doesNotMatch(globalTypes, /managedFiles\??:\s*\{/);
  assert.doesNotMatch(filePreview, /window\.aegis/);
  assert.doesNotMatch(resultCards, /window\.aegis\??\.managedFiles/);
  assert.doesNotMatch(markdownRenderer, /window\.aegis\??\.managedFiles/);
});

test('chat screenshots use the typed runtime instead of the legacy desktop bridge', () => {
  const screenshotRuntime = source('../services/chat/screenshotRuntime.ts');
  const screenshotPicker = source('../components/Chat/ScreenshotPicker.tsx');

  assert.match(commands, /export const captureInteractiveScreenshot/);
  assert.match(commands, /export const captureFullscreenScreenshot/);
  assert.match(commands, /export const listScreenshotWindows/);
  assert.match(commands, /export const captureScreenshotWindow/);
  assert.match(screenshotRuntime, /normalizeScreenshotFailure/);
  assert.match(screenshotPicker, /screenshotRuntime\.captureInteractive/);
  assert.match(screenshotPicker, /screenshotRuntime\.captureFullscreen/);
  assert.match(screenshotPicker, /screenshotRuntime\.listWindows/);
  assert.doesNotMatch(adapter, /screenshot:\s*\{/);
  assert.doesNotMatch(globalTypes, /screenshot:\s*\{/);
  assert.doesNotMatch(screenshotPicker, /window\.aegis/);
});

test('share packages use the typed runtime instead of the legacy desktop bridge', () => {
  const shareRuntime = source('../services/sharePackagesRuntime.ts');
  const shareDialog = source('../components/shared/SharePackageDialog.tsx');

  assert.match(commands, /export const scanSharePackageSource/);
  assert.match(commands, /export const exportSharePackage/);
  assert.match(commands, /export const inspectSharePackage/);
  assert.match(commands, /export const previewSharePackageImport/);
  assert.match(commands, /export const importSharePackage/);
  assert.match(shareRuntime, /sharePackagesRuntime/);
  assert.match(shareDialog, /sharePackagesRuntime\.scan/);
  assert.doesNotMatch(adapter, /sharePackages:\s*\{/);
  assert.doesNotMatch(globalTypes, /sharePackages:\s*\{/);
  assert.doesNotMatch(shareDialog, /window\.aegis/);
});

test('channel metadata and failed account saves remain outside destructive UI paths', () => {
  assert.match(channelsTab, /isChannelConfigurationMetadataKey/);
  assert.match(agentHub, /isChannelConfigurationMetadataKey/);
  assert.doesNotMatch(channelsTab, /channelId !== 'modelByChannel'/);
  assert.doesNotMatch(agentHub, /channelId === 'modelByChannel'/);

  const accountSave = channelsCenter.slice(
    channelsCenter.indexOf('const handleSaveAccount'),
    channelsCenter.indexOf('const handleDeleteAccount'),
  );
  assert.match(accountSave, /const saved = await saveConfig\(config, next,/);
  assert.match(accountSave, /if \(saved\) \{[\s\S]*?setEditingAccount\(null\);/);
});
