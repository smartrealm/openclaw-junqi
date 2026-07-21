import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withAllNotificationsRead,
  withNotificationRead,
  withNotificationsRead,
  withoutNotifications,
  type PersistentNotificationResult,
} from './usePersistentNotifications';

const result: PersistentNotificationResult = {
  unreadCount: 2,
  notifications: [
    { id: 'a', level: 'info', title: 'A', body: '', bodyZh: null, url: null, createdAt: '', isRead: false },
    { id: 'b', level: 'error', title: 'B', body: '', bodyZh: null, url: null, createdAt: '', isRead: false },
  ],
};

test('marking one persistent notification recomputes unread count', () => {
  const next = withNotificationRead(result, 'a');
  assert.equal(next?.unreadCount, 1);
  assert.equal(next?.notifications[0].isRead, true);
  assert.equal(next?.notifications[1].isRead, false);
});

test('marking all persistent notifications preserves order and clears unread count', () => {
  const next = withAllNotificationsRead(result);
  assert.equal(next?.unreadCount, 0);
  assert.deepEqual(next?.notifications.map((item) => item.id), ['a', 'b']);
  assert.ok(next?.notifications.every((item) => item.isRead));
});

test('scoped notification mutations preserve records outside the selected IDs', () => {
  const read = withNotificationsRead(result, ['a']);
  assert.equal(read?.unreadCount, 1);
  assert.equal(read?.notifications[0].isRead, true);
  assert.equal(read?.notifications[1].isRead, false);

  const removed = withoutNotifications(result, ['a']);
  assert.deepEqual(removed?.notifications.map((item) => item.id), ['b']);
  assert.equal(removed?.unreadCount, 1);
});
