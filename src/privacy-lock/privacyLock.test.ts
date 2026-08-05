import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_PRIVACY_LOCK_SETTINGS } from './types';

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('privacy lock defaults use a cross-platform global shortcut and startup fence', () => {
  assert.equal(DEFAULT_PRIVACY_LOCK_SETTINGS.globalShortcut, 'CommandOrControl+Shift+L');
  assert.equal(DEFAULT_PRIVACY_LOCK_SETTINGS.lockOnStartup, true);
  assert.equal(DEFAULT_PRIVACY_LOCK_SETTINGS.lockOnResume, true);
});

test('every auxiliary React root is wrapped before its business component mounts', () => {
  const main = source('src/main.tsx');
  assert.match(main, /PrivacyLock\.PrivacyLockGate/);
  assert.match(main, /compact: compactLock/);
  assert.match(main, /children: React\.createElement\(Root\)/);
});

test('locked notifications are persisted without sensitive body and are not presented', () => {
  const notifications = source('src/services/notifications.ts');
  assert.match(notifications, /isPrivacyLocked\(\)/);
  assert.match(notifications, /title: 'JunQi', body: ''/);
  assert.match(notifications, /this\._dndMode \|\| locked/);
});

test('native invoke boundary rejects every non-unlock command while locked', () => {
  const native = source('src-tauri/src/lib.rs');
  assert.match(native, /command_allowed_while_locked/);
  assert.match(native, /invoke\.resolver\.reject\("privacy_locked"\)/);
});

test('native sensitive window and authorization commands enforce privacy lock', () => {
  for (const path of [
    'src-tauri/src/commands/quickchat.rs',
    'src-tauri/src/commands/terminal_window.rs',
    'src-tauri/src/commands/provider_oauth.rs',
    'src-tauri/src/commands/device_pairing.rs',
    'src-tauri/src/commands/file_preview.rs',
    'src-tauri/src/commands/screenshot.rs',
  ]) {
    assert.match(source(path), /privacy_lock::ensure_unlocked/, `${path} must fail closed`);
  }
});

test('privacy lock configuration keeps secrets out of renderer persistence', () => {
  const store = source('src/privacy-lock/store.ts');
  const api = source('src/privacy-lock/api.ts');
  assert.doesNotMatch(store, /localStorage|sessionStorage/);
  assert.doesNotMatch(api, /PasswordHash|SaltString|argon2/);
});
