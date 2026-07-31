import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const adapter = source('./tauri-adapter.ts');
const globalTypes = source('../types/global.d.ts');
const configTypes = source('../types/openclawConfig.ts');
const configManager = source('../pages/ConfigManager/index.tsx');
const channelsCenter = source('../pages/ChannelsCenter/index.tsx');
const agentSettings = source('../pages/AgentHub/AgentSettingsPanel.tsx');
const channelsTab = source('../pages/ConfigManager/ChannelsTab.tsx');
const agentHub = source('../pages/AgentHub/index.tsx');
const rustConfig = source('../../src-tauri/src/commands/config.rs');
const tauriLib = source('../../src-tauri/src/lib.rs');

test('OpenClaw config reads and imports share the Rust JSON5 contract', () => {
  assert.match(adapter, /invoke<ActiveOpenClawConfigRead>\('read_config'\)/);
  assert.match(adapter, /parse_openclaw_config_text/);
  assert.doesNotMatch(adapter, /JSON\.parse\(d\.raw/);
  assert.match(rustConfig, /pub struct ConfigData \{[\s\S]*?pub data: serde_json::Value,[\s\S]*?pub revision: String,/);
  assert.match(rustConfig, /pub fn parse_openclaw_config_text\(raw: String\)/);
  assert.match(tauriLib, /commands::config::parse_openclaw_config_text/);
});

test('renderer config writes target only the selected runtime and retain no local config backup', () => {
  assert.match(adapter, /expectedRevision: expectedRevision \?\? null/);
  assert.match(adapter, /clearLegacyOpenClawConfigBackups\(\)/);
  assert.doesNotMatch(configManager, /aegis-config-backups/);
  assert.doesNotMatch(configManager, /config\.read\([^)]/);
  assert.doesNotMatch(channelsCenter, /config\.read\(detected\.path\)/);
  assert.doesNotMatch(agentSettings, /config\.read\(detected\.path\)/);
  assert.doesNotMatch(agentSettings, /channelConfigPath/);
});

test('shared configuration types do not make the Tauri adapter depend on a page module', () => {
  assert.match(globalTypes, /import\('\.\/openclawConfig'\)\.GatewayRuntimeConfig/);
  assert.match(configTypes, /export interface OpenClawConfig/);
  assert.doesNotMatch(adapter, /pages\/ConfigManager\/types/);
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
