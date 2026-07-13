import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toNotificationPanelItem } from './TopBar';

test('TopBar maps persisted notification fields and localized body', () => {
  const item = {
    id: 'task-1',
    level: 'warning',
    title: 'Task needs attention',
    body: 'English body',
    bodyZh: '中文内容',
    url: '/ai-workspace',
    createdAt: '2026-07-14T10:00:00Z',
    isRead: false,
  };

  const mapped = toNotificationPanelItem(item, 'zh');

  assert.equal(mapped.type, 'error');
  assert.equal(mapped.body, '中文内容');
  assert.equal(mapped.timestamp, item.createdAt);
  assert.equal(mapped.read, false);
});

test('TopBar and notification service use the persistent notification contract', () => {
  const topBar = readFileSync(new URL('./TopBar.tsx', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../../services/notifications.ts', import.meta.url), 'utf8');

  assert.match(topBar, /usePersistentNotifications\(\)/);
  assert.doesNotMatch(topBar, /useNotificationStore/);
  assert.match(service, /invoke\('push_notification'/);
  assert.match(service, /PERSISTENT_NOTIFICATIONS_CHANGED_EVENT/);
});
