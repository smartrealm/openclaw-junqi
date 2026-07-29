import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('settings tabs use one URL state and suppress repeated card entry motion', () => {
  const settings = source('../../pages/SettingsPage.tsx');

  assert.match(settings, /const activeTab: SettingsTab = SETTINGS_TABS\.includes/);
  assert.doesNotMatch(settings, /setActiveTab/);
  assert.match(settings, /<GlassCardEnterMotionScope enabled=\{false\}>/);
});

test('storage inventory loads only when its settings tab is active', () => {
  const settings = source('../../pages/SettingsPage.tsx');
  const effect = settings.slice(
    settings.indexOf('if (activeTab !== \'storage\') return;'),
    settings.indexOf('const handleLanguageChange'),
  );

  assert.match(effect, /refreshManagedIndexInfo\(\)/);
  assert.match(effect, /\[activeTab, refreshManagedIndexInfo\]/);
});

test('settings do not expose unimplemented wake-word credentials', () => {
  const settings = source('../../pages/SettingsPage.tsx');
  const store = source('../../stores/settingsStore.ts');

  assert.doesNotMatch(settings, /picovoiceAccessKey|wakeSensitivity|voiceWake\.accessKey/);
  assert.doesNotMatch(store, /setPicovoiceAccessKey|setWakeSensitivity/);
  assert.match(store, /removeItem\(key\)/);
});

test('settings switches expose native state and an accessible name', () => {
  const settings = source('../../pages/SettingsPage.tsx');
  const terminalSettings = source('./TerminalSettingsPanel.tsx');

  assert.match(settings, /import \{ SettingsSwitch \}/);
  assert.match(terminalSettings, /import \{ SettingsSwitch \}/);
  assert.doesNotMatch(settings, /const Toggle/);
  assert.doesNotMatch(terminalSettings, /function PreferenceSwitch/);
});
