import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { terminalInboxItems, toNotificationPanelItem } from './TopBar';

test('TopBar maps persisted notification fields and localized body', () => {
  const item = {
    id: 'task-1',
    level: 'warning',
    title: 'Task needs attention',
    body: 'English body',
    bodyZh: '中文内容',
    url: '/ai-workspace',
    agent: 'claude',
    createdAt: '2026-07-14T10:00:00Z',
    isRead: false,
  };

  const mapped = toNotificationPanelItem(item, 'zh');

  assert.equal(mapped.type, 'error');
  assert.equal(mapped.body, '中文内容');
  assert.equal(mapped.timestamp, item.createdAt);
  assert.equal(mapped.read, false);
  assert.equal(mapped.url, '/ai-workspace');
  assert.equal(mapped.agent, 'claude');
});

test('terminal inbox excludes persistent records without a verified terminal agent', () => {
  const items = terminalInboxItems([
    { id: 'claude', type: 'message', title: 'Claude', body: '', timestamp: '', read: false, agent: 'claude' },
    { id: 'workflow', type: 'info', title: 'Workflow', body: '', timestamp: '', read: false },
    { id: 'unknown', type: 'info', title: 'Unknown', body: '', timestamp: '', read: false, agent: 'other-cli' },
  ]);

  assert.deepEqual(items.map((item) => item.id), ['claude']);
});

test('TopBar and notification service use the persistent notification contract', () => {
  const topBar = readFileSync(new URL('./TopBar.tsx', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../../services/notifications.ts', import.meta.url), 'utf8');

  assert.match(topBar, /usePersistentNotifications\(\)/);
  assert.doesNotMatch(topBar, /useNotificationStore/);
  assert.match(service, /invoke\('push_notification'/);
  assert.match(service, /PERSISTENT_NOTIFICATIONS_CHANGED_EVENT/);
  assert.match(topBar, /resolveNotificationTarget\(item\.url\)/);
  assert.match(topBar, /if \(!target\) \{\s+if \(terminalChrome\) setPanelOpen\(false\);\s+return;/);
  assert.match(topBar, /<TerminalNotificationPanel/);
});
