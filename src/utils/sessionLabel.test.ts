import assert from 'node:assert/strict';
import test from 'node:test';
import { getSessionDisplayLabel } from './sessionLabel';

const labels = { mainSessionLabel: 'Main session', genericSessionLabel: 'Session' };

test('Gateway label 保持展示，首条消息不会覆盖它', () => {
  for (const label of ['New chat', '新会话', '新會話', 'Main Session']) {
    assert.equal(
      getSessionDisplayLabel({
        key: 'agent:main:desktop-label',
        label,
        topic: '不应覆盖权威标签',
        lastMessage: '不应覆盖权威标签',
      }, labels),
      label,
    );
  }
});

test('缺失 Gateway label 时才使用会话展示回退', () => {
  assert.equal(
    getSessionDisplayLabel({
      key: 'agent:research:desktop-label',
      topic: '研究主题',
    }, labels),
    '研究主题',
  );
});

test('uses the official derived title and preview fields in their documented order', () => {
  assert.equal(getSessionDisplayLabel({ key: 'agent:research:desktop-derived', derivedTitle: 'Derived title', displayName: 'Display name', lastMessagePreview: 'Preview' }, labels), 'Derived title');
  assert.equal(getSessionDisplayLabel({ key: 'agent:research:desktop-derived', displayName: 'Display name', lastMessagePreview: 'Preview' }, labels), 'Display name');
  assert.equal(getSessionDisplayLabel({ key: 'agent:research:desktop-derived', lastMessagePreview: 'Preview' }, labels), 'Preview');
});

test('uses the supplied transcript fallback before the Gateway main-session fallback', () => {
  assert.equal(
    getSessionDisplayLabel(
      { key: 'agent:main:main' },
      {
        ...labels,
        mainSessionKey: 'agent:main:main',
        messageFallback: 'Plan the release rollout.',
      },
    ),
    'Plan the release rollout.',
  );
});

test('does not label another agent direct main session as the Gateway main session', () => {
  assert.equal(
    getSessionDisplayLabel(
      { key: 'agent:research:main' },
      {
        ...labels,
        mainSessionKey: 'agent:orchestrator:main',
      },
    ),
    'main',
  );
});
