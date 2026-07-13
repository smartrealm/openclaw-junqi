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
