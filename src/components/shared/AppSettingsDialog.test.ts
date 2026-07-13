import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AppSettingsDialog.tsx', import.meta.url), 'utf8');

test('application settings expose the Nezha skill hub panel', () => {
  assert.match(source, /key: 'skills'/);
  assert.match(source, /activeNav === 'skills' && <SkillsPanel \/>/);
  assert.match(source, /invoke<SkillHubConfig>\('get_skill_hub_config'\)/);
  assert.match(source, /invoke<\{ config: SkillHubConfig \}>\('set_skill_hub_path'/);
  assert.match(source, /invoke\('clear_skill_hub'\)/);
  assert.match(source, /new Event\('nezha:skill-hub-changed'\)/);
});

test('agent settings expose executable paths backed by native app settings', () => {
  assert.match(source, /function AgentProgramPathSection/);
  assert.match(source, /invoke<NativeAppSettings>\('load_app_settings'\)/);
  assert.match(source, /invoke<NativeAppSettings>\('detect_agent_paths'\)/);
  assert.match(source, /invoke\('save_app_settings', \{ settings: nextSettings \}\)/);
  assert.match(source, /<AgentProgramPathSection agent=\{agent\}\/>/);
  assert.match(source, /settings\.claude_force_default_tui/);
});

test('about panel follows the Nezha product-card structure without internal feature claims', () => {
  assert.match(source, /<JunQiLogo variant="emblem"/);
  assert.match(source, /github\.com\/smartrealm\/openclaw-junqi/);
  assert.doesNotMatch(source, /Nezha 39-feature port/);
  assert.doesNotMatch(source, /portable-pty/);
});
