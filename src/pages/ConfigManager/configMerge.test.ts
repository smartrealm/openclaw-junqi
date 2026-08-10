import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawConfigPatch } from '@/services/gateway/OpenClawConfigPatch';

test('仅发送用户实际修改的对象字段', () => {
  assert.deepEqual(
    buildOpenClawConfigPatch(
      { agents: { defaults: { maxConcurrent: 2 } }, future: { option: 'runtime-v1' } },
      { agents: { defaults: { maxConcurrent: 3 } }, future: { option: 'runtime-v1' } },
    ),
    { patch: { agents: { defaults: { maxConcurrent: 3 } } }, replacePaths: [] },
  );
});

test('稳定 id 数组只发送已修改条目', () => {
  assert.deepEqual(
    buildOpenClawConfigPatch(
      { agents: { list: [{ id: 'main', workspace: '/a' }, { id: 'ops', workspace: '/b' }] } },
      { agents: { list: [{ id: 'main', workspace: '/next' }, { id: 'ops', workspace: '/b' }] } },
    ),
    { patch: { agents: { list: [{ id: 'main', workspace: '/next' }] } }, replacePaths: [] },
  );
});

test('数组删除和非 id 数组变更明确声明替换路径', () => {
  assert.deepEqual(
    buildOpenClawConfigPatch(
      { agents: { list: [{ id: 'main' }, { id: 'ops' }] }, tools: { allow: ['read', 'write'] } },
      { agents: { list: [{ id: 'main' }] }, tools: { allow: ['read'] } },
    ),
    {
      patch: { agents: { list: [{ id: 'main' }] }, tools: { allow: ['read'] } },
      replacePaths: ['agents.list', 'tools.allow'],
    },
  );
});

test('稳定 id 条目的重排或中间插入明确替换整个数组', () => {
  assert.deepEqual(
    buildOpenClawConfigPatch(
      { agents: { list: [{ id: 'main' }, { id: 'ops' }] } },
      { agents: { list: [{ id: 'main' }, { id: 'legal' }, { id: 'ops' }] } },
    ),
    {
      patch: { agents: { list: [{ id: 'main' }, { id: 'legal' }, { id: 'ops' }] } },
      replacePaths: ['agents.list'],
    },
  );
});

test('删除对象字段以官方合并补丁空值表达', () => {
  assert.deepEqual(
    buildOpenClawConfigPatch(
      { agents: { defaults: { workspace: '/workspace', maxConcurrent: 2 } } },
      { agents: { defaults: { maxConcurrent: 2 } } },
    ),
    { patch: { agents: { defaults: { workspace: null } } }, replacePaths: [] },
  );
});
