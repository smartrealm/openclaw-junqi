import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOpenClawSessionTasks } from './OpenClawRunConsole';

test('运行控制台在任务账本不可用时保留未知状态', () => {
  assert.equal(selectOpenClawSessionTasks(null, 'agent:main:session'), null);
  assert.equal(selectOpenClawSessionTasks({ availability: 'unavailable', tasks: [] }, 'agent:main:session'), null);
});

test('运行控制台只投影当前会话关联的原生任务', () => {
  const tasks = selectOpenClawSessionTasks({
    availability: 'available',
    tasks: [
      { id: 'direct', status: 'running', sessionKey: 'agent:main:session' },
      { id: 'child', status: 'queued', childSessionKey: 'agent:main:session' },
      { id: 'other', status: 'completed', sessionKey: 'agent:other:session' },
    ],
  }, 'agent:main:session');

  assert.deepEqual(tasks?.map((task) => task.id), ['direct', 'child']);
});
