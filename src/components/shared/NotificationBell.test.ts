import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./NotificationBell.tsx', import.meta.url), 'utf8');

test('notification links stay inside the Tauri application for internal routes', () => {
  assert.match(source, /resolveNotificationTarget\(url\)/);
  assert.match(source, /target\.kind === 'internal'/);
  assert.match(source, /navigate\(target\.value\)/);
  assert.match(source, /window\.open\(target\.value, '_blank'/);
});

test('notification content follows the selected UI language without duplication', () => {
  assert.match(source, /language === 'zh' && item\.bodyZh \? item\.bodyZh : item\.body/);
  assert.match(source, /\{body\}/);
  assert.doesNotMatch(source, /\{item\.bodyZh\}/);
});

test('notification dialog keeps the Nezha viewport-aware width', () => {
  assert.match(source, /min\(920px,calc\(100vw-48px\),calc\(\(100vh-96px\)\*4\/3\)\)/);
});
