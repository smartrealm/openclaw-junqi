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

test('uses the supplied transcript fallback before a canonical main-session fallback', () => {
  assert.equal(
    getSessionDisplayLabel(
      { key: 'agent:main:main' },
      {
        ...labels,
        messageFallback: 'Plan the release rollout.',
      },
    ),
    'Plan the release rollout.',
  );
});
