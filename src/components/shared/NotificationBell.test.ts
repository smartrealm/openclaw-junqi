import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./NotificationBell.tsx', import.meta.url), 'utf8');

test('notification links stay inside the Tauri application for internal routes', () => {
  assert.match(source, /if \(url\.startsWith\('\/'\)\)/);
  assert.match(source, /navigate\(url\)/);
  assert.match(source, /window\.open\(url, '_blank'/);
});
