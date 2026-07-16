import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(new URL('./NpmCacheSettingsPanel.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../../pages/SettingsPage.tsx', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../../../src-tauri/src/commands/storage.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const updater = readFileSync(new URL('../../../src-tauri/src/commands/openclaw_update.rs', import.meta.url), 'utf8');
const repair = readFileSync(new URL('../../../src-tauri/src/commands/openclaw_repair.rs', import.meta.url), 'utf8');

test('npm cache remains user-configurable after runtime installation', () => {
  assert.match(settings, /activeTab === 'storage'[\s\S]*<NpmCacheSettingsPanel \/>/);
  assert.match(panel, /get_storage_setup_status/);
  assert.match(panel, /update_npm_cache_directory/);
  assert.match(panel, /directory: true/);
  assert.doesNotMatch(panel, /checkNode|installNode/);
});

test('npm cache update has a dedicated validated backend command', () => {
  assert.match(storage, /pub async fn update_npm_cache_directory/);
  assert.match(storage, /layout_with_npm_cache/);
  assert.match(storage, /verify_directory_writable/);
  assert.match(storage, /validate_location_changes\(&updated, Some\(current\)\)/);
  assert.match(lib, /commands::storage::update_npm_cache_directory/);
});

test('the explicit npm cache override reaches install, update, and repair commands', () => {
  assert.match(setup, /apply_configured_npm_cache\(&mut cmd\)/);
  assert.match(updater, /system::apply_configured_npm_cache\(&mut command\)/);
  assert.match(repair, /system::apply_configured_npm_cache\(&mut command\)/);
});

test('npm cache settings and running step labels exist in every locale', () => {
  const keys = [
    'storage.npmCacheSettingsTitle',
    'storage.npmCacheSettingsHint',
    'storage.npmCacheSave',
    'storage.npmCacheSaved',
    'setup.installPanel.runningStep',
    'setup.installPanel.live',
  ];
  for (const locale of ['zh', 'en', 'ar']) {
    const messages = JSON.parse(
      readFileSync(new URL(`../../locales/${locale}.json`, import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    for (const key of keys) {
      const nested = key.split('.').reduce<unknown>((value, part) => {
        if (!value || typeof value !== 'object') return undefined;
        return (value as Record<string, unknown>)[part];
      }, messages);
      assert.equal(typeof (messages[key] ?? nested), 'string', `${locale} is missing ${key}`);
    }
  }
});
