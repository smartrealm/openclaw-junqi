import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseOpenClawAgentList,
  projectOpenClawSession,
  resolveOpenClawExplicitAgentMainSessionKey,
} from './OpenClawSessionProjection';

test('保留 OpenClaw 会话列表返回的创建时间，且不以本地活动时间替代', () => {
  const projection = projectOpenClawSession({
    key: 'agent:main:desktop-1',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
  });

  assert.equal(projection.createdAt, 1_700_000_000_000);
  assert.equal(projection.updatedAt, 1_700_000_100_000);
});

test('拒绝 OpenClaw 未定义的负数创建时间，避免排序伪造有效时间', () => {
  assert.throws(
    () => projectOpenClawSession({ key: 'agent:main:desktop-1', createdAt: -1 }),
    /createdAt/,
  );
});

test('显式智能体主会话同时服从官方会话范围和智能体列表', () => {
  const snapshot = parseOpenClawAgentList({
    defaultId: 'main',
    mainKey: 'primary',
    scope: 'global',
    agents: [{ id: 'main' }, { id: 'jarvis' }],
  });
  assert.equal(
    resolveOpenClawExplicitAgentMainSessionKey(snapshot, 'jarvis'),
    'agent:jarvis:global',
  );
  assert.equal(resolveOpenClawExplicitAgentMainSessionKey(snapshot, 'missing'), null);
  assert.equal(resolveOpenClawExplicitAgentMainSessionKey({
    ...snapshot,
    scope: 'per-sender',
  }, 'jarvis'), 'agent:jarvis:primary');
});
