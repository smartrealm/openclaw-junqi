import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfiguredOfficeRoster } from './agentHubConfiguredOfficeRoster';

test('配置员工席位只投影 Gateway 返回的配置字段', () => {
  const roster = buildConfiguredOfficeRoster([
    { id: 'worker', runtimeType: 'native', allowed: true, coordinator: false },
    { id: 'main', name: '主智能体', description: '协调任务', runtimeType: 'native', allowed: true, coordinator: true },
  ]);

  assert.deepEqual(roster, [
    {
      id: 'main',
      displayName: '主智能体',
      description: '协调任务',
      coordinator: true,
      allowed: true,
      runtimeType: 'native',
    },
    {
      id: 'worker',
      displayName: 'worker',
      description: null,
      coordinator: false,
      allowed: true,
      runtimeType: 'native',
    },
  ]);
});
