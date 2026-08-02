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

test('storage settings expose only runtime-backed panels', () => {
  const settings = source('../../pages/SettingsPage.tsx');
  const storageTab = settings.slice(
    settings.indexOf("{activeTab === 'storage' && ("),
    settings.indexOf("{activeTab === 'about' && ("),
  );

  assert.match(storageTab, /<GatewayLifecyclePanel variant="full" \/>/);
  assert.match(storageTab, /<ManagedRuntimeSettingsPanel \/>/);
  assert.match(storageTab, /<NpmCacheSettingsPanel \/>/);
  assert.match(storageTab, /<GatewayLogPanel \/>/);
  assert.doesNotMatch(settings, /refreshManagedIndexInfo/);
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
