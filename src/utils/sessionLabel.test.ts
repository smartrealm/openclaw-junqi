import assert from 'node:assert/strict';
import test from 'node:test';
import { getSessionDisplayLabel } from './sessionLabel';

test('Gateway label 保持展示，只有本客户端创建的默认 label 使用首条消息主题', () => {
  for (const label of ['New chat', '新会话', '新會話', 'Main Session']) {
    assert.equal(
      getSessionDisplayLabel({
        key: 'agent:main:desktop-label',
        label,
        topic: '不应覆盖权威标签',
        lastMessage: '不应覆盖权威标签',
      }),
      label,
    );
  }
  assert.equal(
    getSessionDisplayLabel({
      key: 'agent:main:desktop-created',
      label: '新会话',
      initialLabel: '新会话',
      lastMessage: '使用这条提示作为会话名称',
    }),
    '使用这条提示作为会话名称',
  );
});

test('缺失 Gateway label 时才使用会话展示回退', () => {
  assert.equal(
    getSessionDisplayLabel({
      key: 'agent:research:desktop-label',
      topic: '研究主题',
    }),
    '研究主题',
  );
});
