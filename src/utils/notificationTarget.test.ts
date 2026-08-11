import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNotificationTarget } from './notificationTarget';

test('通知内部目标保持 Gateway 或运行时提供的原始路由', () => {
  assert.deepEqual(resolveNotificationTarget('/chat?session=test-42'), {
    kind: 'internal',
    value: '/chat?session=test-42',
  });
});

test('notification targets accept only http and https external links', () => {
  assert.deepEqual(resolveNotificationTarget('https://openclaw.ai/docs'), {
    kind: 'external',
    value: 'https://openclaw.ai/docs',
  });
  assert.equal(resolveNotificationTarget('javascript:alert(1)'), null);
  assert.equal(resolveNotificationTarget('file:///tmp/secret'), null);
});

test('notification targets reject protocol-relative and malformed routes', () => {
  assert.equal(resolveNotificationTarget('//example.com/path'), null);
  assert.equal(resolveNotificationTarget('/settings\\providers'), null);
  assert.equal(resolveNotificationTarget('not a url'), null);
  assert.equal(resolveNotificationTarget(''), null);
});
