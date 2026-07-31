import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeLegacyAgentWorkspaceTaskRoute,
  createAgentRunTaskRoute,
} from './agentTaskRoute';

test('agent task routes preserve the exact persisted task identity', () => {
  assert.equal(
    createAgentRunTaskRoute(' agent-task:one/two '),
    '/agent-run?taskId=agent-task%3Aone%2Ftwo',
  );
  assert.equal(createAgentRunTaskRoute('   '), '/agent-run');
});

test('only the exact legacy workspace task deep link is canonicalized', () => {
  assert.equal(
    canonicalizeLegacyAgentWorkspaceTaskRoute('/ai-workspace?task=agent-task%3A123'),
    '/agent-run?taskId=agent-task%3A123',
  );
  assert.equal(
    canonicalizeLegacyAgentWorkspaceTaskRoute('/ai-workspace?task=agent-task%3A123&view=history'),
    '/ai-workspace?task=agent-task%3A123&view=history',
  );
  assert.equal(
    canonicalizeLegacyAgentWorkspaceTaskRoute('/ai-workspace?task=one&task=two'),
    '/ai-workspace?task=one&task=two',
  );
  assert.equal(
    canonicalizeLegacyAgentWorkspaceTaskRoute('/ai-workspace?task=one#details'),
    '/ai-workspace?task=one#details',
  );
  assert.equal(canonicalizeLegacyAgentWorkspaceTaskRoute('/ai-workspace?task='), '/ai-workspace?task=');
});
