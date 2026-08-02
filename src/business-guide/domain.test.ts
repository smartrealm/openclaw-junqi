import assert from 'node:assert/strict';
import test from 'node:test';
import { projectBusinessGuide } from './domain';

test('business guide fails closed for Gateway-dependent tasks', () => {
  const tasks = projectBusinessGuide({ connected: false, hasModels: false, hasSession: false, hasAgent: false, hasReadyChannel: false });
  assert.equal(tasks.find((task) => task.id === 'start-chat')?.state, 'blocked');
  assert.equal(tasks.find((task) => task.id === 'choose-model')?.state, 'blocked');
  assert.equal(tasks.find((task) => task.id === 'open-workspace')?.state, 'available');
});

test('business guide only completes tasks from observed facts', () => {
  const tasks = projectBusinessGuide({ connected: true, hasModels: true, hasSession: true, hasAgent: true, hasReadyChannel: true });
  assert.equal(tasks.filter((task) => task.state === 'completed').map((task) => task.id).join(','), 'start-chat,choose-model,review-agents,connect-channel');
  assert.equal(tasks.find((task) => task.id === 'connect-channel')?.state, 'completed');
});
