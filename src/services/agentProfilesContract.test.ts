import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rust = readFileSync(new URL('../../src-tauri/src/commands/app_settings.rs', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const service = readFileSync(new URL('./agentProfiles.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../pages/AgentHub/AgentSettingsPanel.tsx', import.meta.url), 'utf8');

test('Agent Profile IPC names and serialized fields stay aligned across Rust and TypeScript', () => {
  assert.match(rust, /pub async fn load_agent_profiles\(\) -> Result<BTreeMap<String, AgentProfileMetadata>, String>/);
  assert.match(rust, /pub async fn save_agent_profile\(\s*agent_id: String,\s*domain: String,\s*scope: String,/s);
  assert.match(rust, /pub async fn delete_agent_profile\(agent_id: String\) -> Result<\(\), String>/);
  assert.match(registry, /commands::app_settings::load_agent_profiles/);
  assert.match(registry, /commands::app_settings::save_agent_profile/);
  assert.match(registry, /commands::app_settings::delete_agent_profile/);
  assert.match(rust, /save_app_settings[\s\S]*settings\.agent_profiles = load_settings_unlocked\(\)\.agent_profiles/);
  assert.match(service, /invoke<AgentProfileMap>\('load_agent_profiles'\)/);
  assert.match(service, /invoke<AgentProfileMetadata \| null>\('save_agent_profile'/);
  assert.match(service, /agent_id: normalized\.agentId/);
  assert.match(service, /invoke<void>\('delete_agent_profile'/);
});

test('business profile fields remain JunQi-local and are not sent through OpenClaw config.patch', () => {
  assert.match(panel, /loadAgentProfile\(agent\.id\)/);
  assert.match(panel, /saveAgentProfile\(\{[\s\S]*agentId: agent\.id/);
  assert.doesNotMatch(service, /config\.patch|agents\.list/);
  assert.doesNotMatch(panel, /profileDomain[^\n]*patch\./);
});
