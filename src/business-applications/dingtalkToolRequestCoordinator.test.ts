import assert from 'node:assert/strict';
import test from 'node:test';
import { DingTalkToolSchemaRequestCoordinator } from './dingtalkToolRequestCoordinator';

test('只接受最新且仍匹配 Session 与工具的 schema 请求', () => {
  const coordinator = new DingTalkToolSchemaRequestCoordinator();
  const first = coordinator.begin('agent:main:first', 'tool-a');
  const second = coordinator.begin('agent:main:first', 'tool-b');

  assert.equal(coordinator.accepts(first, 'agent:main:first', 'tool-a'), false);
  assert.equal(coordinator.accepts(second, 'agent:main:first', 'tool-b'), true);
  assert.equal(coordinator.accepts(second, 'agent:other:second', 'tool-b'), false);
  assert.equal(coordinator.accepts(second, 'agent:main:first', 'tool-a'), false);
});

test('上下文失效后拒绝仍在等待的 schema 请求', () => {
  const coordinator = new DingTalkToolSchemaRequestCoordinator();
  const pending = coordinator.begin('agent:main:first', 'tool-a');

  coordinator.invalidate();

  assert.equal(coordinator.accepts(pending, 'agent:main:first', 'tool-a'), false);
});
