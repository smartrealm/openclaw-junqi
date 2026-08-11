import assert from 'node:assert/strict';
import test from 'node:test';
import { focusNavigationTarget, projectFocusContext, type FocusContext } from './focusContext';

const base: FocusContext = {
  schemaVersion: 1,
  target: { kind: 'chat-session', id: 'session-1' },
  title: '会话焦点',
  detail: 'main',
  route: '/chat?session=session-1',
  focusedAt: 10,
};

test('焦点投影保留会话身份并读取实时状态', () => {
  const projected = projectFocusContext(base, {
    chatSessions: [{ key: 'session-1', label: '更新后的会话标题', hasActiveRun: true }],
  });
  assert.equal(projected?.title, '更新后的会话标题');
  assert.equal(projected?.state, 'running');
  assert.equal(projected?.detail, 'main');
});

test('不存在的原生会话保留不可用状态而不重定向', () => {
  const projected = projectFocusContext(base, { chatSessions: [] });
  assert.equal(projected?.state, 'unavailable');
  assert.equal(projected?.target.id, 'session-1');
});

test('焦点导航只允许会话内部路由', () => {
  assert.equal(focusNavigationTarget(base), '/chat?session=session-1');
  assert.equal(focusNavigationTarget({ ...base, route: 'https://example.com' }), null);
  assert.equal(focusNavigationTarget({ ...base, route: '/settings/../secret' }), null);
  assert.equal(focusNavigationTarget({ ...base, route: '/briefs?brief=task-1' }), null);
});
