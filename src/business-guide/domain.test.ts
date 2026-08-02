import assert from 'node:assert/strict';
import test from 'node:test';
import { projectBusinessGuide } from './domain';

const guidedTaskSelectors: Record<string, string> = {
  'start-chat': 'chat-new-session',
  'choose-model': 'providers-add',
  'review-agents': 'agents-add',
  'connect-channel': 'channels-add',
  'open-workspace': 'workspace-open-project',
};

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

test('every business-guide task has one concrete operation entry', () => {
  const tasks = projectBusinessGuide({ connected: true, hasModels: false, hasSession: false, hasAgent: false, hasReadyChannel: false });

  assert.deepEqual(Object.keys(guidedTaskSelectors), tasks.map((task) => task.id));
  assert.equal(new Set(Object.values(guidedTaskSelectors)).size, tasks.length);
});
